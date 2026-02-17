/**
 * Agent Showcase & Hall of Fame — Celebrating the best AI agents.
 *
 * Features:
 *   - Hall of Fame inductees (season champions, record holders)
 *   - Agent showcase profiles with detailed performance metrics
 *   - Records tracking (highest ELO, longest win streak, most games, etc.)
 *   - Notable achievements system
 *   - Featured agents rotation
 *
 * All data is derived from the agents and matches tables in SQLite.
 */

import { getDb, agentQueries, matchQueries, type AgentRow, type MatchRow } from "./db.js";

// ─── Types ──────────────────────────────────────────────

export interface HallOfFameEntry {
  agent_id: string;
  agent_name: string;
  category: HofCategory;
  title: string;
  description: string;
  value: number | string;
  inducted_at: string;
  season_number?: number;
}

export type HofCategory =
  | "season_champion"
  | "highest_elo"
  | "longest_streak"
  | "most_wins"
  | "most_games"
  | "best_win_rate"
  | "comeback_king"
  | "iron_wall"
  | "special";

export interface AgentShowcase {
  agent_id: string;
  agent_name: string;
  elo: number;
  peak_elo: number;
  tier: string;
  rank: number;
  total_games: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number;
  current_streak: number;
  best_streak: number;
  achievements: Achievement[];
  milestones: Milestone[];
  performance_rating: PerformanceRating;
  recent_form: RecentForm;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  earned_at: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
}

export interface Milestone {
  title: string;
  description: string;
  value: number;
  date: string;
}

export interface PerformanceRating {
  overall: string;
  offense: number;
  defense: number;
  economy: number;
  consistency: number;
  adaptability: number;
}

export interface RecentForm {
  last_10: Array<"W" | "L" | "D">;
  last_10_win_rate: number;
  trend: "improving" | "stable" | "declining";
  elo_change_30d: number;
}

export interface PlatformRecords {
  highest_elo_ever: RecordEntry;
  longest_win_streak: RecordEntry;
  most_games_played: RecordEntry;
  most_wins: RecordEntry;
  best_win_rate_qualified: RecordEntry;
  fastest_to_diamond: RecordEntry | null;
}

export interface RecordEntry {
  agent_id: string;
  agent_name: string;
  value: number | string;
  date?: string;
}

// ─── Achievement Definitions ────────────────────────────

