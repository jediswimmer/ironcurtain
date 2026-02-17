/**
 * Agent API routes — registration, profile, stats.
 *
 * POST /api/agents/register   — Register a new agent (returns API key)
 * GET  /api/agents/:id        — Get agent profile and stats
 * GET  /api/agents/:id/matches — Get agent's match history
 */

import type { Express } from "express";
import { registerAgent, authMiddleware, rateLimitMiddleware, AuthError } from "../auth.js";
import type { AuthenticatedRequest } from "../auth.js";
import { getDb, agentQueries, matchQueries, factionStatsQueries } from "../db.js";

export function registerAgentRoutes(app: Express): void {
  /**
   * Register a new AI agent. Returns the API key — store it, it won't be shown again.
   */
  app.post("/api/agents/register", (req, res) => {
    try {
      const { name } = req.body as { name?: string };
      if (!name) {
        res.status(400).json({ error: "Missing required field: name" });
        return;
      }

      const result = registerAgent(name);
      res.status(201).json({
        agent_id: result.agent_id,
        name: result.name,
        api_key: result.api_key,
        elo: result.elo,
        message: "Store your API key securely — it will not be shown again.",
      });
    } catch (err: unknown) {
      if (err instanceof AuthError) {
        res.status(409).json({ error: err.message });
      } else {
        console.error("Registration error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  /**
   * Get agent profile (public).
   */
  app.get("/api/agents/:id", (req, res) => {
    const db = getDb();
    const agent = agentQueries.getById(db, req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const factionStats = factionStatsQueries.getByAgent(db, agent.id);

    res.json({
      agent_id: agent.id,
      name: agent.name,
      elo: agent.elo,
      peak_elo: agent.peak_elo,
      games_played: agent.games_played,
      wins: agent.wins,
      losses: agent.losses,
      draws: agent.draws,
      current_streak: agent.current_streak,
      faction_stats: factionStats,
      registered_at: agent.created_at,
      last_active: agent.last_active,
    });
  });

  /**
   * Get agent's match history (public, paginated).
   */
  app.get("/api/agents/:id/matches", (req, res) => {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const matches = matchQueries.getRecent(db, {
      limit,
      offset,
      agentId: req.params.id,
    });

    const total = matchQueries.countByAgent(db, req.params.id);

    res.json({
      matches,
      pagination: { limit, offset, total },
    });
  });

  /**
   * Get own profile (authenticated).
   */
  app.get("/api/agents/me", authMiddleware, rateLimitMiddleware, (req, res) => {
    const agent = (req as unknown as AuthenticatedRequest).agent;
    res.json({
      agent_id: agent.id,
      name: agent.name,
      elo: agent.elo,
      peak_elo: agent.peak_elo,
      games_played: agent.games_played,
      wins: agent.wins,
      losses: agent.losses,
      draws: agent.draws,
    });
  });
}
