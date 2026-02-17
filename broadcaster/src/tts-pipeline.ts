/**
 * TTS Pipeline — converts commentary text to speech via ElevenLabs.
 * 
 * Uses the streaming API for lowest latency (eleven_turbo_v2).
 * Routes audio to a virtual audio device (BlackHole on macOS) so OBS can capture it.
 * 
 * Handles priority queuing — critical events can interrupt routine commentary.
 */

import { CommentaryChunk } from "./commentary-gen.js";
import { CommentaryStyle } from "./commentary-gen.js";

interface VoiceProfile {
  voiceId: string;
  name: string;
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
}

// Voice profiles tuned for each commentary style
const VOICE_PROFILES: Record<CommentaryStyle, VoiceProfile> = {
  esports: {
    voiceId: "pNInz6obpgDQGcFmaJgB",   // Adam — energetic
    name: "Adam",
    stability: 0.3,                       // Low = more expressive
    similarityBoost: 0.8,
    style: 0.7,
    speed: 1.15,
  },
  war_correspondent: {
    voiceId: "VR6AewLTigWG4xSOukaG",    // Arnold — deep, serious
    name: "Arnold",
    stability: 0.6,
    similarityBoost: 0.9,
    style: 0.3,
    speed: 0.95,
  },
  skippy_trash_talk: {
    voiceId: "EXAVITQu4vr4xnSDxMaL",    // Bella — sardonic
    name: "Bella",
    stability: 0.25,                      // Maximum expression
    similarityBoost: 0.7,
    style: 0.8,
    speed: 1.1,
  },
  documentary: {
    voiceId: "onwK4e9ZLuTAKqWW03F9",    // Daniel — British, measured
    name: "Daniel",
    stability: 0.75,                      // Calm and consistent
    similarityBoost: 0.95,
    style: 0.2,
    speed: 0.9,
  },
};

// Emotion adjustments to voice parameters
const EMOTION_ADJUSTMENTS: Record<string, Partial<VoiceProfile>> = {
  excited:  { stability: -0.15, speed: 1.2 },
  panicked: { stability: -0.2,  speed: 1.3 },
  tense:    { stability: -0.1,  speed: 1.05 },
  somber:   { stability: 0.1,   speed: 0.85 },
  smug:     { stability: -0.1,  speed: 0.95 },
  awed:     { stability: 0.05,  speed: 0.9 },
  neutral:  {},
  frantic:  { stability: -0.2,  speed: 1.35 },
};

interface QueuedAudio {
  chunk: CommentaryChunk;
  priority: number;
  timestamp: number;
}

export class TTSPipeline {
  private profile: VoiceProfile;
  private queue: QueuedAudio[] = [];
  private isPlaying = false;
  private currentPriority = 0;
  
  constructor(style: CommentaryStyle) {
    this.profile = VOICE_PROFILES[style];
    console.error(`🔊 TTS initialized — Voice: ${this.profile.name} (${style})`);
  }
  
  async speak(chunk: CommentaryChunk): Promise<void> {
    const priority = this.severityToPriority(chunk.priority);
    
    // If this is higher priority than what's currently playing, interrupt
    if (this.isPlaying && priority > this.currentPriority + 1) {
      console.error(`⚡ Interrupting for ${chunk.priority} event!`);
      this.interrupt();
    }
    
    this.queue.push({
      chunk,
      priority,
      timestamp: Date.now(),
    });
    
    // Sort queue by priority (highest first)
    this.queue.sort((a, b) => b.priority - a.priority);
    
    if (!this.isPlaying) {
      await this.playNext();
    }
  }
  
  private async playNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      return;
    }
    
    const item = this.queue.shift()!;
    this.isPlaying = true;
    this.currentPriority = item.priority;
    
    try {
      // Apply emotion adjustments
      const settings = this.adjustForEmotion(item.chunk.emotion);
      
      console.error(`🎙️  [${item.chunk.priority}] "${item.chunk.text}"`);
      
      // In production: call ElevenLabs streaming API
      // For now: use the OpenClaw TTS skill (sag) or log to console
      await this.synthesize(item.chunk.text, settings);
      
    } catch (e) {
      console.error(`TTS error: ${e}`);
    }
    
    // Play next in queue
    await this.playNext();
  }
  
  private async synthesize(text: string, settings: VoiceProfile): Promise<void> {
    // TODO: Implement ElevenLabs streaming API call
    // For MVP, write audio to a file that OBS monitors, or use system TTS
    
    // ElevenLabs streaming pseudocode:
    // const stream = await elevenlabs.textToSpeech.stream({
    //   voice_id: settings.voiceId,
    //   text: text,
    //   model_id: "eleven_turbo_v2",
    //   voice_settings: {
    //     stability: settings.stability,
    //     similarity_boost: settings.similarityBoost,
    //     style: settings.style,
    //     use_speaker_boost: true,
    //   },
    // });
    //
    // // Pipe to virtual audio device
    // stream.pipe(audioDevice);
    
    // Simulate TTS duration (~150ms per word)
    const wordCount = text.split(/\s+/).length;
    const durationMs = wordCount * 150 / settings.speed;
    await new Promise(resolve => setTimeout(resolve, durationMs));
  }
  
  private adjustForEmotion(emotion: string): VoiceProfile {
    const base = { ...this.profile };
    const adj = EMOTION_ADJUSTMENTS[emotion] ?? {};
    
    if (adj.stability) base.stability = Math.max(0, Math.min(1, base.stability + adj.stability));
    if (adj.speed) base.speed *= adj.speed;
    
    return base;
  }
  
  private interrupt(): void {
    // Cancel current playback and clear lower-priority items
    this.queue = this.queue.filter(q => q.priority >= this.currentPriority);
    this.isPlaying = false;
  }
  
  private severityToPriority(severity: string): number {
    const map: Record<string, number> = {
      routine: 0, notable: 1, major: 2, critical: 3, legendary: 4,
    };
    return map[severity] ?? 0;
  }
}
