/**
 * Challenge Mode API — Human vs AI matches.
 *
 * POST /api/challenge            — Create a challenge request
 * GET  /api/challenge/:id        — Get challenge status
 * POST /api/challenge/:id/cancel — Cancel a pending challenge
 * GET  /api/challenge/pending    — List pending challenges
 * GET  /api/challenge/stats      — Global challenge statistics
 * POST /api/challenge/:id/result — Record challenge result
 */

import type { Express, Request, Response } from "express";
import { ChallengeMode, type ChallengeResult } from "../challenge-mode.js";

const challengeMode = new ChallengeMode();

export { challengeMode };

export function registerChallengeRoutes(app: Express): void {
  /**
   * POST /api/challenge — Create a challenge request.
   *
   * Body: {
   *   human_name: string,
   *   human_id: string,
   *   target_agent_id?: string,
   *   target_elo_range?: [number, number],
   *   faction_preference?: "allies" | "soviet" | "random",
   *   map_preference?: string
   * }
   */
  app.post("/api/challenge", (req: Request, res: Response) => {
    const {
      human_name,
      human_id,
      target_agent_id,
      target_elo_range,
      faction_preference,
      map_preference,
    } = req.body;

    if (!human_name || !human_id) {
      res.status(400).json({ error: "Required: human_name, human_id" });
      return;
    }

    const challenge = challengeMode.createChallenge({
      humanName: human_name,
      humanId: human_id,
      targetAgentId: target_agent_id,
      targetEloRange: target_elo_range,
      factionPreference: faction_preference,
      mapPreference: map_preference,
    });

    res.status(201).json({
      challenge: {
        id: challenge.id,
        human_name: challenge.human_name,
        target_agent_id: challenge.target_agent_id,
        faction_preference: challenge.faction_preference,
        status: challenge.status,
        expires_at: new Date(challenge.expires_at).toISOString(),
      },
      apm_profile: challengeMode.getApmProfile(),
      message: `Challenge created! Waiting for ${target_agent_id ?? "any AI"} opponent.`,
    });
  });

  /**
   * GET /api/challenge/:id — Get challenge status.
   */
  app.get("/api/challenge/:id", (req: Request, res: Response) => {
    const challenge = challengeMode.getChallenge(req.params.id);
    if (!challenge) {
      res.status(404).json({ error: "Challenge not found" });
      return;
    }

    res.json({
      challenge: {
        id: challenge.id,
        human_name: challenge.human_name,
        human_id: challenge.human_id,
        target_agent_id: challenge.target_agent_id,
        faction_preference: challenge.faction_preference,
        map_preference: challenge.map_preference,
        status: challenge.status,
        created_at: new Date(challenge.created_at).toISOString(),
        expires_at: new Date(challenge.expires_at).toISOString(),
        match_id: challenge.match_id,
        result: challenge.result,
      },
    });
  });

  /**
   * POST /api/challenge/:id/cancel — Cancel a pending challenge.
   */
  app.post("/api/challenge/:id/cancel", (req: Request, res: Response) => {
    const cancelled = challengeMode.cancelChallenge(req.params.id);
    if (!cancelled) {
      res.status(400).json({
        error: "Cannot cancel — challenge not found or not in 'waiting' status",
      });
      return;
    }

    res.json({ cancelled: true, message: "Challenge cancelled." });
  });

  /**
   * GET /api/challenge/pending — List pending challenges waiting for opponents.
   */
  app.get("/api/challenge/pending", (_req: Request, res: Response) => {
    // Clean up expired first
    const expired = challengeMode.cleanupExpired();
    const pending = challengeMode.getPending();

    res.json({
      challenges: pending.map((c) => ({
        id: c.id,
        human_name: c.human_name,
        target_agent_id: c.target_agent_id,
        target_elo_range: c.target_elo_range,
        faction_preference: c.faction_preference,
        map_preference: c.map_preference,
        created_at: new Date(c.created_at).toISOString(),
        expires_at: new Date(c.expires_at).toISOString(),
      })),
      total: pending.length,
      expired_cleaned: expired,
    });
  });

  /**
   * GET /api/challenge/stats — Global challenge statistics.
   */
  app.get("/api/challenge/stats", (_req: Request, res: Response) => {
    const stats = challengeMode.getStats();
    res.json({ stats });
  });

  /**
   * POST /api/challenge/:id/result — Record a challenge match result.
   *
   * Body: {
   *   winner: "human" | "ai" | "draw",
   *   ai_name: string,
   *   ai_elo: number,
   *   duration_secs: number,
   *   map: string,
   *   human_faction: string,
   *   ai_faction: string
   * }
   */
  app.post("/api/challenge/:id/result", (req: Request, res: Response) => {
    const challenge = challengeMode.getChallenge(req.params.id);
    if (!challenge) {
      res.status(404).json({ error: "Challenge not found" });
      return;
    }

    const { winner, ai_name, ai_elo, duration_secs, map, human_faction, ai_faction } =
      req.body;

    if (!winner || !ai_name || ai_elo === undefined || !duration_secs || !map) {
      res.status(400).json({
        error: "Required: winner, ai_name, ai_elo, duration_secs, map, human_faction, ai_faction",
      });
      return;
    }

    const result: ChallengeResult = {
      winner,
      human_name: challenge.human_name,
      ai_name,
      ai_elo,
      duration_secs,
      map,
      human_faction: human_faction ?? "random",
      ai_faction: ai_faction ?? "random",
    };

    challengeMode.recordResult(req.params.id, result);

    res.json({
      recorded: true,
      result,
      updated_stats: challengeMode.getStats(),
    });
  });
}
