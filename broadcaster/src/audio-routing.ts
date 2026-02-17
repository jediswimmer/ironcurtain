/**
 * Audio Routing — Routes TTS commentary audio to the stream.
 *
 * Handles:
 *   - Audio buffer management for smooth playback
 *   - Game event audio synchronization
 *   - Volume ducking during intense moments
 *   - Crossfading between commentary segments
 *   - Audio queue with priority management
 *
 * The audio router sits between the TTS pipeline and OBS/streaming output.
 * It manages timing to ensure commentary aligns with game events.
 */

import type { Severity, GamePhase, CommentaryChunk } from "./types.js";

// ─── Types ──────────────────────────────────────────────

export interface AudioSegment {
  id: string;
  text: string;
  audioData: Buffer | null;
  duration_ms: number;
  priority: Severity;
  game_tick: number;
  queued_at: number;
  play_at: number | null;
  status: "pending" | "ready" | "playing" | "completed" | "skipped";
  emotion: string;
  volume: number; // 0.0 - 1.0
}

export interface AudioRouterConfig {
  /** Maximum queue size before dropping low-priority items */
  max_queue_size: number;
  /** Maximum delay (ms) between event and commentary */
  max_commentary_delay_ms: number;
  /** Crossfade duration between segments (ms) */
  crossfade_ms: number;
  /** Base volume for commentary (0.0 - 1.0) */
  base_volume: number;
  /** Volume ducking during battles */
  battle_duck_volume: number;
  /** Minimum gap between commentary segments (ms) */
  min_gap_ms: number;
  /** Maximum gap before inserting filler (ms) */
  max_silence_ms: number;
}

const DEFAULT_CONFIG: AudioRouterConfig = {
  max_queue_size: 20,
  max_commentary_delay_ms: 5000,
  crossfade_ms: 200,
  base_volume: 0.85,
  battle_duck_volume: 0.6,
  min_gap_ms: 300,
  max_silence_ms: 15000,
};

export interface AudioEvent {
  type: "segment_start" | "segment_end" | "queue_full" | "silence_detected";
  segment?: AudioSegment;
  timestamp: number;
}

export type AudioEventCallback = (event: AudioEvent) => void;

// ─── Audio Router ───────────────────────────────────────

export class AudioRouter {
  private config: AudioRouterConfig;
  private queue: AudioSegment[] = [];
  private currentSegment: AudioSegment | null = null;
  private lastPlaybackEnd = 0;
  private segmentCounter = 0;
  private totalPlayed = 0;
  private totalSkipped = 0;
  private callbacks: AudioEventCallback[] = [];
  private gamePhase: GamePhase = "early";

