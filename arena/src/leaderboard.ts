/**
 * Leaderboard — ELO rating calculation and rankings.
 *
 * Uses standard ELO with adaptive K-factor:
 *   K=40 for placement (< 10 games)
 *   K=32 for calibrating (10-30 games)
 *   K=20 for established (30+ games)
 *
 * All data is persisted to SQLite. In-memory is used only for
 * the current session's active stats cache.
 */

import {
  getDb,
  agentQueries,
  factionStatsQueries,
  modeRatingQueries,
  type AgentRow,
  type FactionStatsRow,
} from "./db.js";

// ─── Types ──────────────────────────────────────────────

export interface AgentProfile {
  agent_id: string;
  name: string;
  elo: number;
  peak_elo: number;
  tier: string;
  rank: number;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number;
  current_streak: number;
  faction_stats: FactionStatsRow[];
  registered_at: string;
  last_active: string;
}

export interface LeaderboardEntry {
  rank: number;
  agent_id: string;
  name: string;
  elo: number;
  tier: string;
  games_played: number;
  wins: number;
  losses: number;
  win_rate: number;
  current_streak: number;
}

export interface EloChange {
  winner_elo_before: number;
  winner_elo_after: number;
  winner_elo_change: number;
  loser_elo_before: number;
  loser_elo_after: number;
  loser_elo_change: number;
}

// ─── Leaderboard ────────────────────────────────────────

export class Leaderboard {
  /**
   * Record a match result and update ELO ratings.
   * Returns the ELO changes for both players.
   */
  recordResult(
    winnerId: string,
    loserId: string,
    winnerFaction: string,
    loserFaction: string,
    mode: string,
    isDraw: boolean = false
  ): EloChange {
    const db = getDb();

    const winner = agentQueries.getById(db, winnerId);
    const loser = agentQueries.getById(db, loserId);
    if (!winner || !loser) throw new Error("Unknown agent in match result");

    // Calculate ELO changes
    const kWinner = getKFactor(winner.games_played);
    const kLoser = getKFactor(loser.games_played);

    const expectedWin = 1 / (1 + Math.pow(10, (loser.elo - winner.elo) / 400));
    const expectedLose = 1 - expectedWin;

    let winnerScore: number;
    let loserScore: number;

    if (isDraw) {
      winnerScore = 0.5;
      loserScore = 0.5;
    } else {
      winnerScore = 1;
      loserScore = 0;
    }

    const winnerChange = Math.round(kWinner * (winnerScore - expectedWin));
    const loserChange = Math.round(kLoser * (loserScore - expectedLose));

    const newWinnerElo = winner.elo + winnerChange;
    const newLoserElo = Math.max(100, loser.elo + loserChange); // Floor at 100

    // Update global ELO
    agentQueries.updateElo(db, winnerId, newWinnerElo, Math.max(winner.peak_elo, newWinnerElo));
    agentQueries.updateElo(db, loserId, newLoserElo, loser.peak_elo);

    // Update win/loss/draw counts
    if (isDraw) {
      agentQueries.incrementDraw(db, winnerId);
      agentQueries.incrementDraw(db, loserId);
    } else {
      agentQueries.incrementWin(db, winnerId);
      agentQueries.incrementLoss(db, loserId);
    }

    // Update per-mode ratings
    const winnerModeRating = modeRatingQueries.getOrCreate(db, winnerId, mode);
    const loserModeRating = modeRatingQueries.getOrCreate(db, loserId, mode);

    const modeExpectedWin = 1 / (1 + Math.pow(10, (loserModeRating.elo - winnerModeRating.elo) / 400));
    const modeWinnerChange = Math.round(kWinner * (winnerScore - modeExpectedWin));
    const modeLoserChange = Math.round(kLoser * (loserScore - (1 - modeExpectedWin)));

    if (isDraw) {
      // For draws, just increment games (ELO change is minimal)
      modeRatingQueries.updateAfterWin(db, winnerId, mode, winnerModeRating.elo + modeWinnerChange);
      modeRatingQueries.updateAfterLoss(db, loserId, mode, loserModeRating.elo + modeLoserChange);
    } else {
      modeRatingQueries.updateAfterWin(db, winnerId, mode, winnerModeRating.elo + modeWinnerChange);
      modeRatingQueries.updateAfterLoss(db, loserId, mode, loserModeRating.elo + modeLoserChange);
    }

    // Update faction stats
    if (isDraw) {
      factionStatsQueries.upsertDraw(db, winnerId, winnerFaction);
      factionStatsQueries.upsertDraw(db, loserId, loserFaction);
    } else {
      factionStatsQueries.upsertWin(db, winnerId, winnerFaction);
      factionStatsQueries.upsertLoss(db, loserId, loserFaction);
    }

    return {
      winner_elo_before: winner.elo,
      winner_elo_after: newWinnerElo,
      winner_elo_change: winnerChange,
      loser_elo_before: loser.elo,
      loser_elo_after: newLoserElo,
      loser_elo_change: loserChange,
    };
  }

