/**
 * Queue API routes — join/leave matchmaking queue.
 *
 * POST /api/queue/join     — Join the matchmaking queue
 * POST /api/queue/leave    — Leave the queue
 * GET  /api/queue/status   — Check queue position
 */

import type { Express } from "express";
import { authMiddleware, rateLimitMiddleware } from "../auth.js";
import type { AuthenticatedRequest } from "../auth.js";
import type { Matchmaker } from "../matchmaker.js";

export function registerQueueRoutes(app: Express, matchmaker: Matchmaker): void {
  /**
   * Join the matchmaking queue.
   */
  app.post("/api/queue/join", authMiddleware, rateLimitMiddleware, (req, res) => {
    const agent = (req as unknown as AuthenticatedRequest).agent;
    const {
      mode = "ranked_1v1",
      faction_preference = "random",
    } = req.body as {
      mode?: string;
      faction_preference?: "allies" | "soviet" | "random";
    };

    try {
      matchmaker.addToQueue({
        agent_id: agent.id,
        agent_name: agent.name,
        mode,
        faction_preference,
        elo: agent.elo,
        elo_range: 50,
        joined_at: Date.now(),
      });

      res.json({
        status: "queued",
        agent_id: agent.id,
        mode,
        faction_preference,
        elo: agent.elo,
        message: "You are in the queue. Connect via WebSocket to ws://host:8081/queue for match notifications.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(409).json({ error: message });
    }
  });

  /**
   * Leave the matchmaking queue.
   */
  app.post("/api/queue/leave", authMiddleware, rateLimitMiddleware, (req, res) => {
    const agent = (req as unknown as AuthenticatedRequest).agent;
    matchmaker.removeFromQueue(agent.id);
    res.json({ status: "left_queue", agent_id: agent.id });
  });

  /**
   * Check queue status.
   */
  app.get("/api/queue/status", authMiddleware, rateLimitMiddleware, (req, res) => {
    const agent = (req as unknown as AuthenticatedRequest).agent;
    const status = matchmaker.getQueueStatus(agent.id);
    res.json({ agent_id: agent.id, ...status });
  });
}
