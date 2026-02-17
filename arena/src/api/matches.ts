/**
 * Match API routes — live matches, match details, replays.
 *
 * GET /api/matches/live       — List currently running matches
 * GET /api/matches/recent     — Recent completed matches
 * GET /api/matches/:id        — Match details
 */

import type { Express } from "express";
import type { GameServerManager } from "../game-server-mgr.js";
import { getDb, matchQueries } from "../db.js";

export function registerMatchRoutes(app: Express, gameServerMgr: GameServerManager): void {
  /**
   * List live (currently running) matches.
   */
  app.get("/api/matches/live", (_req, res) => {
    const active = gameServerMgr.getActiveMatches();

    res.json({
      matches: active.map((m) => ({
        id: m.id,
        players: m.pairing.players.map((p) => ({
          name: p.agent_name,
          faction: p.faction,
          elo: p.elo,
        })),
        mode: m.pairing.mode,
        started_at: new Date(m.startedAt).toISOString(),
        status: m.status,
        spectator_count: m.spectatorConnections.size,
      })),
      total: active.length,
    });
  });

  /**
   * Recent completed matches (paginated).
   */
  app.get("/api/matches/recent", (req, res) => {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const mode = req.query.mode as string | undefined;

    const matches = matchQueries.getRecent(db, { limit, offset, mode });

    res.json({
      matches,
      pagination: { limit, offset },
    });
  });

  /**
   * Get details for a specific match.
   */
  app.get("/api/matches/:id", (req, res) => {
    const db = getDb();
    const match = matchQueries.getById(db, req.params.id);
    if (!match) {
      res.status(404).json({ error: "Match not found" });
      return;
    }

    res.json(match);
  });
}