const ACHIEVEMENT_DEFS: Array<{
  id: string;
  title: string;
  description: string;
  icon: string;
  rarity: Achievement["rarity"];
  check: (agent: AgentRow) => boolean;
}> = [
  {
    id: "first_blood",
    title: "First Blood",
    description: "Win your first match",
    icon: "⚔️",
    rarity: "common",
    check: (a) => a.wins >= 1,
  },
  {
    id: "veteran",
    title: "Veteran",
    description: "Play 50 matches",
    icon: "🎖️",
    rarity: "common",
    check: (a) => a.games_played >= 50,
  },
  {
    id: "centurion",
    title: "Centurion",
    description: "Play 100 matches",
    icon: "💯",
    rarity: "uncommon",
    check: (a) => a.games_played >= 100,
  },
  {
    id: "warmachine",
    title: "War Machine",
    description: "Play 500 matches",
    icon: "🤖",
    rarity: "rare",
    check: (a) => a.games_played >= 500,
  },
  {
    id: "win_streak_5",
    title: "On Fire",
    description: "Win 5 matches in a row",
    icon: "🔥",
    rarity: "uncommon",
    check: (a) => a.current_streak >= 5,
  },
  {
    id: "win_streak_10",
    title: "Unstoppable",
    description: "Win 10 matches in a row",
    icon: "💪",
    rarity: "rare",
    check: (a) => a.current_streak >= 10,
  },
  {
    id: "win_streak_20",
    title: "Legendary Streak",
    description: "Win 20 matches in a row",
    icon: "⭐",
    rarity: "legendary",
    check: (a) => a.current_streak >= 20,
  },
  {
    id: "bronze_rank",
    title: "Bronze Warrior",
    description: "Reach Bronze rank (1200+ ELO)",
    icon: "🥉",
    rarity: "common",
    check: (a) => a.peak_elo >= 1200,
  },
  {
    id: "silver_rank",
    title: "Silver Guardian",
    description: "Reach Silver rank (1400+ ELO)",
    icon: "🥈",
    rarity: "uncommon",
    check: (a) => a.peak_elo >= 1400,
  },
  {
    id: "gold_rank",
    title: "Gold Commander",
    description: "Reach Gold rank (1600+ ELO)",
    icon: "🥇",
    rarity: "uncommon",
    check: (a) => a.peak_elo >= 1600,
  },
  {
    id: "platinum_rank",
    title: "Platinum Elite",
    description: "Reach Platinum rank (1800+ ELO)",
    icon: "🔷",
    rarity: "rare",
    check: (a) => a.peak_elo >= 1800,
  },
  {
    id: "diamond_rank",
    title: "Diamond Legend",
    description: "Reach Diamond rank (2000+ ELO)",
    icon: "💎",
    rarity: "epic",
    check: (a) => a.peak_elo >= 2000,
  },
  {
    id: "master_rank",
    title: "Master Mind",
    description: "Reach Master rank (2200+ ELO)",
    icon: "👑",
    rarity: "epic",
    check: (a) => a.peak_elo >= 2200,
  },
  {
    id: "grandmaster_rank",
    title: "Grandmaster Supreme",
    description: "Reach Grandmaster rank (2400+ ELO)",
    icon: "🏆",
    rarity: "legendary",
    check: (a) => a.peak_elo >= 2400,
  },
  {
    id: "win_rate_60",
    title: "Efficient",
    description: "Maintain 60%+ win rate over 30+ games",
    icon: "📈",
    rarity: "uncommon",
    check: (a) => a.games_played >= 30 && a.wins / a.games_played >= 0.6,
  },
  {
    id: "win_rate_70",
    title: "Dominant",
    description: "Maintain 70%+ win rate over 50+ games",
    icon: "🏅",
    rarity: "rare",
    check: (a) => a.games_played >= 50 && a.wins / a.games_played >= 0.7,
  },
  {
    id: "win_rate_80",
    title: "Overwhelming",
    description: "Maintain 80%+ win rate over 100+ games",
    icon: "🌟",
    rarity: "legendary",
    check: (a) => a.games_played >= 100 && a.wins / a.games_played >= 0.8,
  },
];

// ─── Hall of Fame Manager ───────────────────────────────

export class HallOfFameManager {
  private entries: HallOfFameEntry[] = [];
  private featuredAgentIds: string[] = [];

  /**
   * Add an inductee to the Hall of Fame.
   */
  induct(entry: Omit<HallOfFameEntry, "inducted_at">): HallOfFameEntry {
    const full: HallOfFameEntry = {
      ...entry,
      inducted_at: new Date().toISOString(),
    };
    this.entries.push(full);
    console.log(
      `🏛️ Hall of Fame: ${entry.agent_name} inducted for ${entry.category} — ${entry.title}`
    );
    return full;
  }

  /**
   * Get all Hall of Fame entries.
   */
  getAll(): HallOfFameEntry[] {
    return [...this.entries].sort(
      (a, b) => new Date(b.inducted_at).getTime() - new Date(a.inducted_at).getTime()
    );
  }

  /**
   * Get entries by category.
   */
  getByCategory(category: HofCategory): HallOfFameEntry[] {
    return this.entries.filter((e) => e.category === category);
  }

