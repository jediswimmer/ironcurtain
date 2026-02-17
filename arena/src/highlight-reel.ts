/**
 * Highlight Reel Auto-Generation — Creates match highlights from event data.
 *
 * Analyzes match events to identify the most exciting moments:
 *   - Major battles (high unit count engagements)
 *   - Clutch defenses (narrowly saved bases)
 *   - Economic raids (harvester kills, refinery destruction)
 *   - Tech unlocks (superweapon construction, tech center)
 *   - Comebacks (winning from behind)
 *   - Game-ending pushes
 *
 * Outputs a structured highlight timeline that can be used by:
 *   - The web portal (timeline markers on replay viewer)
 *   - The broadcaster (commentary emphasis)
 *   - Social media (auto-generated highlight clips)
 */

// ─── Types ──────────────────────────────────────────────

export type HighlightType =
  | "major_battle"
  | "base_under_attack"
  | "base_destroyed"
  | "tech_unlock"
  | "superweapon"
  | "economic_raid"
  | "comeback"
  | "clutch_defense"
  | "first_blood"
  | "game_ending_push"
  | "mass_production"
  | "hero_play";

export interface Highlight {
  id: string;
  type: HighlightType;
  title: string;
  description: string;
  start_tick: number;
  end_tick: number;
  duration_ticks: number;
  excitement_score: number; // 0-100
  players_involved: string[];
  key_units: string[];
  thumbnail_tick: number; // Best tick for a thumbnail
  tags: string[];
}

export interface HighlightReel {
  match_id: string;
  total_ticks: number;
  total_duration_secs: number;
  highlights: Highlight[];
  top_moment: Highlight | null;
  excitement_curve: ExcitementPoint[];
  summary: string;
}

export interface ExcitementPoint {
  tick: number;
  score: number;
  label?: string;
}

export interface MatchEvent {
  tick: number;
  type: string;
  agent_id?: string;
  data: Record<string, unknown>;
}

// ─── Highlight Generator ────────────────────────────────

export class HighlightGenerator {
  /**
   * Generate a highlight reel from match events.
   */
  generate(
    matchId: string,
    events: MatchEvent[],
    totalTicks: number,
    players: Array<{ agent_id: string; agent_name: string }>
  ): HighlightReel {
    const highlights: Highlight[] = [];
    const excitementCurve: ExcitementPoint[] = [];
    let highlightCounter = 0;

    // Sort events by tick
    const sorted = [...events].sort((a, b) => a.tick - b.tick);

    // State tracking
    let maxArmyValue = 0;
    const playerCredits = new Map<string, number>();
    const playerUnits = new Map<string, number>();
    let lastBattleTick = 0;

    for (const event of sorted) {
      const excitement = this.scoreEvent(event, {
        maxArmyValue,
        playerCredits,
        playerUnits,
        totalTicks,
        lastBattleTick,
      });

      if (excitement > 0) {
        excitementCurve.push({
          tick: event.tick,
          score: excitement,
          label: event.type,
        });
      }

      // Update state tracking
      if (event.data.credits !== undefined) {
        playerCredits.set(event.agent_id ?? "", event.data.credits as number);
      }
      if (event.data.unit_count !== undefined) {
        playerUnits.set(event.agent_id ?? "", event.data.unit_count as number);
      }

      // Detect highlights
      const highlight = this.detectHighlight(
        event,
        excitement,
        players,
        totalTicks,
        ++highlightCounter
      );

      if (highlight) {
        highlights.push(highlight);
      }

      if (event.type === "battle" || event.type === "major_battle") {
        lastBattleTick = event.tick;
      }
    }

    // Merge overlapping highlights
    const merged = this.mergeHighlights(highlights);

    // Sort by excitement
    merged.sort((a, b) => b.excitement_score - a.excitement_score);

    // Take top 10
    const top = merged.slice(0, 10);

    // Generate summary
    const summary = this.generateSummary(top, players, totalTicks);

    return {
      match_id: matchId,
      total_ticks: totalTicks,
      total_duration_secs: Math.round(totalTicks / 24),
      highlights: top,
      top_moment: top[0] ?? null,
      excitement_curve: this.smoothCurve(excitementCurve),
      summary,
    };
  }