  /**
   * Get the full agent profile with stats.
   */
  getAgentProfile(agentId: string): AgentProfile | null {
    const db = getDb();
    const agent = agentQueries.getById(db, agentId);
    if (!agent) return null;

    const factionStats = factionStatsQueries.getByAgent(db, agentId);

    return {
      agent_id: agent.id,
      name: agent.name,
      elo: agent.elo,
      peak_elo: agent.peak_elo,
      tier: getTier(agent.elo),
      rank: this.getAgentRank(agentId),
      games_played: agent.games_played,
      wins: agent.wins,
      losses: agent.losses,
      draws: agent.draws,
      win_rate: agent.games_played > 0
        ? Math.round((agent.wins / agent.games_played) * 1000) / 10
        : 0,
      current_streak: agent.current_streak,
      faction_stats: factionStats,
      registered_at: agent.created_at,
      last_active: agent.last_active,
    };
  }

  /**
   * Get agent's rank (1-indexed position by ELO).
   */
  getAgentRank(agentId: string): number {
    const db = getDb();
    const row = db.prepare(`
      SELECT COUNT(*) + 1 as rank FROM agents
      WHERE status = 'active' AND elo > (SELECT elo FROM agents WHERE id = ?)
    `).get(agentId) as { rank: number } | undefined;
    return row?.rank ?? 0;
  }

  /**
   * Get paginated leaderboard.
   */
  getLeaderboard(opts: {
    limit?: number;
    offset?: number;
    minGames?: number;
    mode?: string;
  } = {}): { entries: LeaderboardEntry[]; total: number } {
    const db = getDb();
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const minGames = opts.minGames ?? 0;

    const agents = agentQueries.getLeaderboard(db, { limit, offset, minGames });
    const total = agentQueries.count(db, minGames);

    const entries: LeaderboardEntry[] = agents.map((agent, idx) => ({
      rank: offset + idx + 1,
      agent_id: agent.id,
      name: agent.name,
      elo: agent.elo,
      tier: getTier(agent.elo),
      games_played: agent.games_played,
      wins: agent.wins,
      losses: agent.losses,
      win_rate: agent.games_played > 0
        ? Math.round((agent.wins / agent.games_played) * 1000) / 10
        : 0,
      current_streak: agent.current_streak,
    }));

    return { entries, total };
  }
}

// ─── ELO Helpers ────────────────────────────────────────

function getKFactor(gamesPlayed: number): number {
  if (gamesPlayed < 10) return 40;   // Placement — big swings
  if (gamesPlayed < 30) return 32;   // Calibrating
  return 20;                          // Settled
}

export function getTier(elo: number): string {
  if (elo >= 2400) return "Grandmaster";
  if (elo >= 2200) return "Master";
  if (elo >= 2000) return "Diamond";
  if (elo >= 1800) return "Platinum";
  if (elo >= 1600) return "Gold";
  if (elo >= 1400) return "Silver";
  if (elo >= 1200) return "Bronze";
  return "Unranked";
}
