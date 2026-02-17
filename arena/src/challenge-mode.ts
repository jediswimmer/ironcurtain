/**
 * Human vs AI Challenge Mode — Let humans play against AI agents.
 *
 * Features:
 *   - Humans connect via standard WebSocket (same protocol as AI)
 *   - APM profile switches to "human_like" for fairness
 *   - Separate leaderboard for challenge matches
 *   - Challenge-specific rankings (humans ranked by how well they do vs AI)
 *   - No ELO impact on the AI's ranked rating
 *
 * The human player uses the exact same WebSocket protocol — they just
 * need a client that renders the game state and lets them issue orders.
 * IronCurtain's web portal could provide this, or they can use any
 * compatible client.
 */

import { nanoid } from "nanoid";
import { APM_PROFILES, type ApmProfile } from "./apm-limiter.js";

// ─── Types ──────────────────────────────────────────────

export type ChallengeStatus =
  | "waiting"
  | "connecting"
  | "playing"
  | "completed"
  | "cancelled"
  | "expired";

export interface ChallengeRequest {
  id: string;
  human_name: string;
  human_id: string;
  target_agent_id: string | null; // null = play against any AI
  target_elo_range: [number, number] | null;
  faction_preference: "allies" | "soviet" | "random";
  map_preference: string | null;
  status: ChallengeStatus;
  created_at: number;
  expires_at: number;
  match_id: string | null;
  result: ChallengeResult | null;
}

export interface ChallengeResult {
  winner: "human" | "ai" | "draw";
  human_name: string;
  ai_name: string;
  ai_elo: number;
  duration_secs: number;
  map: string;
  human_faction: string;
  ai_faction: string;
}

export interface ChallengeStats {
  total_challenges: number;
  human_wins: number;
  ai_wins: number;
  draws: number;
  human_win_rate: number;
  avg_duration_secs: number;
  hardest_ai_beaten: { name: string; elo: number } | null;
}

// ─── Challenge Mode Manager ─────────────────────────────

export class ChallengeMode {
  private challenges = new Map<string, ChallengeRequest>();
  private challengeResults: ChallengeResult[] = [];

  /** Default timeout for challenge requests (10 minutes) */
  private readonly CHALLENGE_TIMEOUT_MS = 10 * 60 * 1000;

  /**
   * Create a challenge request.
   * The human specifies which AI they want to fight (or "any").
   */
  createChallenge(opts: {
    humanName: string;
    humanId: string;
    targetAgentId?: string;
    targetEloRange?: [number, number];
    factionPreference?: "allies" | "soviet" | "random";
    mapPreference?: string;
  }): ChallengeRequest {
    const now = Date.now();
    const challenge: ChallengeRequest = {
      id: nanoid(12),
      human_name: opts.humanName,
      human_id: opts.humanId,
      target_agent_id: opts.targetAgentId ?? null,
      target_elo_range: opts.targetEloRange ?? null,
      faction_preference: opts.factionPreference ?? "random",
      map_preference: opts.mapPreference ?? null,
      status: "waiting",
      created_at: now,
      expires_at: now + this.CHALLENGE_TIMEOUT_MS,
      match_id: null,
      result: null,
    };

    this.challenges.set(challenge.id, challenge);
    console.log(
      `🎮 Challenge created: ${opts.humanName} wants to fight ` +
        `${opts.targetAgentId ?? "any AI"}`
    );

    return challenge;
  }

  /**
   * Get the APM profile for challenge mode.
   * Humans get the human_like profile for fairness.
   */
  getApmProfile(): ApmProfile {
    return APM_PROFILES.human_like;
  }

  /**
   * Record a challenge result.
   */
  recordResult(challengeId: string, result: ChallengeResult): void {
    const challenge = this.challenges.get(challengeId);
    if (challenge) {
      challenge.status = "completed";
      challenge.result = result;
    }
    this.challengeResults.push(result);

    const outcome =
      result.winner === "human"
        ? `🎉 ${result.human_name} WINS!`
        : result.winner === "ai"
          ? `🤖 ${result.ai_name} WINS!`
          : "🤝 DRAW!";

    console.log(
      `🏁 Challenge complete: ${result.human_name} vs ${result.ai_name} — ${outcome}`
    );
  }

  /**
   * Get challenge by ID.
   */
  getChallenge(id: string): ChallengeRequest | undefined {
    return this.challenges.get(id);
  }

  /**
   * Get pending challenges.
   */
  getPending(): ChallengeRequest[] {
    const now = Date.now();
    return Array.from(this.challenges.values())
      .filter((c) => c.status === "waiting" && c.expires_at > now);
  }

  /**
   * Cancel a challenge.
   */
  cancelChallenge(id: string): boolean {
    const challenge = this.challenges.get(id);
    if (!challenge || challenge.status !== "waiting") return false;
    challenge.status = "cancelled";
    return true;
  }

  /**
   * Clean up expired challenges.
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [, challenge] of this.challenges) {
      if (challenge.status === "waiting" && challenge.expires_at < now) {
        challenge.status = "expired";
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Get global challenge statistics.
   */
  getStats(): ChallengeStats {
    const results = this.challengeResults;
    const total = results.length;
    const humanWins = results.filter((r) => r.winner === "human").length;
    const aiWins = results.filter((r) => r.winner === "ai").length;
    const draws = results.filter((r) => r.winner === "draw").length;

    const avgDuration =
      total > 0
        ? results.reduce((sum, r) => sum + r.duration_secs, 0) / total
        : 0;

    // Find the hardest AI beaten by a human
    const humanVictories = results.filter((r) => r.winner === "human");
    const hardest =
      humanVictories.length > 0
        ? humanVictories.reduce(
            (best, r) => (r.ai_elo > (best?.ai_elo ?? 0) ? r : best),
            humanVictories[0]
          )
        : null;

    return {
      total_challenges: total,
      human_wins: humanWins,
      ai_wins: aiWins,
      draws,
      human_win_rate:
        total > 0 ? Math.round((humanWins / total) * 1000) / 10 : 0,
      avg_duration_secs: Math.round(avgDuration),
      hardest_ai_beaten: hardest
        ? { name: hardest.ai_name, elo: hardest.ai_elo }
        : null,
    };
  }
}
