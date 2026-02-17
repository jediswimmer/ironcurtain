/**
 * TTS Pipeline — converts commentary text to speech via multiple backends.
 *
 * Supports:
 *   1. ElevenLabs (best quality, streaming)
 *   2. OpenAI TTS (good fallback)
 *   3. Local TTS via piper/espeak (zero-cost)
 *
 * Routes audio output to a virtual audio device (BlackHole on macOS,
 * PulseAudio null-sink on Linux) so OBS can capture it.
 *
 * Handles priority queuing — critical events can interrupt routine commentary.
 */

import { execSync, spawn, ChildProcess } from "child_process";
import { writeFileSync, mkdirSync, existsSync, createWriteStream } from "fs";
import { join } from "path";
import { Writable } from "stream";
import {
  CommentaryChunk,
  CommentaryStyle,
  TTSBackend,
  VoiceConfig,
  Emotion,
  Severity,
  StyleDefinition,
} from "./types.js";
import { getStyle } from "./styles/index.js";

// ── Voice Config ────────────────────────────────────

/** Emotion-based adjustments to voice parameters. */
const EMOTION_ADJUSTMENTS: Record<Emotion, { stability?: number; speedMult?: number }> = {
  excited:  { stability: -0.15, speedMult: 1.15 },
  panicked: { stability: -0.2,  speedMult: 1.25 },
  tense:    { stability: -0.1,  speedMult: 1.05 },
  somber:   { stability: 0.1,   speedMult: 0.85 },
  smug:     { stability: -0.1,  speedMult: 0.95 },
  awed:     { stability: 0.05,  speedMult: 0.9 },
  amused:   { stability: -0.05, speedMult: 1.0 },
  neutral:  {},
};

/** Speed multiplier per speech speed setting. */
const SPEED_MULT: Record<string, number> = {
  slow: 0.85,
  normal: 1.0,
  fast: 1.15,
  frantic: 1.3,
};

// ── Priority Queue ──────────────────────────────────

interface QueuedAudio {
  chunk: CommentaryChunk;
  priority: number;
  timestamp: number;
}

// ── OpenAI Voice Map ────────────────────────────────

const OPENAI_VOICE_MAP: Record<CommentaryStyle, string> = {
  esports: "onyx",               // Deep, energetic
  war_correspondent: "echo",     // Steady, serious
  skippy_trash_talk: "fable",    // Expressive, sardonic
  documentary: "shimmer",        // Warm, measured
};

// ── Main Class ──────────────────────────────────────

export class TTSPipeline {
  private styleDef: StyleDefinition;
  private voiceConfig: VoiceConfig;
  private queue: QueuedAudio[] = [];
  private isPlaying = false;
  private currentPriority = 0;
  private audioDir: string;
  private backend: TTSBackend;
  private audioIndex = 0;
  private currentProcess: ChildProcess | null = null;
  private onSpeak?: (text: string) => void;

  constructor(styleName: CommentaryStyle) {
    this.styleDef = getStyle(styleName);
    this.voiceConfig = this.styleDef.voice;

    // Determine best available backend
    this.backend = this.detectBackend();

    // Create audio output directory
    this.audioDir = join(process.cwd(), ".audio-cache");
    if (!existsSync(this.audioDir)) {
      mkdirSync(this.audioDir, { recursive: true });
    }

    console.error(`🔊 TTS initialized — Backend: ${this.backend}, Voice: ${this.voiceConfig.voiceName} (${styleName})`);
  }

  /** Register a callback for when speech begins (for subtitle sync). */
  onSpeakStart(callback: (text: string) => void): void {
    this.onSpeak = callback;
  }

  /** Queue a commentary chunk for speech. Higher priority can interrupt. */
  async speak(chunk: CommentaryChunk): Promise<void> {
    const priority = this.severityToPriority(chunk.priority);

    // If higher priority than current playback, interrupt
    if (this.isPlaying && priority > this.currentPriority + 1) {
      console.error(`⚡ Interrupting for ${chunk.priority} event!`);
      this.interrupt();
    }

    this.queue.push({
      chunk,
      priority,
      timestamp: Date.now(),
    });

    // Sort: highest priority first
    this.queue.sort((a, b) => b.priority - a.priority);

    if (!this.isPlaying) {
      await this.playNext();
    }
  }

  /** Stop current playback and clear lower-priority queue items. */
  interrupt(): void {
    if (this.currentProcess) {
      this.currentProcess.kill("SIGTERM");
      this.currentProcess = null;
    }
    this.queue = this.queue.filter(q => q.priority >= this.currentPriority);
    this.isPlaying = false;
  }

  /** Stop everything. */
  shutdown(): void {
    this.interrupt();
    this.queue = [];
  }

  // ── Private: Backend Detection ────────────────────

  private detectBackend(): TTSBackend {
    // Try ElevenLabs
    if (process.env.ELEVENLABS_API_KEY) {
      return "elevenlabs";
    }

    // Try OpenAI
    if (process.env.OPENAI_API_KEY) {
      return "openai";
    }

    // Fallback to local
    console.error("⚠️  No ELEVENLABS_API_KEY or OPENAI_API_KEY found. Using local TTS (espeak/say).");
    return "local";
  }

  // ── Private: Queue Processing ─────────────────────

