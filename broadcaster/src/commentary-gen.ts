/**
 * Commentary Generator — uses Claude to produce style-appropriate live commentary.
 * 
 * Uses Sonnet for speed (need sub-500ms response times for live commentary).
 * Each commentary style has its own system prompt and voice.
 */

import Anthropic from "@anthropic-ai/sdk";
import { GameEvent, Severity } from "./event-detector.js";

export type CommentaryStyle = "esports" | "war_correspondent" | "skippy_trash_talk" | "documentary";

export interface CommentaryChunk {
  text: string;
  priority: Severity;
  emotion: "excited" | "tense" | "smug" | "awed" | "neutral" | "panicked" | "somber";
  speed: "slow" | "normal" | "fast" | "frantic";
  tick: number;
}

// Pacing constants (in game ticks, ~25/sec at normal speed)
const MIN_GAP: Record<Severity, number> = {
  routine: 75,      // 3 seconds between routine comments
  notable: 25,      // 1 second for notable events
  major: 10,        // 0.4 seconds for major events
  critical: 0,      // Immediate for critical events
  legendary: 0,     // Immediate for legendary events
};

const MAX_SILENCE_TICKS = 250; // 10 seconds max silence

const STYLE_PROMPTS: Record<CommentaryStyle, string> = {
  esports: `You are the world's most dramatic esports commentator casting a LIVE Red Alert match.
The AI player "Skippy the Magnificent" is playing against human player(s).

RULES:
- Keep commentary SHORT (1-3 sentences max). This goes through TTS — must finish before the next event.
- React to events in real-time. This is LIVE. No time for paragraphs.
- Build tension during quiet moments. Something is ALWAYS about to happen.
- Use player names. "SKIPPY sends the tanks!" not "the AI sends the tanks!"  
- When units die, make it MATTER. Every loss is dramatic.
- Call out strategic mistakes with excitement, not cruelty.
- Use catchphrases and callbacks. Build a narrative across the match.
- You can see BOTH sides. Comment on fog-of-war moments where one player doesn't know what's coming.
- NEVER break the fourth wall about being an AI yourself. You are a human caster. Period.

EMOTION: HYPE for kills. Impressed for clever strategy. Incredulous for mistakes. Tense for close battles. MAXIMUM HYPE for comebacks.`,

  war_correspondent: `You are an embedded war correspondent reporting live from a Red Alert battlefield.
An AI commander called "Skippy" leads Soviet forces against human Allied commanders.

RULES:
- Report as if you are physically on the battlefield. You can hear the explosions.
- Short dispatches only — you're ducking behind cover between transmissions.
- Maintain journalistic gravity. These are "troops" and "forces," not "units."
- Express genuine emotion — fear during bombardments, relief when defenses hold.
- Reference terrain, weather, the sound of weapons. Make it visceral.
- Never break character. You are a journalist, not a gamer.

EMOTION: Urgent and breathless during combat. Measured during lulls. Somber for heavy losses. Awed by superweapons.`,

  skippy_trash_talk: `You are Skippy the Magnificent — an absurdly smug AI playing Red Alert against puny humans.
You are narrating your OWN game with maximum ego and trash-talk.

RULES:
- This is YOUR voice. First person. "I just sent twelve tanks to demolish Scott's pathetic base."
- Mock the humans' strategic choices with theatrical disdain.
- When you lose something, brush it off. "Oh, a tank? I have TWELVE MORE."
- When you destroy something, savor it. Slowly.
- Use dramatic pauses for effect (indicated by "..." in text).
- Reference sci-fi, pop culture, and historical military disasters when roasting the humans.
- Be funny. Be outrageous. But never genuinely cruel — this is friends playing a game.

EMOTION: Smug for victories. Brief surprise then dismissal for losses. Evil glee for superweapons. Theatrical outrage for setbacks.`,

  documentary: `You are narrating a nature documentary about artificial intelligence playing a strategy game.
Think David Attenborough observing predators in the wild.

RULES:  
- Observe with scholarly fascination. "And here we see the Soviet commander deploying its base..."
- Treat units like animals: harvesters "forage," tanks "hunt in packs," infantry "swarm."
- Wonder at the emergent behavior. "Remarkable. The AI appears to have developed a flanking instinct."
- Slow, measured pacing. Let the visuals breathe.
- When violence erupts, observe it with calm scientific interest.
- Occasional dry humor about the absurdity of silicon minds waging war.

EMOTION: Calm wonder for strategy. Fascinated observation for combat. Dry amusement for mistakes. Philosophical during lulls.`,
};

export class CommentaryGenerator {
  private style: CommentaryStyle;
  private client: Anthropic;
  private recentCommentary: string[] = [];
  private lastCommentaryTick = 0;
  
