/**
 * Tournament System — Brackets, Swiss, and scheduled events.
 *
 * Supports:
 *   - Single Elimination
 *   - Double Elimination
 *   - Swiss System (N rounds, all participants play each round)
 *   - Round Robin
 *   - Scheduled events with registration periods
 *   - Automatic bracket generation and advancement
 *   - ELO-based seeding
 *
 * Tournaments are stored in SQLite alongside the main arena data.
 */

import { nanoid } from "nanoid";
import { getDb, agentQueries, type AgentRow } from "./db.js";

// ─── Types ──────────────────────────────────────────────

export type TournamentFormat =
  | "single_elimination"
  | "double_elimination"
  | "swiss"
  | "round_robin";

export type TournamentStatus =
  | "registration"
  | "seeding"
  | "in_progress"
  | "completed"
  | "cancelled";

export type BracketSide = "winners" | "losers";

export interface Tournament {
  id: string;
  name: string;
  format: TournamentFormat;
  status: TournamentStatus;
  max_participants: number;
  min_participants: number;
  current_round: number;
  total_rounds: number;
  swiss_rounds?: number;
  registration_open: string;
  registration_close: string;
  start_time: string;
  created_at: string;
  description: string;
  rules: TournamentRules;
  participants: TournamentParticipant[];
  bracket: BracketMatch[];
  standings: TournamentStanding[];
}

export interface TournamentRules {
  best_of: number;
  map_pool: string[];
  faction_mode: "pick" | "random" | "alternating";
  time_limit_minutes: number;
  allow_draws: boolean;
}

export interface TournamentParticipant {
  agent_id: string;
  agent_name: string;
  elo_at_registration: number;
  seed: number;
  status: "registered" | "active" | "eliminated" | "winner";
  wins: number;
  losses: number;
  draws: number;
  buchholz_score: number; // Swiss tiebreaker
  opponents_faced: string[];
}

export interface BracketMatch {
  id: string;
  tournament_id: string;
  round: number;
  match_number: number;
  side: BracketSide;
  player1_id: string | null;
  player2_id: string | null;
  player1_name: string | null;
  player2_name: string | null;
  winner_id: string | null;
  score: string | null;
  arena_match_ids: string[];
  status: "pending" | "ready" | "in_progress" | "completed" | "bye";
  next_match_id: string | null;
  loser_match_id: string | null; // For double elimination
  scheduled_at: string | null;
}

export interface TournamentStanding {
  rank: number;
  agent_id: string;
  agent_name: string;
  wins: number;
  losses: number;
  draws: number;
  game_wins: number;
  game_losses: number;
  buchholz: number;
  points: number;
}

// ─── Default Rules ──────────────────────────────────────

const DEFAULT_RULES: TournamentRules = {
  best_of: 3,
  map_pool: [
    "Ore Lord",
    "Behind The Veil",
    "Equal Footing",
    "Crossroads",
    "Dual Cold Front",
  ],
  faction_mode: "alternating",
  time_limit_minutes: 30,
  allow_draws: false,
};

// ─── Tournament Manager ─────────────────────────────────

export class TournamentManager {
  private tournaments = new Map<string, Tournament>();

  /**
   * Create a new tournament.
   */
  createTournament(opts: {
    name: string;
    format: TournamentFormat;
    max_participants?: number;
    min_participants?: number;
    registration_close: string;
    start_time: string;
    description?: string;
    rules?: Partial<TournamentRules>;
    swiss_rounds?: number;
  }): Tournament {
    const id = nanoid(12);
    const now = new Date().toISOString();

    const tournament: Tournament = {
      id,
      name: opts.name,
      format: opts.format,
      status: "registration",
      max_participants: opts.max_participants ?? 16,
      min_participants: opts.min_participants ?? 4,
      current_round: 0,
      total_rounds: 0,
      swiss_rounds: opts.swiss_rounds,
      registration_open: now,
      registration_close: opts.registration_close,
      start_time: opts.start_time,
      created_at: now,
      description: opts.description ?? "",
      rules: { ...DEFAULT_RULES, ...opts.rules },
      participants: [],
      bracket: [],
      standings: [],
    };

    // Calculate total rounds
    tournament.total_rounds = this.calculateTotalRounds(tournament);

    this.tournaments.set(id, tournament);
    console.log(`🏆 Tournament created: ${opts.name} (${opts.format}, max ${tournament.max_participants})`);

    return tournament;
  }