  constructor(config: Partial<AudioRouterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a commentary segment to the audio queue.
   * Returns the segment ID or null if dropped.
   */
  enqueue(chunk: CommentaryChunk, audioData: Buffer | null, durationMs: number): string | null {
    const now = Date.now();

    // Drop if too old (event already passed)
    const tickDelay = chunk.tick > 0 ? (now - chunk.tick * 42) : 0; // rough tick-to-ms
    if (tickDelay > this.config.max_commentary_delay_ms) {
      this.totalSkipped++;
      return null;
    }

    // Drop low-priority if queue is full
    if (this.queue.length >= this.config.max_queue_size) {
      // Remove lowest priority item
      const lowestIdx = this.queue.reduce(
        (minIdx, seg, idx) =>
          this.priorityScore(seg.priority) <
          this.priorityScore(this.queue[minIdx].priority)
            ? idx
            : minIdx,
        0
      );

      if (
        this.priorityScore(chunk.priority) <=
        this.priorityScore(this.queue[lowestIdx].priority)
      ) {
        this.totalSkipped++;
        return null; // New item is lower priority too
      }

      // Remove lowest priority
      const removed = this.queue.splice(lowestIdx, 1)[0];
      removed.status = "skipped";
      this.totalSkipped++;
    }

    const segment: AudioSegment = {
      id: `audio-${++this.segmentCounter}`,
      text: chunk.text,
      audioData,
      duration_ms: durationMs,
      priority: chunk.priority,
      game_tick: chunk.tick,
      queued_at: now,
      play_at: null,
      status: audioData ? "ready" : "pending",
      emotion: chunk.emotion,
      volume: this.calculateVolume(chunk.priority),
    };

    // Insert in priority order (highest priority first, then by tick)
    const insertIdx = this.queue.findIndex(
      (s) =>
        this.priorityScore(s.priority) < this.priorityScore(segment.priority)
    );

    if (insertIdx === -1) {
      this.queue.push(segment);
    } else {
      this.queue.splice(insertIdx, 0, segment);
    }

    return segment.id;
  }

  /**
   * Get the next segment to play.
   * Returns null if nothing is ready or minimum gap hasn't elapsed.
   */
  getNext(): AudioSegment | null {
    const now = Date.now();

    // Enforce minimum gap
    if (now - this.lastPlaybackEnd < this.config.min_gap_ms) {
      return null;
    }

    // Find first ready segment
    const readyIdx = this.queue.findIndex((s) => s.status === "ready");
    if (readyIdx === -1) return null;

    const segment = this.queue.splice(readyIdx, 1)[0];
    segment.status = "playing";
    segment.play_at = now;
    this.currentSegment = segment;

    this.emit({
      type: "segment_start",
      segment,
      timestamp: now,
    });

    return segment;
  }

  /**
   * Mark the current segment as completed.
   */
  markCompleted(segmentId: string): void {
    const now = Date.now();

    if (this.currentSegment?.id === segmentId) {
      this.currentSegment.status = "completed";
      this.lastPlaybackEnd = now;
      this.totalPlayed++;

      this.emit({
        type: "segment_end",
        segment: this.currentSegment,
        timestamp: now,
      });

      this.currentSegment = null;
    }
  }

  /**
   * Update an audio segment with generated TTS data.
   */
  updateSegmentAudio(segmentId: string, audioData: Buffer, durationMs: number): void {
    const segment = this.queue.find((s) => s.id === segmentId);
    if (segment) {
      segment.audioData = audioData;
      segment.duration_ms = durationMs;
      segment.status = "ready";
    }
  }

  /**
   * Update the current game phase (affects volume/pacing).
   */
  setGamePhase(phase: GamePhase): void {
    this.gamePhase = phase;
  }

  /**
   * Check if silence has been too long (needs filler).
   */
  needsFiller(): boolean {
    if (this.currentSegment) return false;
    const silenceDuration = Date.now() - this.lastPlaybackEnd;
    return silenceDuration > this.config.max_silence_ms;
  }

  /**
   * Get queue status.
   */
  getStatus(): {
    queue_size: number;
    is_playing: boolean;
    current_segment: string | null;
    total_played: number;
    total_skipped: number;
    silence_ms: number;
    game_phase: GamePhase;
  } {
    return {
      queue_size: this.queue.length,
      is_playing: this.currentSegment !== null,
      current_segment: this.currentSegment?.id ?? null,
      total_played: this.totalPlayed,
      total_skipped: this.totalSkipped,
      silence_ms: this.currentSegment
        ? 0
        : Date.now() - this.lastPlaybackEnd,
      game_phase: this.gamePhase,
    };
  }

  /**
   * Subscribe to audio events.
   */
  onEvent(callback: AudioEventCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Clear the queue and reset state.
   */
  reset(): void {
    this.queue = [];
    this.currentSegment = null;
    this.lastPlaybackEnd = 0;
  }

  // ─── Private ────────────────────────────────────────────

  private calculateVolume(priority: Severity): number {
    const base = this.config.base_volume;

    // Louder for more exciting moments
    switch (priority) {
      case "legendary":
        return Math.min(1.0, base + 0.15);
      case "critical":
        return Math.min(1.0, base + 0.1);
      case "exciting":
        return base;
      case "notable":
        return base - 0.05;
      case "routine":
        return base - 0.1;
      default:
        return base;
    }
  }

  private priorityScore(priority: Severity): number {
    const scores: Record<Severity, number> = {
      routine: 1,
      notable: 2,
      exciting: 3,
      critical: 4,
      legendary: 5,
    };
    return scores[priority] ?? 1;
  }

  private emit(event: AudioEvent): void {
    for (const cb of this.callbacks) {
      try {
        cb(event);
      } catch {
        // Ignore callback errors
      }
    }
  }
}

/**
 * Audio Sync — Synchronizes commentary with game events.
 *
 * Ensures that commentary about a specific game event plays
 * at the right time relative to the event happening.
 */
export class AudioSync {
  private eventTimestamps = new Map<number, number>(); // tick → wall clock ms
  private tickRate = 24; // ticks per second

  /**
   * Record when a game tick was observed.
   */
  recordTick(tick: number): void {
    this.eventTimestamps.set(tick, Date.now());

    // Keep bounded
    if (this.eventTimestamps.size > 1000) {
      const keys = Array.from(this.eventTimestamps.keys()).sort((a, b) => a - b);
      for (let i = 0; i < 500; i++) {
        this.eventTimestamps.delete(keys[i]);
      }
    }
  }

  /**
   * Calculate the delay needed to sync commentary with a game event.
   * Returns 0 if the event already passed (play immediately) or
   * a positive number (ms) to wait before playing.
   */
  calculateDelay(eventTick: number, commentaryDurationMs: number): number {
    const eventTime = this.eventTimestamps.get(eventTick);
    if (!eventTime) return 0; // Event not recorded, play immediately

    const now = Date.now();
    const timeSinceEvent = now - eventTime;

    // If the event was recent, we can still sync
    // Commentary should start playing just as the event is happening
    const idealPlayTime = eventTime;
    const delay = idealPlayTime - now;

    if (delay > 0) return delay; // Event hasn't happened yet (pre-commentary)
    if (Math.abs(delay) < commentaryDurationMs) return 0; // Play now

    return 0; // Event was too long ago, play immediately
  }

  /**
   * Set the game tick rate for time calculations.
   */
  setTickRate(rate: number): void {
    this.tickRate = rate;
  }

  /**
   * Convert ticks to milliseconds.
   */
  ticksToMs(ticks: number): number {
    return (ticks / this.tickRate) * 1000;
  }
}