  /**
   * Build an agent showcase profile with achievements and metrics.
   */
  getAgentShowcase(agentId: string): AgentShowcase | null {
    const db = getDb();
    const agent = agentQueries.getById(db, agentId);
    if (!agent) return null;

    const achievements = this.calculateAchievements(agent);
    const milestones = this.calculateMilestones(agent);
    const performance = this.calculatePerformance(agent);
    const recentForm = this.calculateRecentForm(agent);
    const rank = this.getAgentRank(agentId);

    return {
      agent_id: agent.id,
      agent_name: agent.name,
      elo: agent.elo,
      peak_elo: agent.peak_elo,
      tier: getTier(agent.elo),
      rank,
      total_games: agent.games_played,
      wins: agent.wins,
      losses: agent.losses,
      draws: agent.draws,
      win_rate:
        agent.games_played > 0
          ? Math.round((agent.wins / agent.games_played) * 1000) / 10
          : 0,
      current_streak: agent.current_streak,
      best_streak: agent.current_streak, // Would need historical tracking for true best
      achievements,
      milestones,
      performance_rating: performance,
      recent_form: recentForm,
    };
  }

  /**
   * Get platform-wide records.
   */
  getRecords(): PlatformRecords {
    const db = getDb();
    const allAgents = agentQueries.getLeaderboard(db, {
      limit: 10000,
      offset: 0,
      minGames: 0,
    });

    if (allAgents.length === 0) {
      const empty: RecordEntry = { agent_id: "", agent_name: "N/A", value: 0 };
      return {
        highest_elo_ever: empty,
        longest_win_streak: empty,
        most_games_played: empty,
        most_wins: empty,
        best_win_rate_qualified: empty,
        fastest_to_diamond: null,
      };
    }

    // Highest ELO ever
    const highestElo = allAgents.reduce((best, a) =>
      a.peak_elo > best.peak_elo ? a : best
    );

    // Longest win streak (current — would need historical data for all-time)
    const longestStreak = allAgents.reduce((best, a) =>
      a.current_streak > best.current_streak ? a : best
    );

    // Most games
    const mostGames = allAgents.reduce((best, a) =>
      a.games_played > best.games_played ? a : best
    );

    // Most wins
    const mostWins = allAgents.reduce((best, a) =>
      a.wins > best.wins ? a : best
    );

    // Best win rate (min 20 games)
    const qualified = allAgents.filter((a) => a.games_played >= 20);
    const bestWinRate = qualified.length > 0
      ? qualified.reduce((best, a) => {
          const bestRate = best.wins / best.games_played;
          const aRate = a.wins / a.games_played;
          return aRate > bestRate ? a : best;
        })
      : allAgents[0];

    return {
      highest_elo_ever: {
        agent_id: highestElo.id,
        agent_name: highestElo.name,
        value: highestElo.peak_elo,
      },
      longest_win_streak: {
        agent_id: longestStreak.id,
        agent_name: longestStreak.name,
        value: longestStreak.current_streak,
      },
      most_games_played: {
        agent_id: mostGames.id,
        agent_name: mostGames.name,
        value: mostGames.games_played,
      },
      most_wins: {
        agent_id: mostWins.id,
        agent_name: mostWins.name,
        value: mostWins.wins,
      },
      best_win_rate_qualified: {
        agent_id: bestWinRate.id,
        agent_name: bestWinRate.name,
        value: `${Math.round((bestWinRate.wins / bestWinRate.games_played) * 1000) / 10}%`,
      },
      fastest_to_diamond: null, // Would need timestamp tracking per ELO milestone
    };
  }

  /**
   * Get featured agents (curated or auto-selected top performers).
   */
  getFeaturedAgents(limit: number = 5): AgentShowcase[] {
    const db = getDb();
    const topAgents = agentQueries.getLeaderboard(db, {
      limit,
      offset: 0,
      minGames: 5,
    });

    return topAgents
      .map((a) => this.getAgentShowcase(a.id))
      .filter((s): s is AgentShowcase => s !== null);
  }

  /**
   * Set featured agents manually.
   */
  setFeaturedAgents(agentIds: string[]): void {
    this.featuredAgentIds = agentIds;
  }

  // ─── Private ────────────────────────────────────────────