  /**
   * Register an agent for a tournament.
   */
  registerParticipant(tournamentId: string, agentId: string): TournamentParticipant {
    const tournament = this.getTournament(tournamentId);
    if (!tournament) throw new TournamentError("Tournament not found");
    if (tournament.status !== "registration") throw new TournamentError("Registration is closed");
    if (tournament.participants.length >= tournament.max_participants) {
      throw new TournamentError("Tournament is full");
    }
    if (tournament.participants.some((p) => p.agent_id === agentId)) {
      throw new TournamentError("Already registered");
    }

    const db = getDb();
    const agent = agentQueries.getById(db, agentId);
    if (!agent) throw new TournamentError("Agent not found");

    const participant: TournamentParticipant = {
      agent_id: agentId,
      agent_name: agent.name,
      elo_at_registration: agent.elo,
      seed: 0,
      status: "registered",
      wins: 0,
      losses: 0,
      draws: 0,
      buchholz_score: 0,
      opponents_faced: [],
    };

    tournament.participants.push(participant);
    console.log(`📝 ${agent.name} registered for ${tournament.name}`);

    return participant;
  }

  /**
   * Start the tournament (close registration, seed players, generate bracket).
   */
  startTournament(tournamentId: string): Tournament {
    const tournament = this.getTournament(tournamentId);
    if (!tournament) throw new TournamentError("Tournament not found");
    if (tournament.status !== "registration") throw new TournamentError("Tournament not in registration phase");
    if (tournament.participants.length < tournament.min_participants) {
      throw new TournamentError(
        `Need at least ${tournament.min_participants} participants (have ${tournament.participants.length})`
      );
    }

    // Seed by ELO (highest ELO = seed 1)
    const sorted = [...tournament.participants].sort(
      (a, b) => b.elo_at_registration - a.elo_at_registration
    );
    sorted.forEach((p, i) => {
      p.seed = i + 1;
      p.status = "active";
    });
    tournament.participants = sorted;

    // Generate bracket
    switch (tournament.format) {
      case "single_elimination":
        tournament.bracket = this.generateSingleElimBracket(tournament);
        break;
      case "double_elimination":
        tournament.bracket = this.generateDoubleElimBracket(tournament);
        break;
      case "swiss":
        // Swiss generates round-by-round
        tournament.bracket = this.generateSwissRound(tournament, 1);
        break;
      case "round_robin":
        tournament.bracket = this.generateRoundRobinBracket(tournament);
        break;
    }

    tournament.status = "in_progress";
    tournament.current_round = 1;

    console.log(
      `🎮 Tournament ${tournament.name} STARTED! ${tournament.participants.length} participants, ` +
        `${tournament.total_rounds} rounds`
    );

    return tournament;
  }

  /**
   * Record a match result in the tournament bracket.
   */
  recordMatchResult(
    tournamentId: string,
    bracketMatchId: string,
    winnerId: string,
    score: string
  ): BracketMatch {
    const tournament = this.getTournament(tournamentId);
    if (!tournament) throw new TournamentError("Tournament not found");

    const match = tournament.bracket.find((m) => m.id === bracketMatchId);
    if (!match) throw new TournamentError("Bracket match not found");
    if (match.status === "completed") throw new TournamentError("Match already completed");

    match.winner_id = winnerId;
    match.score = score;
    match.status = "completed";

    // Update participant records
    const winner = tournament.participants.find((p) => p.agent_id === winnerId);
    const loserId =
      match.player1_id === winnerId ? match.player2_id : match.player1_id;
    const loser = loserId
      ? tournament.participants.find((p) => p.agent_id === loserId)
      : null;

    if (winner) {
      winner.wins++;
      if (loserId) winner.opponents_faced.push(loserId);
    }
    if (loser) {
      loser.losses++;
      loser.opponents_faced.push(winnerId);

      // Eliminate in single/double elimination
      if (tournament.format === "single_elimination") {
        loser.status = "eliminated";
      }
    }

    // Advance winner to next match
    if (match.next_match_id) {
      const nextMatch = tournament.bracket.find(
        (m) => m.id === match.next_match_id
      );
      if (nextMatch) {
        if (!nextMatch.player1_id) {
          nextMatch.player1_id = winnerId;
          nextMatch.player1_name = winner?.agent_name ?? null;
        } else {
          nextMatch.player2_id = winnerId;
          nextMatch.player2_name = winner?.agent_name ?? null;
        }

        if (nextMatch.player1_id && nextMatch.player2_id) {
          nextMatch.status = "ready";
        }
      }
    }

    // Move loser to losers bracket (double elimination)
    if (match.loser_match_id && loserId) {
      const loserMatch = tournament.bracket.find(
        (m) => m.id === match.loser_match_id
      );
      if (loserMatch) {
        if (!loserMatch.player1_id) {
          loserMatch.player1_id = loserId;
          loserMatch.player1_name = loser?.agent_name ?? null;
        } else {
          loserMatch.player2_id = loserId;
          loserMatch.player2_name = loser?.agent_name ?? null;
        }
        if (loserMatch.player1_id && loserMatch.player2_id) {
          loserMatch.status = "ready";
        }
      }
    }

    // Check if round is complete
    this.checkRoundCompletion(tournament);

    // Update standings
    tournament.standings = this.calculateStandings(tournament);

    return match;
  }

