/**
 * Commentary Generator — uses Claude to produce style-appropriate live commentary.
 *
 * Uses Sonnet for speed (sub-500ms responses for live commentary feel).
 * Pulls style definitions from styles/ for system prompts, voice config, pacing.
 * Manages context window to maintain narrative continuity across the match.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  CommentaryStyle,
  CommentaryChunk,
  Emotion,
  SpeechSpeed,
  Severity,
  GameEvent,
  GameState,
  GamePhase,
  EventType,
  StyleDefinition,
} from "./types.js";
import { getStyle } from "./styles/index.js";

// ── Pacing ──────────────────────────────────────────

const SEVERITY_RANK: Record<Severity, number> = {
  routine: 0, notable: 1, exciting: 2, critical: 3, legendary: 4,
};

// ── Main Class ──────────────────────────────────────

export class CommentaryGenerator {
  private style: StyleDefinition;
  private client: Anthropic;
  private recentCommentary: Array<{ text: string; tick: number; eventType?: EventType }> = [];
  private lastCommentaryTick = 0;
  private consecutiveRoutine = 0;
  private matchIntroGenerated = false;
  private matchOutroGenerated = false;
  private lastLegendaryTick = 0;

  constructor(styleName: CommentaryStyle) {
    this.style = getStyle(styleName);
    this.client = new Anthropic();
    console.error(`📝 Commentary engine: ${this.style.displayName}`);
  }

  /**
   * Generate commentary for detected events in the current game state.
   * Returns an array of commentary chunks ready for TTS.
   */
  async generate(events: GameEvent[], state: GameState): Promise<CommentaryChunk[]> {
    const chunks: CommentaryChunk[] = [];

    // Sort by severity (most important first)
    const sorted = [...events].sort(
      (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
    );

    for (const event of sorted) {
      // Pacing checks
      if (!this.shouldComment(event, state.tick)) continue;

      const text = await this.generateForEvent(event, state);
      if (!text) continue;

      const chunk = this.buildChunk(text, event, state.tick);
      chunks.push(chunk);

      this.recordCommentary(text, state.tick, event.type);

      // Only generate for the top 2 events per update to avoid flooding
      if (chunks.length >= 2) break;
    }

    // Filler commentary during silence
    if (events.length === 0 && this.shouldGenerateFiller(state.tick)) {
      const filler = await this.generateFiller(state);
      if (filler) {
        chunks.push({
          text: filler,
          priority: "routine",
          emotion: "neutral",
          speed: "normal",
          tick: state.tick,
        });
        this.recordCommentary(filler, state.tick);
      }
    }

    return chunks;
  }

  /**
   * Generate pre-match intro commentary.
   */
  async generateMatchIntro(state: GameState): Promise<CommentaryChunk | null> {
    if (this.matchIntroGenerated) return null;
    this.matchIntroGenerated = true;

    const players = Object.entries(state.players);
    const playerDescriptions = players.map(([name, p]) =>
      `${name} (${p.faction})`).join(" vs ");

    const prompt = `MATCH INTRO — Generate an exciting pre-match introduction!

Players: ${playerDescriptions}
Map: ${state.mapName ?? "Unknown Battlefield"}

This is the opening of the broadcast. Set the stage. Introduce the players. Build anticipation.
3-5 sentences. Make the audience EXCITED for what's about to happen.`;

    const text = await this.callClaude(prompt);
    if (!text) return null;

    return {
      text,
      priority: "legendary",
      emotion: "excited",
      speed: "normal",
      tick: state.tick,
      eventType: EventType.GAME_START,
    };
  }

  /**
   * Generate post-match wrap-up commentary.
   */
  async generateMatchOutro(state: GameState): Promise<CommentaryChunk | null> {
    if (this.matchOutroGenerated) return null;
    this.matchOutroGenerated = true;

    const players = Object.entries(state.players);
    const prompt = `MATCH OVER! Generate a post-match wrap-up.

Winner: ${state.winner ?? "Unknown"}
Final state:
${players.map(([name, p]) =>
  `  ${name}: ${p.unitCount} units, ${p.buildingCount} buildings, ${p.kills} kills, ${p.isAlive ? "ALIVE" : "ELIMINATED"}`
).join("\n")}

Match highlights from commentary:
${this.recentCommentary.slice(-8).map(c => `  - "${c.text}"`).join("\n")}

Summarize the match. Celebrate the winner. Acknowledge the loser's efforts.
3-5 sentences. Make it a proper sign-off.`;

    const text = await this.callClaude(prompt);
    if (!text) return null;

    return {
      text,
      priority: "legendary",
      emotion: "awed",
      speed: "slow",
      tick: state.tick,
      eventType: EventType.GAME_END,
    };
  }

  // ── Private methods ─────────────────────────────────

  private shouldComment(event: GameEvent, tick: number): boolean {
    const pacing = this.style.pacing;
    const gap = tick - this.lastCommentaryTick;

    // Respect minimum gaps per severity
    if (gap < pacing.minGapTicks[event.severity]) return false;

    // Cooldown after legendary moments
    if (tick - this.lastLegendaryTick < pacing.cooldownAfterLegendary
        && event.severity !== "legendary") {
      return false;
    }

    // Limit consecutive routine commentary
    if (event.severity === "routine"
        && this.consecutiveRoutine >= pacing.maxConsecutiveRoutine) {
      return false;
    }

    return true;
  }

  private shouldGenerateFiller(tick: number): boolean {
    return (tick - this.lastCommentaryTick) > this.style.pacing.maxSilenceTicks;
  }

  private async generateForEvent(event: GameEvent, state: GameState): Promise<string | null> {
    const gameTime = this.ticksToTime(state.tick);
    const playerSummaries = Object.entries(state.players).map(([name, p]) =>
      `  ${name} (${p.faction}): ${p.credits} credits, ${p.unitCount} units, ${p.buildingCount} buildings, ${p.kills} kills${p.isAlive ? "" : " [ELIMINATED]"}`
    ).join("\n");

    const prompt = `GAME STATE:
- Time: ${gameTime} elapsed (phase: ${event.phase})
- Players:
${playerSummaries}
${state.isGameOver ? `- GAME IS OVER — Winner: ${state.winner ?? "unknown"}` : ""}

EVENT (${event.severity.toUpperCase()} — ${event.type}):
${event.description}
Players involved: ${event.playersInvolved.join(", ") || "none"}
Context: ${JSON.stringify(event.context)}

RECENT COMMENTARY (avoid repetition):
${this.recentCommentary.slice(-5).map(c => `- "${c.text}"`).join("\n") || "  (none yet)"}

Generate a single commentary line for this event. 1-3 sentences MAX. Make it punchy and match the ${event.severity} energy level.`;

    return this.callClaude(prompt);
  }

  private async generateFiller(state: GameState): Promise<string | null> {
    const gameTime = this.ticksToTime(state.tick);
    const playerSummaries = Object.entries(state.players).map(([name, p]) =>
      `  ${name}: ${p.credits} credits, ${p.unitCount} units`
    ).join("\n");

    const prompt = `GAME STATE:
- Time: ${gameTime} elapsed
- Players:
${playerSummaries}

Nothing dramatic has happened for a while. Generate brief "color commentary" — analyze the strategic situation, make a prediction, or fill the silence with atmosphere.
1-2 sentences MAX.

RECENT (don't repeat):
${this.recentCommentary.slice(-3).map(c => `- "${c.text}"`).join("\n") || "  (none yet)"}`;

    return this.callClaude(prompt);
  }

  private async callClaude(prompt: string): Promise<string | null> {
    try {
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 200,
        system: this.style.systemPrompt,
        messages: [{ role: "user", content: prompt }],
      });

      const block = response.content[0];
      if (block.type === "text") return block.text.trim();
      return null;
    } catch (e) {
      console.error("Commentary generation error:", e);
      return null;
    }
  }

  private buildChunk(text: string, event: GameEvent, tick: number): CommentaryChunk {
    const emotion = this.style.emotionMap[event.type] ?? this.defaultEmotion(event);
    const speed = this.style.speedMap[event.severity] ?? this.defaultSpeed(event);

    return {
      text,
      priority: event.severity,
      emotion,
      speed,
      tick,
      eventType: event.type,
    };
  }

  private defaultEmotion(event: GameEvent): Emotion {
    switch (event.severity) {
      case "legendary": return "awed";
      case "critical": return "excited";
      case "exciting": return "excited";
      case "notable": return "neutral";
      case "routine": return "neutral";
    }
  }

  private defaultSpeed(event: GameEvent): SpeechSpeed {
    switch (event.severity) {
      case "legendary": return "frantic";
      case "critical": return "fast";
      case "exciting": return "fast";
      case "notable": return "normal";
      case "routine": return "slow";
    }
  }

  private recordCommentary(text: string, tick: number, eventType?: EventType): void {
    this.recentCommentary.push({ text, tick, eventType });
    if (this.recentCommentary.length > 20) this.recentCommentary.shift();

    this.lastCommentaryTick = tick;

    if (eventType) {
      // Track consecutive routine for pacing
      const event = this.recentCommentary[this.recentCommentary.length - 1];
      // Simple heuristic: routine if it wasn't an exciting+ event
      this.consecutiveRoutine++;
    } else {
      this.consecutiveRoutine++;
    }

    // Reset consecutive routine counter on non-routine events
    if (eventType === EventType.MAJOR_BATTLE || eventType === EventType.SUPERWEAPON_LAUNCHED
        || eventType === EventType.GAME_END || eventType === EventType.FIRST_CONTACT) {
      this.consecutiveRoutine = 0;
      this.lastLegendaryTick = tick;
    }
  }

  private ticksToTime(ticks: number): string {
    const totalSeconds = Math.floor(ticks / 25);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
}