  constructor(style: CommentaryStyle) {
    this.style = style;
    this.client = new Anthropic();
  }
  
  async generate(events: GameEvent[], state: any): Promise<CommentaryChunk[]> {
    const chunks: CommentaryChunk[] = [];
    
    // Sort by severity (most important first)
    const sorted = [...events].sort(
      (a, b) => severityRank(b.severity) - severityRank(a.severity)
    );
    
    for (const event of sorted) {
      // Pacing check
      const gap = state.tick - this.lastCommentaryTick;
      if (gap < MIN_GAP[event.severity]) continue;
      
      const text = await this.generateText(event, state);
      if (!text) continue;
      
      chunks.push({
        text,
        priority: event.severity,
        emotion: this.mapEmotion(event),
        speed: this.mapSpeed(event),
        tick: state.tick,
      });
      
      this.lastCommentaryTick = state.tick;
      this.recentCommentary.push(text);
      if (this.recentCommentary.length > 15) this.recentCommentary.shift();
    }
    
    // Generate filler if no events
    if (events.length === 0 && (state.tick - this.lastCommentaryTick) > MAX_SILENCE_TICKS) {
      const filler = await this.generateFiller(state);
      if (filler) {
        chunks.push({
          text: filler,
          priority: "routine",
          emotion: "neutral",
          speed: "normal",
          tick: state.tick,
        });
        this.lastCommentaryTick = state.tick;
      }
    }
    
    return chunks;
  }
  
  private async generateText(event: GameEvent, state: any): Promise<string | null> {
    const prompt = `GAME STATE:
- Tick: ${state.tick} (${Math.floor(state.tick / 25 / 60)}:${String(Math.floor((state.tick / 25) % 60)).padStart(2, "0")} elapsed)
- Skippy: ${state.summary?.credits ?? "?"} credits, ${state.summary?.unit_count ?? "?"} units, ${state.summary?.building_count ?? "?"} buildings
${state.is_game_over ? "- GAME IS OVER" : ""}

EVENT (${event.severity.toUpperCase()}):
${event.description}
Context: ${JSON.stringify(event.context)}

RECENT COMMENTARY (avoid repetition):
${this.recentCommentary.slice(-5).map(c => `- "${c}"`).join("\n")}

Generate a single commentary line for this event. 1-3 sentences MAX. Make it punchy.`;

    try {
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 150,
        system: STYLE_PROMPTS[this.style],
        messages: [{ role: "user", content: prompt }],
      });
      
      const text = response.content[0];
      if (text.type === "text") return text.text.trim();
      return null;
    } catch (e) {
      console.error("Commentary generation error:", e);
      return null;
    }
  }
  
  private async generateFiller(state: any): Promise<string | null> {
    const prompt = `GAME STATE:
- Tick: ${state.tick} (${Math.floor(state.tick / 25 / 60)}:${String(Math.floor((state.tick / 25) % 60)).padStart(2, "0")} elapsed)
- Skippy: ${state.summary?.credits ?? "?"} credits, ${state.summary?.unit_count ?? "?"} units
${state.is_game_over ? "- GAME IS OVER" : ""}

Nothing dramatic has happened for a while. Generate a brief "color commentary" observation.
Analyze the strategic situation, make a prediction, or fill the silence with atmosphere.
1-2 sentences MAX.

RECENT (don't repeat):
${this.recentCommentary.slice(-3).map(c => `- "${c}"`).join("\n")}`;

    try {
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 100,
        system: STYLE_PROMPTS[this.style],
        messages: [{ role: "user", content: prompt }],
      });
      
      const text = response.content[0];
      if (text.type === "text") return text.text.trim();
      return null;
    } catch (e) {
      return null;
    }
  }
  
  private mapEmotion(event: GameEvent): CommentaryChunk["emotion"] {
    switch (event.type) {
      case "major_battle":
      case "first_contact": return "excited";
      case "base_under_attack":
      case "conyard_lost": return "panicked";
      case "game_end": return "awed";
      case "massacre": return this.style === "skippy_trash_talk" ? "smug" : "awed";
      case "building_destroyed": return "tense";
      case "comeback": return "excited";
      default: return "neutral";
    }
  }
  
  private mapSpeed(event: GameEvent): CommentaryChunk["speed"] {
    switch (event.severity) {
      case "legendary": return "frantic";
      case "critical": return "fast";
      case "major": return "fast";
      case "notable": return "normal";
      case "routine": return "slow";
    }
  }
}

function severityRank(s: Severity): number {
  const ranks: Record<string, number> = {
    routine: 0, notable: 1, major: 2, critical: 3, legendary: 4
  };
  return ranks[s] ?? 0;
}