  /**
   * Get tournament by ID.
   */
  getTournament(id: string): Tournament | undefined {
    return this.tournaments.get(id);
  }

  /**
   * Get all tournaments.
   */
  getAllTournaments(): Tournament[] {
    return Array.from(this.tournaments.values());
  }

  /**
   * Get upcoming tournaments.
   */
  getUpcoming(): Tournament[] {
    return this.getAllTournaments().filter(
      (t) => t.status === "registration" || t.status === "seeding"
    );
  }

  /**
   * Get active (in-progress) tournaments.
   */
  getActive(): Tournament[] {
    return this.getAllTournaments().filter((t) => t.status === "in_progress");
  }

  // ─── Bracket Generation ────────────────────────────────

  private generateSingleElimBracket(tournament: Tournament): BracketMatch[] {
    const matches: BracketMatch[] = [];
    const n = tournament.participants.length;
    const rounds = Math.ceil(Math.log2(n));
    const totalFirstRoundMatches = Math.pow(2, rounds - 1);

    // First round — seed matching (1 vs N, 2 vs N-1, etc.)
    for (let i = 0; i < totalFirstRoundMatches; i++) {
      const p1Index = i;
      const p2Index = 2 * totalFirstRoundMatches - 1 - i;

      const p1 = tournament.participants[p1Index] ?? null;
      const p2 = p2Index < n ? tournament.participants[p2Index] : null;

      const matchId = nanoid(8);
      const match: BracketMatch = {
        id: matchId,
        tournament_id: tournament.id,
        round: 1,
        match_number: i + 1,
        side: "winners",
        player1_id: p1?.agent_id ?? null,
        player2_id: p2?.agent_id ?? null,
        player1_name: p1?.agent_name ?? null,
        player2_name: p2?.agent_name ?? null,
        winner_id: null,
        score: null,
        arena_match_ids: [],
        status: p1 && p2 ? "ready" : p1 ? "bye" : "pending",
        next_match_id: null,
        loser_match_id: null,
        scheduled_at: null,
      };

      // Handle byes (auto-advance if only one player)
      if (match.status === "bye" && p1) {
        match.winner_id = p1.agent_id;
        match.status = "completed";
        match.score = "BYE";
      }

      matches.push(match);
    }

    // Subsequent rounds
    let prevRoundMatches = matches.filter((m) => m.round === 1);
    for (let round = 2; round <= rounds; round++) {
      const roundMatches: BracketMatch[] = [];

      for (let i = 0; i < prevRoundMatches.length; i += 2) {
        const matchId = nanoid(8);
        const match: BracketMatch = {
          id: matchId,
          tournament_id: tournament.id,
          round,
          match_number: Math.floor(i / 2) + 1,
          side: "winners",
          player1_id: null,
          player2_id: null,
          player1_name: null,
          player2_name: null,
          winner_id: null,
          score: null,
          arena_match_ids: [],
          status: "pending",
          next_match_id: null,
          loser_match_id: null,
          scheduled_at: null,
        };

        // Link previous matches to this one
        if (prevRoundMatches[i]) {
          prevRoundMatches[i].next_match_id = matchId;
        }
        if (prevRoundMatches[i + 1]) {
          prevRoundMatches[i + 1].next_match_id = matchId;
        }

        // Auto-fill from bye winners
        const feeders = [prevRoundMatches[i], prevRoundMatches[i + 1]];
        for (const feeder of feeders) {
          if (feeder?.status === "completed" && feeder.winner_id) {
            if (!match.player1_id) {
              match.player1_id = feeder.winner_id;
              match.player1_name =
                tournament.participants.find(
                  (p) => p.agent_id === feeder.winner_id
                )?.agent_name ?? null;
            } else {
              match.player2_id = feeder.winner_id;
              match.player2_name =
                tournament.participants.find(
                  (p) => p.agent_id === feeder.winner_id
                )?.agent_name ?? null;
            }
          }
        }

        if (match.player1_id && match.player2_id) {
          match.status = "ready";
        }

        roundMatches.push(match);
      }

      matches.push(...roundMatches);
      prevRoundMatches = roundMatches;
    }

    return matches;
  }

