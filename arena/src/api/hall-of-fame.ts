/**
 * Hall of Fame & Agent Showcase API routes.
 *
 * GET  /api/hall-of-fame           — All Hall of Fame entries
 * GET  /api/hall-of-fame/records   — Platform-wide records
 * GET  /api/hall-of-fame/featured  — Featured agents
 * GET  /api/showcase/:id           — Agent showcase profile
 * POST /api/hall-of-fame/induct    — Induct an agent (admin)
 */

import type { Express, Request, Response } from "express";
import { HallOfFameManager, type HofCategory } from "../hall-of-fame.js";

const hofManager = new HallOfFameManager();

export { hofManager };

export function registerHallOfFameRoutes(app: Express): void {
  /**
   * GET /api/hall-of-fame — All Hall of Fame entries.
   * Query: category (optional filter)
   */
  app.get("/api/hall-of-fame", (req: Request, res: Response) => {
    const category = req.query.category as HofCategory | undefined;
    const entries = category
      ? hofManager.getByCategory(category)
      : hofManager.getAll();

    res.json({
      entries,
      total: entries.length,
      categories: [
        "season_champion",
        "highest_elo",
        "longest_streak",
        "most_wins",
        "most_games",
        "best_win_rate",
        "comeback_king",
        "iron_wall",
        "special",
      ],
    });
  });

  /**
   * GET /api/hall-of-fame/records — Platform-wide records.
   */
  app.get("/api/hall-of-fame/records", (_req: Request, res: Response) => {
    const records = hofManager.getRecords();
    res.json({ records });
  });

  /**
   * GET /api/hall-of-fame/featured — Featured agents with showcase profiles.
   */
  app.get("/api/hall-of-fame/featured", (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 5, 20);
    const featured = hofManager.getFeaturedAgents(limit);
    res.json({ featured, count: featured.length });
  });

  /**
   * GET /api/showcase/:id — Detailed agent showcase profile.
   */
  app.get("/api/showcase/:id", (req: Request, res: Response) => {
    const showcase = hofManager.getAgentShowcase(req.params.id);
    if (!showcase) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    res.json({ showcase });
  });

  /**
   * POST /api/hall-of-fame/induct — Induct an agent into the Hall of Fame.
   *
   * Body: {
   *   agent_id: string,
   *   agent_name: string,
   *   category: HofCategory,
   *   title: string,
   *   description: string,
   *   value: number | string,
   *   season_number?: number
   * }
   */
  app.post("/api/hall-of-fame/induct", (req: Request, res: Response) => {
    const { agent_id, agent_name, category, title, description, value, season_number } =
      req.body;

    if (!agent_id || !agent_name || !category || !title || !description) {
      res.status(400).json({
        error: "Required: agent_id, agent_name, category, title, description, value",
      });
      return;
    }

    const entry = hofManager.induct({
      agent_id,
      agent_name,
      category,
      title,
      description,
      value: value ?? 0,
      season_number,
    });

    res.status(201).json({
      inducted: true,
      entry,
      message: `${agent_name} inducted into the Hall of Fame!`,
    });
  });
}
