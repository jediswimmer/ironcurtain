/**
 * Database Layer — SQLite via better-sqlite3
 *
 * Lightweight, zero-config persistence for the Arena.
 * Tables: agents, matches, match_events, queue_history
 *
 * In production this could migrate to PostgreSQL, but SQLite
 * is plenty fast for thousands of agents and tens of thousands of matches.
 */

import Database from "better-sqlite3";
import { resolve } from "path";

const DB_PATH = process.env.ARENA_DB_PATH ?? resolve("data", "arena.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    _db.pragma("busy_timeout = 5000");
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    -- ─── Agents ──────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS agents (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL UNIQUE,
      api_key_hash  TEXT NOT NULL UNIQUE,
      elo           INTEGER NOT NULL DEFAULT 1200,
      peak_elo      INTEGER NOT NULL DEFAULT 1200,
      games_played  INTEGER NOT NULL DEFAULT 0,
      wins          INTEGER NOT NULL DEFAULT 0,
      losses        INTEGER NOT NULL DEFAULT 0,
      draws         INTEGER NOT NULL DEFAULT 0,
      current_streak INTEGER NOT NULL DEFAULT 0,
      faction_history TEXT NOT NULL DEFAULT '[]',   -- JSON array of recent factions
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      last_active   TEXT NOT NULL DEFAULT (datetime('now')),
      status        TEXT NOT NULL DEFAULT 'active'  -- active | suspended | banned
    );

    CREATE INDEX IF NOT EXISTS idx_agents_elo ON agents(elo DESC);
    CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
    CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key_hash);

    -- ─── Matches ─────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS matches (
      id            TEXT PRIMARY KEY,
      mode          TEXT NOT NULL DEFAULT 'ranked_1v1',
      agent1_id     TEXT NOT NULL REFERENCES agents(id),
      agent2_id     TEXT NOT NULL REFERENCES agents(id),
      agent1_faction TEXT NOT NULL,
      agent2_faction TEXT NOT NULL,
      map           TEXT NOT NULL,
      winner_id     TEXT REFERENCES agents(id),
      is_draw       INTEGER NOT NULL DEFAULT 0,
      duration_secs INTEGER,
      replay_path   TEXT,
      elo_change_1  INTEGER,
      elo_change_2  INTEGER,
      status        TEXT NOT NULL DEFAULT 'pending',  -- pending | running | completed | cancelled | error
      started_at    TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at      TEXT,
      server_port   INTEGER,
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
    CREATE INDEX IF NOT EXISTS idx_matches_agent1 ON matches(agent1_id);
    CREATE INDEX IF NOT EXISTS idx_matches_agent2 ON matches(agent2_id);
    CREATE INDEX IF NOT EXISTS idx_matches_started ON matches(started_at DESC);

    -- ─── Match Events ────────────────────────────────────

    CREATE TABLE IF NOT EXISTS match_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id   TEXT NOT NULL REFERENCES matches(id),
      tick       INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      agent_id   TEXT,
      data       TEXT NOT NULL DEFAULT '{}',  -- JSON blob
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_match_events_match ON match_events(match_id, tick);

    -- ─── Queue History ───────────────────────────────────

    CREATE TABLE IF NOT EXISTS queue_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id      TEXT NOT NULL REFERENCES agents(id),
      mode          TEXT NOT NULL,
      elo_at_queue  INTEGER NOT NULL,
      wait_time_ms  INTEGER NOT NULL,
      matched       INTEGER NOT NULL DEFAULT 0,     -- 1 = found match, 0 = timeout/cancel
      opponent_id   TEXT REFERENCES agents(id),
      elo_diff      INTEGER,
      match_id      TEXT REFERENCES matches(id),
      queued_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_queue_history_agent ON queue_history(agent_id);

    -- ─── Per-Mode Ratings ────────────────────────────────

    CREATE TABLE IF NOT EXISTS agent_mode_ratings (
      agent_id TEXT NOT NULL REFERENCES agents(id),
      mode     TEXT NOT NULL,
      elo      INTEGER NOT NULL DEFAULT 1200,
      games    INTEGER NOT NULL DEFAULT 0,
      wins     INTEGER NOT NULL DEFAULT 0,
      losses   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agent_id, mode)
    );

    -- ─── Agent Faction Stats ─────────────────────────────

    CREATE TABLE IF NOT EXISTS agent_faction_stats (
      agent_id TEXT NOT NULL REFERENCES agents(id),
      faction  TEXT NOT NULL,
      games    INTEGER NOT NULL DEFAULT 0,
      wins     INTEGER NOT NULL DEFAULT 0,
      losses   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agent_id, faction)
    );
  `);
}

// ─── Typed Query Helpers ────────────────────────────────

export interface AgentRow {
  id: string;
  name: string;
  api_key_hash: string;
  elo: number;
  peak_elo: number;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  current_streak: number;
  faction_history: string;
  created_at: string;
  last_active: string;
  status: string;
}

export interface MatchRow {
  id: string;
  mode: string;
  agent1_id: string;
  agent2_id: string;
  agent1_faction: string;
  agent2_faction: string;
  map: string;
  winner_id: string | null;
  is_draw: number;
  duration_secs: number | null;
  replay_path: string | null;
  elo_change_1: number | null;
  elo_change_2: number | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  server_port: number | null;
  error_message: string | null;
}

export interface MatchEventRow {
  id: number;
  match_id: string;
  tick: number;
  event_type: string;
  agent_id: string | null;
  data: string;
  created_at: string;
}

export interface QueueHistoryRow {
  id: number;
  agent_id: string;
  mode: string;
  elo_at_queue: number;
  wait_time_ms: number;
  matched: number;
  opponent_id: string | null;
  elo_diff: number | null;
  match_id: string | null;
  queued_at: string;
}

export interface ModeRatingRow {
  agent_id: string;
  mode: string;
  elo: number;
  games: number;
  wins: number;
  losses: number;
}

export interface FactionStatsRow {
  agent_id: string;
  faction: string;
  games: number;
  wins: number;
  losses: number;
}

// ─── Agent Queries ──────────────────────────────────────

export const agentQueries = {
  insert(db: Database.Database, agent: Pick<AgentRow, "id" | "name" | "api_key_hash">) {
    return db.prepare(`
      INSERT INTO agents (id, name, api_key_hash) VALUES (?, ?, ?)
    `).run(agent.id, agent.name, agent.api_key_hash);
  },

  getById(db: Database.Database, id: string): AgentRow | undefined {
    return db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
  },

  getByName(db: Database.Database, name: string): AgentRow | undefined {
    return db.prepare("SELECT * FROM agents WHERE name = ?").get(name) as AgentRow | undefined;
  },

  getByApiKeyHash(db: Database.Database, hash: string): AgentRow | undefined {
    return db.prepare("SELECT * FROM agents WHERE api_key_hash = ?").get(hash) as AgentRow | undefined;
  },

  updateElo(db: Database.Database, id: string, newElo: number, peakElo: number) {
    return db.prepare(`
      UPDATE agents SET elo = ?, peak_elo = MAX(peak_elo, ?), last_active = datetime('now')
      WHERE id = ?
    `).run(newElo, peakElo, id);
  },

  incrementWin(db: Database.Database, id: string) {
    return db.prepare(`
      UPDATE agents SET
        wins = wins + 1,
        games_played = games_played + 1,
        current_streak = CASE WHEN current_streak > 0 THEN current_streak + 1 ELSE 1 END,
        last_active = datetime('now')
      WHERE id = ?
    `).run(id);
  },

  incrementLoss(db: Database.Database, id: string) {
    return db.prepare(`
      UPDATE agents SET
        losses = losses + 1,
        games_played = games_played + 1,
        current_streak = CASE WHEN current_streak < 0 THEN current_streak - 1 ELSE -1 END,
        last_active = datetime('now')
      WHERE id = ?
    `).run(id);
  },

  incrementDraw(db: Database.Database, id: string) {
    return db.prepare(`
      UPDATE agents SET
        draws = draws + 1,
        games_played = games_played + 1,
        current_streak = 0,
        last_active = datetime('now')
      WHERE id = ?
    `).run(id);
  },

  updateFactionHistory(db: Database.Database, id: string, history: string[]) {
    return db.prepare(`
      UPDATE agents SET faction_history = ? WHERE id = ?
    `).run(JSON.stringify(history), id);
  },

  getLeaderboard(
    db: Database.Database,
    opts: { limit: number; offset: number; minGames?: number }
  ): AgentRow[] {
    const minGames = opts.minGames ?? 0;
    return db.prepare(`
      SELECT * FROM agents
      WHERE status = 'active' AND games_played >= ?
      ORDER BY elo DESC
      LIMIT ? OFFSET ?
    `).all(minGames, opts.limit, opts.offset) as AgentRow[];
  },

  count(db: Database.Database, minGames: number = 0): number {
    const row = db.prepare(`
      SELECT COUNT(*) as cnt FROM agents WHERE status = 'active' AND games_played >= ?
    `).get(minGames) as { cnt: number };
    return row.cnt;
  },
};

// ─── Match Queries ──────────────────────────────────────

export const matchQueries = {
  insert(db: Database.Database, match: Pick<
    MatchRow,
    "id" | "mode" | "agent1_id" | "agent2_id" | "agent1_faction" | "agent2_faction" | "map"
  >) {
    return db.prepare(`
      INSERT INTO matches (id, mode, agent1_id, agent2_id, agent1_faction, agent2_faction, map, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(match.id, match.mode, match.agent1_id, match.agent2_id, match.agent1_faction, match.agent2_faction, match.map);
  },

  getById(db: Database.Database, id: string): MatchRow | undefined {
    return db.prepare("SELECT * FROM matches WHERE id = ?").get(id) as MatchRow | undefined;
  },

  setRunning(db: Database.Database, id: string, serverPort: number) {
    return db.prepare(`
      UPDATE matches SET status = 'running', server_port = ?, started_at = datetime('now')
      WHERE id = ?
    `).run(serverPort, id);
  },

  setCompleted(
    db: Database.Database,
    id: string,
    winnerId: string | null,
    isDraw: boolean,
    durationSecs: number,
    eloChange1: number,
    eloChange2: number,
    replayPath?: string
  ) {
    return db.prepare(`
      UPDATE matches SET
        status = 'completed',
        winner_id = ?,
        is_draw = ?,
        duration_secs = ?,
        elo_change_1 = ?,
        elo_change_2 = ?,
        replay_path = ?,
        ended_at = datetime('now')
      WHERE id = ?
    `).run(winnerId, isDraw ? 1 : 0, durationSecs, eloChange1, eloChange2, replayPath ?? null, id);
  },

  setError(db: Database.Database, id: string, message: string) {
    return db.prepare(`
      UPDATE matches SET status = 'error', error_message = ?, ended_at = datetime('now')
      WHERE id = ?
    `).run(message, id);
  },

  setCancelled(db: Database.Database, id: string) {
    return db.prepare(`
      UPDATE matches SET status = 'cancelled', ended_at = datetime('now')
      WHERE id = ?
    `).run(id);
  },

  getLive(db: Database.Database): MatchRow[] {
    return db.prepare(`
      SELECT * FROM matches WHERE status = 'running' ORDER BY started_at DESC
    `).all() as MatchRow[];
  },

  getRecent(
    db: Database.Database,
    opts: { limit: number; offset: number; agentId?: string; mode?: string }
  ): MatchRow[] {
    let sql = "SELECT * FROM matches WHERE status = 'completed'";
    const params: unknown[] = [];

    if (opts.agentId) {
      sql += " AND (agent1_id = ? OR agent2_id = ?)";
      params.push(opts.agentId, opts.agentId);
    }
    if (opts.mode) {
      sql += " AND mode = ?";
      params.push(opts.mode);
    }

    sql += " ORDER BY ended_at DESC LIMIT ? OFFSET ?";
    params.push(opts.limit, opts.offset);

    return db.prepare(sql).all(...params) as MatchRow[];
  },

  countByAgent(db: Database.Database, agentId: string): number {
    const row = db.prepare(`
      SELECT COUNT(*) as cnt FROM matches
      WHERE status = 'completed' AND (agent1_id = ? OR agent2_id = ?)
    `).get(agentId, agentId) as { cnt: number };
    return row.cnt;
  },
};