  private async playNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      return;
    }

    const item = this.queue.shift()!;
    this.isPlaying = true;
    this.currentPriority = item.priority;

    try {
      const adjustedConfig = this.adjustVoice(item.chunk.emotion, item.chunk.speed);

      console.error(`🎙️  [${item.chunk.priority}] "${item.chunk.text}"`);

      // Notify subtitle overlay
      this.onSpeak?.(item.chunk.text);

      // Synthesize and play
      switch (this.backend) {
        case "elevenlabs":
          await this.synthesizeElevenLabs(item.chunk.text, adjustedConfig);
          break;
        case "openai":
          await this.synthesizeOpenAI(item.chunk.text, adjustedConfig);
          break;
        case "local":
          await this.synthesizeLocal(item.chunk.text, adjustedConfig);
          break;
      }
    } catch (e) {
      console.error(`TTS error:`, e);
    }

    // Play next in queue
    await this.playNext();
  }

  // ── Private: ElevenLabs ───────────────────────────

  private async synthesizeElevenLabs(text: string, config: VoiceConfig): Promise<void> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set");

    const outputFile = this.nextAudioPath("mp3");

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}/stream`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: config.stability,
            similarity_boost: config.similarityBoost,
            style: config.style,
            use_speaker_boost: true,
          },
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs API error ${response.status}: ${errText}`);
    }

    // Stream response to file
    const body = response.body;
    if (!body) throw new Error("No response body from ElevenLabs");

    const fileStream = createWriteStream(outputFile);
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(Buffer.from(value));
      }
    } finally {
      fileStream.end();
    }

    // Wait for file to be fully written
    await new Promise<void>((resolve) => fileStream.on("finish", resolve));

    // Play the audio file
    await this.playAudioFile(outputFile, config.baseSpeed);
  }

  // ── Private: OpenAI TTS ───────────────────────────

  private async synthesizeOpenAI(text: string, config: VoiceConfig): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    const outputFile = this.nextAudioPath("mp3");
    const voice = OPENAI_VOICE_MAP[this.styleDef.name] ?? "onyx";
    const speed = Math.max(0.25, Math.min(4.0, config.baseSpeed));

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice,
        speed,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI TTS error ${response.status}: ${errText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(outputFile, buffer);

    await this.playAudioFile(outputFile, 1.0); // Speed already set in API call
  }

  // ── Private: Local TTS ────────────────────────────

  private async synthesizeLocal(text: string, config: VoiceConfig): Promise<void> {
    const platform = process.platform;

    if (platform === "darwin") {
      // macOS: use `say` command
      const rate = Math.round(180 * config.baseSpeed); // ~180 WPM default
      await this.runCommand("say", ["-r", String(rate), text]);
    } else if (platform === "linux") {
      // Linux: try piper first, fall back to espeak
      try {
        await this.runCommand("espeak-ng", [
          "-s", String(Math.round(160 * config.baseSpeed)),
          text,
        ]);
      } catch {
        await this.runCommand("espeak", [
          "-s", String(Math.round(160 * config.baseSpeed)),
          text,
        ]);
      }
    } else {
      // Fallback: just wait (simulate TTS duration)
      const wordCount = text.split(/\s+/).length;
      const durationMs = (wordCount * 150) / config.baseSpeed;
      await new Promise(resolve => setTimeout(resolve, durationMs));
    }
  }

  // ── Private: Audio Playback ───────────────────────

  private async playAudioFile(filePath: string, speedMult: number): Promise<void> {
    const platform = process.platform;

    if (platform === "darwin") {
      // Use afplay on macOS — supports rate adjustment
      const rate = Math.max(0.5, Math.min(2.0, speedMult));
      await this.runCommand("afplay", ["-r", String(rate), filePath]);
    } else if (platform === "linux") {
      // Use ffplay on Linux (from ffmpeg)
      await this.runCommand("ffplay", [
        "-nodisp", "-autoexit", "-af", `atempo=${speedMult}`, filePath,
      ]);
    } else {
      // Simulate playback duration
      const wordCount = 30; // rough estimate
      await new Promise(resolve => setTimeout(resolve, (wordCount * 150) / speedMult));
    }
  }

  private runCommand(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: "pipe" });
      this.currentProcess = proc;

      proc.on("close", (code) => {
        this.currentProcess = null;
        if (code === 0 || code === null) resolve();
        else reject(new Error(`${cmd} exited with code ${code}`));
      });

      proc.on("error", (err) => {
        this.currentProcess = null;
        reject(err);
      });
    });
  }

  // ── Private: Voice Adjustment ─────────────────────

  private adjustVoice(emotion: Emotion, speed: string): VoiceConfig {
    const base = { ...this.voiceConfig };
    const emotionAdj = EMOTION_ADJUSTMENTS[emotion] ?? {};
    const speedMult = SPEED_MULT[speed] ?? 1.0;

    if (emotionAdj.stability !== undefined) {
      base.stability = Math.max(0, Math.min(1, base.stability + emotionAdj.stability));
    }
    if (emotionAdj.speedMult !== undefined) {
      base.baseSpeed *= emotionAdj.speedMult;
    }
    base.baseSpeed *= speedMult;

    return base;
  }

  // ── Private: Helpers ──────────────────────────────

  private nextAudioPath(ext: string): string {
    return join(this.audioDir, `commentary-${++this.audioIndex}.${ext}`);
  }

  private severityToPriority(severity: Severity): number {
    const map: Record<Severity, number> = {
      routine: 0, notable: 1, exciting: 2, critical: 3, legendary: 4,
    };
    return map[severity] ?? 0;
  }
}
