/**
 * Season System — Quarterly rating resets and season rewards.
 *
 * Features:
 *   - Configurable season length (default: 3 months)
 *   - Soft ELO reset at season start (decay toward 1200, not full reset)
 *   - End-of-season snapshots (preserve rankings history)
 *   - Season rewards/titles based on peak rating
 *   - Placement matches at start of each season
 *   - Historical season data for agent profiles
 *   - Auto-detection of season transitions
 */

import { nanoid } from "nanoid";
import { getDb, agentQueries, type AgentRow } from "./db.js";

// ─── Types ──────────────────────────────────────────────

export type SeasonStatus = "upcoming" | "active" | "completed";

export interface Season {
  id: string;
  number: number;
  name: string;
  status: SeasonStatus;
  start_date: string;
  end_date: string;
  created_at: string;
  config: SeasonConfig;
  snapshot: SeasonSnapshot | null;
}

export interface SeasonConfig {
  /** How much ELO decays toward baseline at season reset (0.0-1.0) */
  elo_decay_factor: number;
  /** ELO baseline to decay toward */
  elo_baseline: number;
  /** Minimum games to qualify for season rewards */
  min_games_for_rewards: number;
  /** Number of placement matches before ranked */
  placement_matches: number;
}

export interface SeasonSnapshot {
  season_id: string;
  taken_at: string;
  total_agents: number;
  total_matches: number;
  top_agents: SeasonRanking[];
  tier_distribution: Record<string, number>;
  average_elo: number;
  highest_elo: number;
}

export interface SeasonRanking {
  rank: number;
  agent_id: string;
  agent_name: string;
  elo: number;
  peak_elo: number;
  games_played: number;
  wins: number;
  losses: number;
  win_rate: number;
  reward_title: string;
  reward_icon: string;
}

export interface AgentSeasonHistory {
  agent_id: string;
  seasons: Array<{
    season_id: string;
    season_number: number;
    season_name: string;
    final_elo: number;
    peak_elo: number;
    games_played: number;
    wins: number;
    losses: number;
    final_rank: number;
    reward_title: string;
  }>;
}

// ─── Constants ──────────────────────────────────────────

const DEFAULT_CONFIG: SeasonConfig = {
  elo_decay_factor: 0.5,
  elo_baseline: 1200,
  min_games_for_rewards: 10,
  placement_matches: 5,
};

const SEASON_REWARDS: Array<{
  min_elo: number;
  title: string;
  icon: string;
}> = [
  { min_elo: 2400, title: "Grandmaster Champion", icon: "🏆" },
  { min_elo: 2200, title: "Master Strategist", icon: "👑" },
  { min_elo: 2000, title: "Diamond Commander", icon: "💎" },
  { min_elo: 1800, title: "Platinum General", icon: "🔷" },
  { min_elo: 1600, title: "Gold Tactician", icon: "🥇" },
  { min_elo: 1400, title: "Silver Operative", icon: "🥈" },
  { min_elo: 1200, title: "Bronze Recruit", icon: "🥉" },
  { min_elo: 0, title: "Participant", icon: "🎮" },
];

function getSeasonReward(peakElo: number): { title: string; icon: string } {
  for (const reward of SEASON_REWARDS) {
    if (peakElo >= reward.min_elo) {
      return { title: reward.title, icon: reward.icon };
    }
  }
  return { title: "Participant", icon: "🎮" };
}

function getTier(elo: number): string {
  if (elo >= 2400) return "Grandmaster";
  if (elo >= 2200) return "Master";
  if (elo >= 2000) return "Diamond";
  if (elo >= 1800) return "Platinum";
  if (elo >= 1600) return "Gold";
  if (elo >= 1400) return "Silver";
  if (elo >= 1200) return "Bronze";
  return "Unranked";
}

// ─── Season Manager ─────────────────────────────────────

export class SeasonManager {
  private seasons: Season[] = [];
  private agentHistory = new Map<string, AgentSeasonHistory>();

  /**
   * Create a new season.
   */
  createSeason(opts: {
    number: number;
    name: string;
    start_date: string;
    end_date: string;
    config?: Partial<SeasonConfig>;
  }): Season {
    const season: Season = {
      id: nanoid(12),
      number: opts.number,
      name: opts.name,
      status: "upcoming",
      start_date: opts.start_date,
      end_date: opts.end_date,
      created_at: new Date().toISOString(),
      config: { ...DEFAULT_CONFIG, ...opts.config },
      snapshot: null,
    };

    this.seasons.push(season);
    console.log(`📅 Season ${opts.number} created: ${opts.name} (${opts.start_date} → ${opts.end_date})`);
    return season;
  }

  /**
   * Start a season (set status to active).
   */
  startSeason(seasonId: string): Season {
    const season = this.getSeason(seasonId);
    if (!season) throw new SeasonError("Season not found");
    if (season.status !== "upcoming") throw new SeasonError("Season is not in 'upcoming' status");

    // End any currently active season
    const active = this.getActiveSeason();
    if (active) {
      this.endSeason(active.id);
    }

    season.status = "active";
    console.log(`🚀 Season ${season.number} (${season.name}) is now ACTIVE!`);
    return season;
  }