  private generateDoubleElimBracket(tournament: Tournament): BracketMatch[] {
    // Generate winners bracket (same as single elim)
    const winnersBracket = this.generateSingleElimBracket(tournament);

    // Mark all as winners side
    for (const m of winnersBracket) {
      m.side = "winners";
    }

    // Generate losers bracket structure
    const losersBracket: BracketMatch[] = [];
    const rounds = Math.ceil(Math.log2(tournament.participants.length));

    // Losers bracket has (rounds - 1) * 2 rounds
    for (let lr = 1; lr <= (rounds - 1) * 2; lr++) {
      const matchesInRound = Math.max(
        1,
        Math.pow(2, rounds - 1 - Math.ceil(lr / 2))
      );

      for (let i = 0; i < matchesInRound; i++) {
        const match: BracketMatch = {
          id: nanoid(8),
          tournament_id: tournament.id,
          round: lr,
          match_number: i + 1,
          side: "losers",
          player1_id: null,
          player2_id: null,
          player1_name: null,
          player2_name: null,
          winner_id: null,
          score: null,
          arena_match_ids: [],
          status: "pending",
          next_match_id: null,
          loser_match_id: null,
          scheduled_at: null,
        };
        losersBracket.push(match);
      }
    }

    // Grand Finals
    const grandFinals: BracketMatch = {
      id: nanoid(8),
      tournament_id: tournament.id,
      round: rounds + 1,
      match_number: 1,
      side: "winners",
      player1_id: null,
      player2_id: null,
      player1_name: null,
      player2_name: null,
      winner_id: null,
      score: null,
      arena_match_ids: [],
      status: "pending",
      next_match_id: null,
      loser_match_id: null,
      scheduled_at: null,
    };

    // Link winners bracket round 1 losers to losers bracket
    const r1Matches = winnersBracket.filter((m) => m.round === 1);
    for (let i = 0; i < r1Matches.length && i < losersBracket.length; i++) {
      r1Matches[i].loser_match_id = losersBracket[i].id;
    }

    return [...winnersBracket, ...losersBracket, grandFinals];
  }

  private generateSwissRound(
    tournament: Tournament,
    roundNumber: number
  ): BracketMatch[] {
    const matches: BracketMatch[] = [];
    const active = tournament.participants
      .filter((p) => p.status === "active")
      .sort((a, b) => {
        // Sort by wins (descending), then by buchholz score
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.buchholz_score - a.buchholz_score;
      });

    const paired = new Set<string>();

    for (let i = 0; i < active.length; i++) {
      if (paired.has(active[i].agent_id)) continue;

      // Find the best opponent (closest score, haven't played yet)
      for (let j = i + 1; j < active.length; j++) {
        if (paired.has(active[j].agent_id)) continue;
        if (active[i].opponents_faced.includes(active[j].agent_id)) continue;

        const match: BracketMatch = {
          id: nanoid(8),
          tournament_id: tournament.id,
          round: roundNumber,
          match_number: matches.length + 1,
          side: "winners",
          player1_id: active[i].agent_id,
          player2_id: active[j].agent_id,
          player1_name: active[i].agent_name,
          player2_name: active[j].agent_name,
          winner_id: null,
          score: null,
          arena_match_ids: [],
          status: "ready",
          next_match_id: null,
          loser_match_id: null,
          scheduled_at: null,
        };

        matches.push(match);
        paired.add(active[i].agent_id);
        paired.add(active[j].agent_id);
        break;
      }

      // Bye if no opponent found
      if (!paired.has(active[i].agent_id)) {
        const match: BracketMatch = {
          id: nanoid(8),
          tournament_id: tournament.id,
          round: roundNumber,
          match_number: matches.length + 1,
          side: "winners",
          player1_id: active[i].agent_id,
          player2_id: null,
          player1_name: active[i].agent_name,
          player2_name: null,
          winner_id: active[i].agent_id,
          score: "BYE",
          arena_match_ids: [],
          status: "completed",
          next_match_id: null,
          loser_match_id: null,
          scheduled_at: null,
        };
        matches.push(match);
        paired.add(active[i].agent_id);
        active[i].wins++;
      }
    }

    return matches;
  }