// ─── Match Event Queries ────────────────────────────────

export const eventQueries = {
  insert(db: Database.Database, event: Pick<MatchEventRow, "match_id" | "tick" | "event_type" | "agent_id" | "data">) {
    return db.prepare(`
      INSERT INTO match_events (match_id, tick, event_type, agent_id, data)
      VALUES (?, ?, ?, ?, ?)
    `).run(event.match_id, event.tick, event.event_type, event.agent_id ?? null, event.data);
  },

  getByMatch(db: Database.Database, matchId: string): MatchEventRow[] {
    return db.prepare(`
      SELECT * FROM match_events WHERE match_id = ? ORDER BY tick ASC
    `).all(matchId) as MatchEventRow[];
  },
};

// ─── Queue History Queries ──────────────────────────────

export const queueQueries = {
  insert(db: Database.Database, entry: Pick<
    QueueHistoryRow,
    "agent_id" | "mode" | "elo_at_queue" | "wait_time_ms" | "matched" | "opponent_id" | "elo_diff" | "match_id"
  >) {
    return db.prepare(`
      INSERT INTO queue_history (agent_id, mode, elo_at_queue, wait_time_ms, matched, opponent_id, elo_diff, match_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.agent_id, entry.mode, entry.elo_at_queue, entry.wait_time_ms,
      entry.matched, entry.opponent_id ?? null, entry.elo_diff ?? null, entry.match_id ?? null
    );
  },

  avgWaitTime(db: Database.Database, mode: string): number {
    const row = db.prepare(`
      SELECT AVG(wait_time_ms) as avg_wait FROM queue_history
      WHERE mode = ? AND matched = 1 AND queued_at > datetime('now', '-1 hour')
    `).get(mode) as { avg_wait: number | null };
    return row.avg_wait ?? 0;
  },
};

// ─── Faction Stats Queries ──────────────────────────────

export const factionStatsQueries = {
  upsertWin(db: Database.Database, agentId: string, faction: string) {
    return db.prepare(`
      INSERT INTO agent_faction_stats (agent_id, faction, games, wins, losses)
      VALUES (?, ?, 1, 1, 0)
      ON CONFLICT(agent_id, faction)
      DO UPDATE SET games = games + 1, wins = wins + 1
    `).run(agentId, faction);
  },

  upsertLoss(db: Database.Database, agentId: string, faction: string) {
    return db.prepare(`
      INSERT INTO agent_faction_stats (agent_id, faction, games, wins, losses)
      VALUES (?, ?, 1, 0, 1)
      ON CONFLICT(agent_id, faction)
      DO UPDATE SET games = games + 1, losses = losses + 1
    `).run(agentId, faction);
  },

  upsertDraw(db: Database.Database, agentId: string, faction: string) {
    return db.prepare(`
      INSERT INTO agent_faction_stats (agent_id, faction, games, wins, losses)
      VALUES (?, ?, 1, 0, 0)
      ON CONFLICT(agent_id, faction)
      DO UPDATE SET games = games + 1
    `).run(agentId, faction);
  },

  getByAgent(db: Database.Database, agentId: string): FactionStatsRow[] {
    return db.prepare(`
      SELECT * FROM agent_faction_stats WHERE agent_id = ?
    `).all(agentId) as FactionStatsRow[];
  },
};

// ─── Mode Rating Queries ────────────────────────────────

export const modeRatingQueries = {
  getOrCreate(db: Database.Database, agentId: string, mode: string): ModeRatingRow {
    const existing = db.prepare(`
      SELECT * FROM agent_mode_ratings WHERE agent_id = ? AND mode = ?
    `).get(agentId, mode) as ModeRatingRow | undefined;

    if (existing) return existing;

    db.prepare(`
      INSERT INTO agent_mode_ratings (agent_id, mode) VALUES (?, ?)
    `).run(agentId, mode);

    return { agent_id: agentId, mode, elo: 1200, games: 0, wins: 0, losses: 0 };
  },

  updateAfterWin(db: Database.Database, agentId: string, mode: string, newElo: number) {
    return db.prepare(`
      UPDATE agent_mode_ratings SET elo = ?, games = games + 1, wins = wins + 1
      WHERE agent_id = ? AND mode = ?
    `).run(newElo, agentId, mode);
  },

  updateAfterLoss(db: Database.Database, agentId: string, mode: string, newElo: number) {
    return db.prepare(`
      UPDATE agent_mode_ratings SET elo = ?, games = games + 1, losses = losses + 1
      WHERE agent_id = ? AND mode = ?
    `).run(newElo, agentId, mode);
  },
};

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