  /**
   * End a season — take snapshot, apply ELO decay, award titles.
   */
  endSeason(seasonId: string): Season {
    const season = this.getSeason(seasonId);
    if (!season) throw new SeasonError("Season not found");
    if (season.status !== "active") throw new SeasonError("Season is not active");

    // Take the final snapshot
    season.snapshot = this.takeSnapshot(season);
    season.status = "completed";

    // Record history for each agent in the snapshot
    for (const ranking of season.snapshot.top_agents) {
      this.recordAgentSeason(ranking.agent_id, {
        season_id: season.id,
        season_number: season.number,
        season_name: season.name,
        final_elo: ranking.elo,
        peak_elo: ranking.peak_elo,
        games_played: ranking.games_played,
        wins: ranking.wins,
        losses: ranking.losses,
        final_rank: ranking.rank,
        reward_title: ranking.reward_title,
      });
    }

    // Apply soft ELO reset for all agents
    this.applySoftReset(season.config);

    console.log(
      `🏁 Season ${season.number} (${season.name}) COMPLETE! ` +
        `${season.snapshot.total_agents} agents, ${season.snapshot.total_matches} matches`
    );

    return season;
  }

  /**
   * Get the currently active season.
   */
  getActiveSeason(): Season | undefined {
    return this.seasons.find((s) => s.status === "active");
  }

  /**
   * Get a season by ID.
   */
  getSeason(id: string): Season | undefined {
    return this.seasons.find((s) => s.id === id);
  }

  /**
   * Get all seasons.
   */
  getAllSeasons(): Season[] {
    return [...this.seasons].sort((a, b) => b.number - a.number);
  }

  /**
   * Get completed seasons.
   */
  getCompletedSeasons(): Season[] {
    return this.seasons
      .filter((s) => s.status === "completed")
      .sort((a, b) => b.number - a.number);
  }

  /**
   * Get an agent's season history.
   */
  getAgentSeasonHistory(agentId: string): AgentSeasonHistory {
    return (
      this.agentHistory.get(agentId) ?? {
        agent_id: agentId,
        seasons: [],
      }
    );
  }

  /**
   * Check if a season transition should occur based on current date.
   */
  checkSeasonTransition(): { action: string; season?: Season } | null {
    const now = new Date();
    const active = this.getActiveSeason();

    if (active) {
      const endDate = new Date(active.end_date);
      if (now >= endDate) {
        return { action: "end_season", season: active };
      }
    }

    // Check for upcoming seasons that should start
    const upcoming = this.seasons.find((s) => {
      if (s.status !== "upcoming") return false;
      const startDate = new Date(s.start_date);
      return now >= startDate;
    });

    if (upcoming) {
      return { action: "start_season", season: upcoming };
    }

    return null;
  }

  // ─── Private ────────────────────────────────────────────

  private takeSnapshot(season: Season): SeasonSnapshot {
    const db = getDb();
    const agents = agentQueries.getLeaderboard(db, {
      limit: 1000,
      offset: 0,
      minGames: 0,
    });

    const qualifiedAgents = agents.filter(
      (a) => a.games_played >= season.config.min_games_for_rewards
    );

    const tierDistribution: Record<string, number> = {};
    let totalElo = 0;
    let highestElo = 0;

    const rankings: SeasonRanking[] = qualifiedAgents.map((agent, idx) => {
      const tier = getTier(agent.elo);
      tierDistribution[tier] = (tierDistribution[tier] ?? 0) + 1;
      totalElo += agent.elo;
      if (agent.elo > highestElo) highestElo = agent.elo;

      const reward = getSeasonReward(agent.peak_elo);
      const winRate =
        agent.games_played > 0
          ? Math.round((agent.wins / agent.games_played) * 1000) / 10
          : 0;

      return {
        rank: idx + 1,
        agent_id: agent.id,
        agent_name: agent.name,
        elo: agent.elo,
        peak_elo: agent.peak_elo,
        games_played: agent.games_played,
        wins: agent.wins,
        losses: agent.losses,
        win_rate: winRate,
        reward_title: reward.title,
        reward_icon: reward.icon,
      };
    });

    return {
      season_id: season.id,
      taken_at: new Date().toISOString(),
      total_agents: agents.length,
      total_matches: agents.reduce((sum, a) => sum + a.games_played, 0) / 2,
      top_agents: rankings,
      tier_distribution: tierDistribution,
      average_elo:
        agents.length > 0 ? Math.round(totalElo / agents.length) : 1200,
      highest_elo: highestElo,
    };
  }

  private applySoftReset(config: SeasonConfig): void {
    const db = getDb();
    const agents = agentQueries.getLeaderboard(db, {
      limit: 10000,
      offset: 0,
      minGames: 0,
    });

    let resetCount = 0;
    for (const agent of agents) {
      // Soft reset: decay toward baseline
      const newElo = Math.round(
        config.elo_baseline +
          (agent.elo - config.elo_baseline) * (1 - config.elo_decay_factor)
      );

      if (newElo !== agent.elo) {
        agentQueries.updateElo(db, agent.id, newElo, agent.peak_elo);
        resetCount++;
      }
    }

    console.log(
      `🔄 Soft ELO reset applied to ${resetCount} agents ` +
        `(decay factor: ${config.elo_decay_factor})`
    );
  }

  private recordAgentSeason(
    agentId: string,
    data: AgentSeasonHistory["seasons"][0]
  ): void {
    let history = this.agentHistory.get(agentId);
    if (!history) {
      history = { agent_id: agentId, seasons: [] };
      this.agentHistory.set(agentId, history);
    }
    history.seasons.push(data);
  }
}

// ─── Errors ─────────────────────────────────────────────

export class SeasonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeasonError";
  }
}
