/**
 * Tournament API routes — placeholder for future tournament system.
 *
 * GET  /api/tournaments          — List upcoming and active tournaments
 * POST /api/tournaments/:id/join — Join a tournament
 *
 * TODO(#3): Implement bracket generation and tournament lifecycle.
 */

import type { Express } from "express";

export function registerTournamentRoutes(app: Express): void {
  /**
   * List tournaments (placeholder).
   */
  app.get("/api/tournaments", (_req, res) => {
    res.json({
      tournaments: [],
      message: "Tournament system coming soon. Watch Discord for announcements.",
    });
  });

  /**
   * Get tournament details (placeholder).
   */
  app.get("/api/tournaments/:id", (_req, res) => {
    res.status(404).json({ error: "Tournament not found" });
  });
}