  // ─── Event Scoring ────────────────────────────────────

  private scoreEvent(
    event: MatchEvent,
    context: {
      maxArmyValue: number;
      playerCredits: Map<string, number>;
      playerUnits: Map<string, number>;
      totalTicks: number;
      lastBattleTick: number;
    }
  ): number {
    let score = 0;

    switch (event.type) {
      case "game_started":
        score = 20;
        break;
      case "game_ended":
        score = 90;
        break;
      case "unit_destroyed":
        score = 10;
        break;
      case "building_complete":
        score = 5;
        break;
      case "building_destroyed":
        score = 40;
        break;
      case "under_attack":
        score = 30;
        break;
      case "production_complete":
        score = 3;
        break;
      case "battle":
        score = 35;
        break;
      case "major_battle":
        score = 70;
        break;
      case "massacre":
        score = 85;
        break;
      case "base_breach":
        score = 75;
        break;
      case "conyard_lost":
        score = 90;
        break;
      case "superweapon_building":
        score = 40;
        break;
      case "superweapon_ready":
        score = 60;
        break;
      case "superweapon_launched":
        score = 95;
        break;
      case "tech_center_built":
        score = 25;
        break;
      case "comeback":
        score = 80;
        break;
      case "all_in":
        score = 65;
        break;
      default:
        score = 5;
    }

    // Late-game events are more exciting
    const gameProgress = event.tick / context.totalTicks;
    if (gameProgress > 0.7) {
      score *= 1.3;
    }

    // Events after long silence are more exciting
    const ticksSinceAction = event.tick - context.lastBattleTick;
    if (ticksSinceAction > 1000 && score > 20) {
      score *= 1.2; // The calm before the storm
    }

    return Math.min(100, Math.round(score));
  }

  // ─── Highlight Detection ──────────────────────────────

  private detectHighlight(
    event: MatchEvent,
    excitement: number,
    players: Array<{ agent_id: string; agent_name: string }>,
    totalTicks: number,
    counter: number
  ): Highlight | null {
    // Only create highlights for significant events
    if (excitement < 30) return null;

    const playerName = (id: string) =>
      players.find((p) => p.agent_id === id)?.agent_name ?? id;

    const agentId = event.agent_id ?? "";
    const name = playerName(agentId);
    const data = event.data;

    let type: HighlightType;
    let title: string;
    let description: string;
    let tags: string[] = [];
    let keyUnits: string[] = [];

    switch (event.type) {
      case "major_battle":
      case "massacre":
        type = "major_battle";
        title = "Massive Engagement!";
        description = `A huge battle erupted with ${data.units_involved ?? "many"} units fighting`;
        tags = ["combat", "battle", "action"];
        break;

      case "base_breach":
        type = "base_under_attack";
        title = `${name}'s Base Breached!`;
        description = `Enemy forces broke through ${name}'s defenses`;
        tags = ["attack", "base", "defense"];
        break;

      case "conyard_lost":
        type = "base_destroyed";
        title = `${name} Loses Construction Yard!`;
        description = `Critical loss — ${name}'s Construction Yard has been destroyed`;
        tags = ["critical", "base", "loss"];
        break;

      case "superweapon_launched":
        type = "superweapon";
        title = "SUPERWEAPON FIRED!";
        description = `${name} launched ${(data.weapon_type as string) ?? "a superweapon"}!`;
        tags = ["superweapon", "dramatic", "nuke"];
        keyUnits = [(data.weapon_type as string) ?? "superweapon"];
        break;

      case "comeback":
        type = "comeback";
        title = "COMEBACK!";
        description = `${name} stages an incredible comeback from behind!`;
        tags = ["comeback", "dramatic", "turnaround"];
        break;

      case "all_in":
        type = "game_ending_push";
        title = "ALL-IN PUSH!";
        description = `${name} sends everything for the final attack!`;
        tags = ["attack", "all-in", "final"];
        break;

      case "game_ended":
        type = "game_ending_push";
        title = "GAME OVER";
        const winnerId = data.winner_id as string;
        description = winnerId
          ? `${playerName(winnerId)} wins the match!`
          : "The match ends in a draw";
        tags = ["game-end", "result"];
        break;

      default:
        if (excitement >= 50) {
          type = "major_battle";
          title = "Intense Moment";
          description = `${event.type}: ${name}`;
          tags = [event.type];
        } else {
          return null;
        }
    }

    const HIGHLIGHT_WINDOW = 120; // 5 seconds of highlight

    return {
      id: `hl-${counter}`,
      type,
      title,
      description,
      start_tick: Math.max(0, event.tick - HIGHLIGHT_WINDOW / 2),
      end_tick: Math.min(totalTicks, event.tick + HIGHLIGHT_WINDOW / 2),
      duration_ticks: HIGHLIGHT_WINDOW,
      excitement_score: excitement,
      players_involved: agentId ? [agentId] : players.map((p) => p.agent_id),
      key_units: keyUnits,
      thumbnail_tick: event.tick,
      tags,
    };
  }