  private calculateAchievements(agent: AgentRow): Achievement[] {
    return ACHIEVEMENT_DEFS.filter((def) => def.check(agent)).map((def) => ({
      id: def.id,
      title: def.title,
      description: def.description,
      icon: def.icon,
      earned_at: agent.last_active,
      rarity: def.rarity,
    }));
  }

  private calculateMilestones(agent: AgentRow): Milestone[] {
    const milestones: Milestone[] = [];

    if (agent.games_played >= 1) {
      milestones.push({
        title: "First Match",
        description: "Played your first match on IronCurtain",
        value: 1,
        date: agent.created_at,
      });
    }

    if (agent.wins >= 1) {
      milestones.push({
        title: "First Victory",
        description: "Won your first match",
        value: 1,
        date: agent.last_active,
      });
    }

    const gameMilestones = [10, 50, 100, 250, 500, 1000];
    for (const m of gameMilestones) {
      if (agent.games_played >= m) {
        milestones.push({
          title: `${m} Games`,
          description: `Played ${m} matches`,
          value: m,
          date: agent.last_active,
        });
      }
    }

    const eloMilestones = [1400, 1600, 1800, 2000, 2200, 2400];
    for (const m of eloMilestones) {
      if (agent.peak_elo >= m) {
        milestones.push({
          title: `${m} ELO`,
          description: `Reached ${m} ELO rating`,
          value: m,
          date: agent.last_active,
        });
      }
    }

    return milestones;
  }

  private calculatePerformance(agent: AgentRow): PerformanceRating {
    const winRate =
      agent.games_played > 0 ? agent.wins / agent.games_played : 0;

    // Simplified performance metrics based on available data
    const offense = Math.min(100, Math.round(winRate * 120)); // Higher win rate = better offense
    const defense = Math.min(
      100,
      Math.round((1 - agent.losses / Math.max(1, agent.games_played)) * 100)
    );
    const economy = Math.min(100, Math.round((agent.peak_elo / 2400) * 100));
    const consistency =
      agent.games_played >= 30 ? Math.min(100, Math.round(winRate * 100 + 10)) : 50;
    const adaptability = Math.min(
      100,
      Math.round(Math.min(agent.games_played, 100))
    );

    let overall: string;
    const avg = (offense + defense + economy + consistency + adaptability) / 5;
    if (avg >= 80) overall = "S";
    else if (avg >= 70) overall = "A";
    else if (avg >= 55) overall = "B";
    else if (avg >= 40) overall = "C";
    else overall = "D";

    return { overall, offense, defense, economy, consistency, adaptability };
  }

  private calculateRecentForm(agent: AgentRow): RecentForm {
    const db = getDb();
    const recentMatches = matchQueries.getRecent(db, {
      limit: 10,
      offset: 0,
      agentId: agent.id,
    });

    const last10: Array<"W" | "L" | "D"> = recentMatches.map((m) => {
      if (m.is_draw) return "D";
      return m.winner_id === agent.id ? "W" : "L";
    });

    const wins = last10.filter((r) => r === "W").length;
    const winRate = last10.length > 0 ? Math.round((wins / last10.length) * 100) : 0;

    // Determine trend
    const firstHalf = last10.slice(0, 5);
    const secondHalf = last10.slice(5);
    const firstWins = firstHalf.filter((r) => r === "W").length;
    const secondWins = secondHalf.filter((r) => r === "W").length;

    let trend: RecentForm["trend"];
    if (firstWins > secondWins + 1) trend = "improving";
    else if (secondWins > firstWins + 1) trend = "declining";
    else trend = "stable";

    return {
      last_10: last10,
      last_10_win_rate: winRate,
      trend,
      elo_change_30d: 0, // Would need historical ELO tracking
    };
  }

  private getAgentRank(agentId: string): number {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT COUNT(*) + 1 as rank FROM agents
         WHERE status = 'active' AND elo > (SELECT elo FROM agents WHERE id = ?)`
      )
      .get(agentId) as { rank: number } | undefined;
    return row?.rank ?? 0;
  }
}

// ─── Helpers ────────────────────────────────────────────

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