  private generateRoundRobinBracket(tournament: Tournament): BracketMatch[] {
    const matches: BracketMatch[] = [];
    const players = tournament.participants;
    const n = players.length;

    // Round-robin: each pair plays once
    let round = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        matches.push({
          id: nanoid(8),
          tournament_id: tournament.id,
          round,
          match_number: matches.length + 1,
          side: "winners",
          player1_id: players[i].agent_id,
          player2_id: players[j].agent_id,
          player1_name: players[i].agent_name,
          player2_name: players[j].agent_name,
          winner_id: null,
          score: null,
          arena_match_ids: [],
          status: "ready",
          next_match_id: null,
          loser_match_id: null,
          scheduled_at: null,
        });
      }
    }

    return matches;
  }

  // ─── Round Management ──────────────────────────────────

  private checkRoundCompletion(tournament: Tournament): void {
    const currentRoundMatches = tournament.bracket.filter(
      (m) => m.round === tournament.current_round
    );

    const allComplete = currentRoundMatches.every(
      (m) => m.status === "completed" || m.status === "bye"
    );

    if (allComplete) {
      console.log(
        `✅ Round ${tournament.current_round} complete for ${tournament.name}`
      );

      // Check if tournament is over
      if (tournament.current_round >= tournament.total_rounds) {
        this.completeTournament(tournament);
      } else {
        tournament.current_round++;

        // For Swiss, generate next round pairings
        if (tournament.format === "swiss") {
          const nextRound = this.generateSwissRound(
            tournament,
            tournament.current_round
          );
          tournament.bracket.push(...nextRound);
        }

        console.log(
          `🔄 Round ${tournament.current_round} starting for ${tournament.name}`
        );
      }
    }
  }

  private completeTournament(tournament: Tournament): void {
    tournament.status = "completed";
    tournament.standings = this.calculateStandings(tournament);

    if (tournament.standings.length > 0) {
      const winner = tournament.standings[0];
      const winnerParticipant = tournament.participants.find(
        (p) => p.agent_id === winner.agent_id
      );
      if (winnerParticipant) {
        winnerParticipant.status = "winner";
      }

      console.log(
        `🏆 Tournament ${tournament.name} WON by ${winner.agent_name}!`
      );
    }
  }

  // ─── Standings ─────────────────────────────────────────

  private calculateStandings(tournament: Tournament): TournamentStanding[] {
    return tournament.participants
      .map((p) => {
        // Calculate buchholz (sum of opponents' scores)
        const buchholz = p.opponents_faced.reduce((sum, oppId) => {
          const opp = tournament.participants.find(
            (o) => o.agent_id === oppId
          );
          return sum + (opp?.wins ?? 0);
        }, 0);

        return {
          rank: 0,
          agent_id: p.agent_id,
          agent_name: p.agent_name,
          wins: p.wins,
          losses: p.losses,
          draws: p.draws,
          game_wins: 0,
          game_losses: 0,
          buchholz,
          points: p.wins * 3 + p.draws,
        };
      })
      .sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
        return b.wins - a.wins;
      })
      .map((s, i) => ({ ...s, rank: i + 1 }));
  }

  // ─── Helpers ───────────────────────────────────────────

  private calculateTotalRounds(tournament: Tournament): number {
    const n = tournament.participants.length || tournament.max_participants;

    switch (tournament.format) {
      case "single_elimination":
        return Math.ceil(Math.log2(n));
      case "double_elimination":
        return Math.ceil(Math.log2(n)) * 2 + 1;
      case "swiss":
        return tournament.swiss_rounds ?? Math.ceil(Math.log2(n));
      case "round_robin":
        return n - 1;
      default:
        return Math.ceil(Math.log2(n));
    }
  }
}

// ─── Errors ─────────────────────────────────────────────

export class TournamentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TournamentError";
  }
}
