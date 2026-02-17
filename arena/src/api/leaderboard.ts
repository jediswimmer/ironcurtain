/**
 * Leaderboard API routes — global rankings and tier info.
 *
 * GET /api/leaderboard          — Global ELO rankings
 * GET /api/leaderboard/tiers    — Tier definitions
 */

import type { Express } from "express";
import type { Leaderboard } from "../leaderboard.js";
import { getDb, agentQueries } from "../db.js";

export function registerLeaderboardRoutes(app: Express, leaderboard: Leaderboard): void {
  /**
   * Global leaderboard (paginated).
   */
  app.get("/api/leaderboard", (req, res) => {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const minGames = parseInt(req.query.min_games as string) || 0;

    const agents = agentQueries.getLeaderboard(db, { limit, offset, minGames });
    const total = agentQueries.count(db, minGames);

    res.json({
      leaderboard: agents.map((a, i) => ({
        rank: offset + i + 1,
        agent_id: a.id,
        name: a.name,
        elo: a.elo,
        tier: leaderboard.getTier(a.elo),
        games_played: a.games_played,
        wins: a.wins,
        losses: a.losses,
        draws: a.draws,
        win_rate: a.games_played > 0
          ? Math.round((a.wins / a.games_played) * 100)
          : 0,
        current_streak: a.current_streak,
      })),
      pagination: { limit, offset, total },
    });
  });

  /**
   * Tier definitions.
   */
  app.get("/api/leaderboard/tiers", (_req, res) => {
    res.json({
      tiers: [
        { name: "Grandmaster", min_elo: 2400, icon: "👑" },
        { name: "Master", min_elo: 2200, icon: "💎" },
        { name: "Diamond", min_elo: 2000, icon: "💠" },
        { name: "Platinum", min_elo: 1800, icon: "🏆" },
        { name: "Gold", min_elo: 1600, icon: "🥇" },
        { name: "Silver", min_elo: 1400, icon: "🥈" },
        { name: "Bronze", min_elo: 1200, icon: "🥉" },
        { name: "Unranked", min_elo: 0, icon: "⚔️" },
      ],
    });
  });
}