  // ─── Merging & Smoothing ──────────────────────────────

  private mergeHighlights(highlights: Highlight[]): Highlight[] {
    if (highlights.length <= 1) return highlights;

    const sorted = [...highlights].sort(
      (a, b) => a.start_tick - b.start_tick
    );
    const merged: Highlight[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = sorted[i];

      // Merge if overlapping
      if (curr.start_tick <= prev.end_tick) {
        prev.end_tick = Math.max(prev.end_tick, curr.end_tick);
        prev.duration_ticks = prev.end_tick - prev.start_tick;
        prev.excitement_score = Math.max(
          prev.excitement_score,
          curr.excitement_score
        );

        // Keep the more exciting title
        if (curr.excitement_score > prev.excitement_score) {
          prev.title = curr.title;
          prev.description = curr.description;
          prev.type = curr.type;
        }

        // Merge players and tags
        prev.players_involved = [
          ...new Set([...prev.players_involved, ...curr.players_involved]),
        ];
        prev.tags = [...new Set([...prev.tags, ...curr.tags])];
      } else {
        merged.push(curr);
      }
    }

    return merged;
  }

  private smoothCurve(points: ExcitementPoint[]): ExcitementPoint[] {
    if (points.length <= 2) return points;

    // Simple moving average smoothing
    const smoothed: ExcitementPoint[] = [];
    const window = 3;

    for (let i = 0; i < points.length; i++) {
      const start = Math.max(0, i - Math.floor(window / 2));
      const end = Math.min(points.length, i + Math.ceil(window / 2));
      const slice = points.slice(start, end);
      const avgScore =
        slice.reduce((s, p) => s + p.score, 0) / slice.length;

      smoothed.push({
        tick: points[i].tick,
        score: Math.round(avgScore),
        label: points[i].label,
      });
    }

    return smoothed;
  }

  // ─── Summary Generation ───────────────────────────────

  private generateSummary(
    highlights: Highlight[],
    players: Array<{ agent_id: string; agent_name: string }>,
    totalTicks: number
  ): string {
    if (highlights.length === 0) {
      return "A quiet match with few notable moments.";
    }

    const durationMin = Math.round(totalTicks / 24 / 60);
    const topMoment = highlights[0];
    const battleCount = highlights.filter(
      (h) => h.type === "major_battle"
    ).length;

    const parts: string[] = [];

    parts.push(
      `A ${durationMin}-minute match between ${players.map((p) => p.agent_name).join(" and ")}.`
    );

    if (battleCount > 0) {
      parts.push(
        `${battleCount} major engagement${battleCount > 1 ? "s" : ""}.`
      );
    }

    parts.push(`Top moment: ${topMoment.title} — ${topMoment.description}.`);

    const hasComeback = highlights.some((h) => h.type === "comeback");
    if (hasComeback) {
      parts.push("Featured a dramatic comeback!");
    }

    const hasSuperweapon = highlights.some((h) => h.type === "superweapon");
    if (hasSuperweapon) {
      parts.push("A superweapon was deployed!");
    }

    return parts.join(" ");
  }
}
