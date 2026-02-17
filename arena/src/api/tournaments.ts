/**
 * Tournament API routes — Full tournament system with brackets, Swiss, and scheduled events.
 *
 * GET  /api/tournaments             — List upcoming and active tournaments
 * GET  /api/tournaments/:id         — Get tournament details (bracket, standings)
 * POST /api/tournaments             — Create a new tournament (admin)
 * POST /api/tournaments/:id/join    — Register for a tournament
 * POST /api/tournaments/:id/start   — Start a tournament (admin)
 * POST /api/tournaments/:id/result  — Record a match result in tournament bracket
 * GET  /api/tournaments/:id/bracket — Get tournament bracket
 * GET  /api/tournaments/:id/standings — Get tournament standings
 */

import type { Express, Request, Response } from "express";
import {
  TournamentManager,
  TournamentError,
  type TournamentFormat,
  type TournamentRules,
} from "../tournament-system.js";

// Singleton tournament manager
const tournamentManager = new TournamentManager();

export { tournamentManager };

export function registerTournamentRoutes(app: Express): void {
  /**
   * GET /api/tournaments — List all tournaments.
   * Query params: status (registration|in_progress|completed), limit, offset
   */
  app.get("/api/tournaments", (req: Request, res: Response) => {
    const statusFilter = req.query.status as string | undefined;
    let tournaments = tournamentManager.getAllTournaments();

    if (statusFilter) {
      tournaments = tournaments.filter((t) => t.status === statusFilter);
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const total = tournaments.length;
    const page = tournaments.slice(offset, offset + limit);

    res.json({
      tournaments: page.map((t) => ({
        id: t.id,
        name: t.name,
        format: t.format,
        status: t.status,
        participants: t.participants.length,
        max_participants: t.max_participants,
        current_round: t.current_round,
        total_rounds: t.total_rounds,
        registration_close: t.registration_close,
        start_time: t.start_time,
        created_at: t.created_at,
        description: t.description,
      })),
      total,
      limit,
      offset,
    });
  });

  /**
   * GET /api/tournaments/:id — Full tournament details.
   */
  app.get("/api/tournaments/:id", (req: Request, res: Response) => {
    const tournament = tournamentManager.getTournament(req.params.id);
    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }

    res.json({
      tournament: {
        id: tournament.id,
        name: tournament.name,
        format: tournament.format,
        status: tournament.status,
        max_participants: tournament.max_participants,
        min_participants: tournament.min_participants,
        current_round: tournament.current_round,
        total_rounds: tournament.total_rounds,
        registration_open: tournament.registration_open,
        registration_close: tournament.registration_close,
        start_time: tournament.start_time,
        created_at: tournament.created_at,
        description: tournament.description,
        rules: tournament.rules,
        participants: tournament.participants,
        bracket: tournament.bracket,
        standings: tournament.standings,
      },
    });
  });

  /**
   * POST /api/tournaments — Create a new tournament.
   *
   * Body: {
   *   name: string,
   *   format: "single_elimination" | "double_elimination" | "swiss" | "round_robin",
   *   max_participants?: number,
   *   min_participants?: number,
   *   registration_close: string (ISO date),
   *   start_time: string (ISO date),
   *   description?: string,
   *   rules?: Partial<TournamentRules>,
   *   swiss_rounds?: number
   * }
   */
  app.post("/api/tournaments", (req: Request, res: Response) => {
    try {
      const {
        name,
        format,
        max_participants,
        min_participants,
        registration_close,
        start_time,
        description,
        rules,
        swiss_rounds,
      } = req.body;

      if (!name || !format || !registration_close || !start_time) {
        res.status(400).json({
          error: "Required fields: name, format, registration_close, start_time",
        });
        return;
      }

      const validFormats: TournamentFormat[] = [
        "single_elimination",
        "double_elimination",
        "swiss",
        "round_robin",
      ];
      if (!validFormats.includes(format)) {
        res.status(400).json({
          error: `Invalid format. Must be one of: ${validFormats.join(", ")}`,
        });
        return;
      }

      const tournament = tournamentManager.createTournament({
        name,
        format,
        max_participants,
        min_participants,
        registration_close,
        start_time,
        description,
        rules: rules as Partial<TournamentRules> | undefined,
        swiss_rounds,
      });

      res.status(201).json({
        tournament: {
          id: tournament.id,
          name: tournament.name,
          format: tournament.format,
          status: tournament.status,
          max_participants: tournament.max_participants,
          total_rounds: tournament.total_rounds,
          registration_close: tournament.registration_close,
          start_time: tournament.start_time,
        },
        message: `Tournament "${name}" created. Registration is open.`,
      });
    } catch (err) {
      if (err instanceof TournamentError) {
        res.status(400).json({ error: err.message });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  /**
   * POST /api/tournaments/:id/join — Register for a tournament.
   *
   * Body: { agent_id: string }
   */
  app.post("/api/tournaments/:id/join", (req: Request, res: Response) => {
    try {
      const { agent_id } = req.body;
      if (!agent_id) {
        res.status(400).json({ error: "Required: agent_id" });
        return;
      }

      const participant = tournamentManager.registerParticipant(
        req.params.id,
        agent_id
      );

      res.json({
        registered: true,
        participant: {
          agent_id: participant.agent_id,
          agent_name: participant.agent_name,
          elo_at_registration: participant.elo_at_registration,
          seed: participant.seed,
        },
        message: `${participant.agent_name} registered for tournament.`,
      });
    } catch (err) {
      if (err instanceof TournamentError) {
        const status =
          err.message === "Tournament not found"
            ? 404
            : err.message === "Already registered"
              ? 409
              : 400;
        res.status(status).json({ error: err.message });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  /**
   * POST /api/tournaments/:id/start — Start a tournament (close registration, seed, generate bracket).
   */
  app.post("/api/tournaments/:id/start", (req: Request, res: Response) => {
    try {
      const tournament = tournamentManager.startTournament(req.params.id);

      res.json({
        started: true,
        tournament: {
          id: tournament.id,
          name: tournament.name,
          status: tournament.status,
          current_round: tournament.current_round,
          total_rounds: tournament.total_rounds,
          participants: tournament.participants.length,
          ready_matches: tournament.bracket.filter((m) => m.status === "ready").length,
        },
        message: `Tournament "${tournament.name}" is now in progress!`,
      });
    } catch (err) {
      if (err instanceof TournamentError) {
        res.status(400).json({ error: err.message });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  /**
   * POST /api/tournaments/:id/result — Record a bracket match result.
   *
   * Body: { bracket_match_id: string, winner_id: string, score: string }
   */
  app.post("/api/tournaments/:id/result", (req: Request, res: Response) => {
    try {
      const { bracket_match_id, winner_id, score } = req.body;
      if (!bracket_match_id || !winner_id || !score) {
        res.status(400).json({
          error: "Required: bracket_match_id, winner_id, score",
        });
        return;
      }

      const match = tournamentManager.recordMatchResult(
        req.params.id,
        bracket_match_id,
        winner_id,
        score
      );

      const tournament = tournamentManager.getTournament(req.params.id);

      res.json({
        match: {
          id: match.id,
          round: match.round,
          winner_id: match.winner_id,
          score: match.score,
          status: match.status,
          next_match_id: match.next_match_id,
        },
        tournament_status: tournament?.status,
        current_round: tournament?.current_round,
        standings: tournament?.standings.slice(0, 5),
      });
    } catch (err) {
      if (err instanceof TournamentError) {
        res.status(400).json({ error: err.message });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  /**
   * GET /api/tournaments/:id/bracket — Get tournament bracket.
   */
  app.get("/api/tournaments/:id/bracket", (req: Request, res: Response) => {
    const tournament = tournamentManager.getTournament(req.params.id);
    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }

    const byRound = new Map<number, typeof tournament.bracket>();
    for (const match of tournament.bracket) {
      const existing = byRound.get(match.round) ?? [];
      existing.push(match);
      byRound.set(match.round, existing);
    }

    res.json({
      tournament_id: tournament.id,
      format: tournament.format,
      current_round: tournament.current_round,
      total_rounds: tournament.total_rounds,
      bracket: tournament.bracket,
      rounds: Object.fromEntries(byRound),
    });
  });

  /**
   * GET /api/tournaments/:id/standings — Get tournament standings.
   */
  app.get("/api/tournaments/:id/standings", (req: Request, res: Response) => {
    const tournament = tournamentManager.getTournament(req.params.id);
    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }

    res.json({
      tournament_id: tournament.id,
      name: tournament.name,
      status: tournament.status,
      standings: tournament.standings,
    });
  });
}
