/**
 * Season API routes — Quarterly seasons with ratings, rewards, and history.
 *
 * GET  /api/seasons               — List all seasons
 * GET  /api/seasons/active        — Get the current active season
 * GET  /api/seasons/:id           — Get season details + snapshot
 * POST /api/seasons               — Create a new season (admin)
 * POST /api/seasons/:id/start     — Start a season (admin)
 * POST /api/seasons/:id/end       — End a season (admin)
 * GET  /api/seasons/:id/rankings  — Get season final rankings
 * GET  /api/agents/:id/seasons    — Agent season history
 */

import type { Express, Request, Response } from "express";
import { SeasonManager, SeasonError, type SeasonConfig } from "../season-system.js";

const seasonManager = new SeasonManager();

export { seasonManager };

export function registerSeasonRoutes(app: Express): void {
  /**
   * GET /api/seasons — List all seasons.
   */
  app.get("/api/seasons", (_req: Request, res: Response) => {
    const seasons = seasonManager.getAllSeasons();
    res.json({
      seasons: seasons.map((s) => ({
        id: s.id,
        number: s.number,
        name: s.name,
        status: s.status,
        start_date: s.start_date,
        end_date: s.end_date,
        has_snapshot: s.snapshot !== null,
      })),
      total: seasons.length,
      active: seasonManager.getActiveSeason()?.id ?? null,
    });
  });

  /**
   * GET /api/seasons/active — Get the currently active season.
   */
  app.get("/api/seasons/active", (_req: Request, res: Response) => {
    const active = seasonManager.getActiveSeason();
    if (!active) {
      res.json({ active: false, season: null, message: "No season is currently active." });
      return;
    }

    const now = new Date();
    const end = new Date(active.end_date);
    const daysRemaining = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000));

    res.json({
      active: true,
      season: {
        id: active.id,
        number: active.number,
        name: active.name,
        start_date: active.start_date,
        end_date: active.end_date,
        days_remaining: daysRemaining,
        config: active.config,
      },
    });
  });

  /**
   * GET /api/seasons/:id — Get full season details.
   */
  app.get("/api/seasons/:id", (req: Request, res: Response) => {
    const season = seasonManager.getSeason(req.params.id);
    if (!season) {
      res.status(404).json({ error: "Season not found" });
      return;
    }

    res.json({ season });
  });

  /**
   * POST /api/seasons — Create a new season.
   *
   * Body: {
   *   number: number,
   *   name: string,
   *   start_date: string (ISO date),
   *   end_date: string (ISO date),
   *   config?: Partial<SeasonConfig>
   * }
   */
  app.post("/api/seasons", (req: Request, res: Response) => {
    try {
      const { number, name, start_date, end_date, config } = req.body;

      if (!number || !name || !start_date || !end_date) {
        res.status(400).json({
          error: "Required: number, name, start_date, end_date",
        });
        return;
      }

      const season = seasonManager.createSeason({
        number,
        name,
        start_date,
        end_date,
        config: config as Partial<SeasonConfig> | undefined,
      });

      res.status(201).json({
        season: {
          id: season.id,
          number: season.number,
          name: season.name,
          status: season.status,
          start_date: season.start_date,
          end_date: season.end_date,
        },
        message: `Season ${number} "${name}" created.`,
      });
    } catch (err) {
      if (err instanceof SeasonError) {
        res.status(400).json({ error: err.message });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  /**
   * POST /api/seasons/:id/start — Start a season.
   */
  app.post("/api/seasons/:id/start", (req: Request, res: Response) => {
    try {
      const season = seasonManager.startSeason(req.params.id);
      res.json({
        started: true,
        season: {
          id: season.id,
          number: season.number,
          name: season.name,
          status: season.status,
        },
        message: `Season ${season.number} is now active!`,
      });
    } catch (err) {
      if (err instanceof SeasonError) {
        res.status(400).json({ error: err.message });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  /**
   * POST /api/seasons/:id/end — End a season (take snapshot, apply ELO decay).
   */
  app.post("/api/seasons/:id/end", (req: Request, res: Response) => {
    try {
      const season = seasonManager.endSeason(req.params.id);
      res.json({
        ended: true,
        season: {
          id: season.id,
          number: season.number,
          name: season.name,
          status: season.status,
        },
        snapshot_summary: season.snapshot
          ? {
              total_agents: season.snapshot.total_agents,
              total_matches: season.snapshot.total_matches,
              highest_elo: season.snapshot.highest_elo,
              average_elo: season.snapshot.average_elo,
              champion: season.snapshot.top_agents[0]
                ? {
                    name: season.snapshot.top_agents[0].agent_name,
                    elo: season.snapshot.top_agents[0].elo,
                    reward: season.snapshot.top_agents[0].reward_title,
                  }
                : null,
            }
          : null,
        message: `Season ${season.number} completed! ELO soft-reset applied.`,
      });
    } catch (err) {
      if (err instanceof SeasonError) {
        res.status(400).json({ error: err.message });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  /**
   * GET /api/seasons/:id/rankings — Get season final rankings.
   */
  app.get("/api/seasons/:id/rankings", (req: Request, res: Response) => {
    const season = seasonManager.getSeason(req.params.id);
    if (!season) {
      res.status(404).json({ error: "Season not found" });
      return;
    }

    if (!season.snapshot) {
      res.status(400).json({
        error: "Season has no snapshot yet (still in progress or upcoming)",
      });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    res.json({
      season_id: season.id,
      season_name: season.name,
      rankings: season.snapshot.top_agents.slice(offset, offset + limit),
      total: season.snapshot.top_agents.length,
      tier_distribution: season.snapshot.tier_distribution,
    });
  });

  /**
   * GET /api/agents/:id/seasons — Get an agent's season history.
   */
  app.get("/api/agents/:id/seasons", (req: Request, res: Response) => {
    const history = seasonManager.getAgentSeasonHistory(req.params.id);
    res.json({ history });
  });
}
