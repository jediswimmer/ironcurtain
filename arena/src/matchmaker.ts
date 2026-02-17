/**
 * Matchmaker — ELO-based agent pairing system.
 *
 * Runs on a tick (every 5 seconds), scans the queue, and pairs agents
 * with similar ratings. ELO range widens over time so nobody waits forever.
 *
 * Features:
 *   - ELO-range matching (±200, widening over time)
 *   - Faction rotation enforcement (round-robin across matches)
 *   - Queue timeout handling (5 min default)
 *   - Mode support: ranked_1v1, casual_1v1, tournament
 *   - WebSocket notifications when match found
 */

import { WebSocket } from "ws";
import { getDb, agentQueries, queueQueries } from "./db.js";

// ─── Types ──────────────────────────────────────────────

export type GameMode = "ranked_1v1" | "casual_1v1" | "tournament";
export type Faction = "allies" | "soviet";
export type FactionPreference = Faction | "random";

export interface QueueEntry {
  agent_id: string;
  agent_name: string;
  mode: GameMode;
  faction_preference: FactionPreference;
  elo: number;
  elo_range: number;
  joined_at: number;
  ws?: WebSocket;
}

export interface MatchPairing {
  id?: string;   // Set when match is created in DB
  mode: GameMode;
  map: string;
  players: [MatchPlayer, MatchPlayer];
}

export interface MatchPlayer {
  agent_id: string;
  agent_name: string;
  faction: Faction;
  elo: number;
}

// ─── Constants ──────────────────────────────────────────

const INITIAL_ELO_RANGE = 200;
const MAX_ELO_RANGE = 500;
const RANGE_WIDEN_PER_30S = 50;
const QUEUE_TIMEOUT_MS = 5 * 60 * 1000;  // 5 minutes

const FACTION_ROTATION_WINDOW = 3; // Enforce rotation every N games

// Map pool — maps for 1v1
const MAP_POOL_1V1 = [
  "Ore Lord",
  "Behind The Veil",
  "Coastline Clash",
  "Forgotten Plains",
  "Dual Cold Front",
  "Pinch Point",
  "Equal Footing",
  "Crossroads",
];

// ─── Matchmaker ─────────────────────────────────────────

export class Matchmaker {
  private queues = new Map<GameMode, QueueEntry[]>();
  private queueConnections = new Map<string, WebSocket>();

  /** Add an agent to the matchmaking queue. */
  addToQueue(entry: QueueEntry): void {
    const mode = entry.mode;
    const queue = this.queues.get(mode) ?? [];

    // Prevent duplicate entries
    if (queue.some(e => e.agent_id === entry.agent_id)) {
      throw new MatchmakerError("Agent already in queue");
    }

    // Check if agent is already in any queue
    for (const [, q] of this.queues) {
      if (q.some(e => e.agent_id === entry.agent_id)) {
        throw new MatchmakerError("Agent is already in a queue (different mode)");
      }
    }

    entry.elo_range = INITIAL_ELO_RANGE;
    entry.joined_at = Date.now();
    queue.push(entry);
    this.queues.set(mode, queue);

    console.log(`📋 ${entry.agent_name} (ELO ${entry.elo}) joined ${mode} queue`);
  }

  /** Remove agent from all queues. */
  removeFromQueue(agentId: string): boolean {
    let removed = false;
    for (const [mode, queue] of this.queues) {
      const filtered = queue.filter(e => e.agent_id !== agentId);
      if (filtered.length !== queue.length) {
        removed = true;
        this.queues.set(mode, filtered);
      }
    }
    this.queueConnections.delete(agentId);
    return removed;
  }

  /** Get agent's queue status. */
  getQueueStatus(agentId: string): {
    in_queue: boolean;
    position?: number;
    mode?: string;
    wait_time_ms?: number;
  } {
    for (const [mode, queue] of this.queues) {
      const idx = queue.findIndex(e => e.agent_id === agentId);
      if (idx >= 0) {
        return {
          in_queue: true,
          position: idx + 1,
          mode,
          wait_time_ms: Date.now() - queue[idx].joined_at,
        };
      }
    }
    return { in_queue: false };
  }

  /** Get overall queue status. */
  getGlobalQueueStatus(): Record<string, { depth: number; estimated_wait_ms: number }> {
    const db = getDb();
    const status: Record<string, { depth: number; estimated_wait_ms: number }> = {};

    for (const [mode, queue] of this.queues) {
      const avgWait = queueQueries.avgWaitTime(db, mode);
      status[mode] = {
        depth: queue.length,
        estimated_wait_ms: avgWait || (queue.length > 1 ? 10_000 : 30_000),
      };
    }

    // Include modes with empty queues
    for (const mode of ["ranked_1v1", "casual_1v1", "tournament"] as GameMode[]) {
      if (!status[mode]) {
        const avgWait = queueQueries.avgWaitTime(db, mode);
        status[mode] = { depth: 0, estimated_wait_ms: avgWait || 60_000 };
      }
    }

    return status;
  }

  /** Handle a queue WebSocket connection (for real-time match notifications). */
  handleQueueConnection(ws: WebSocket): void {
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "identify" && msg.agent_id) {
          this.queueConnections.set(msg.agent_id, ws);
          ws.send(JSON.stringify({ type: "identified", agent_id: msg.agent_id }));
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on("close", () => {
      // Find and remove the agent from queue connections
      for (const [agentId, conn] of this.queueConnections) {
        if (conn === ws) {
          this.queueConnections.delete(agentId);
          // Also remove from matchmaking queue
          this.removeFromQueue(agentId);
          break;
        }
      }
    });
  }

  /**
   * Main tick — called every 5 seconds.
   * Scans queues, widens ELO ranges, pairs agents, handles timeouts.
   * Returns new match pairings to be started.
   */
  async tick(): Promise<MatchPairing[]> {
    const pairings: MatchPairing[] = [];
    const now = Date.now();

    for (const [mode, entries] of this.queues) {
      // Handle timeouts first
      const timedOut: QueueEntry[] = [];
      const active: QueueEntry[] = [];

      for (const entry of entries) {
        if (now - entry.joined_at > QUEUE_TIMEOUT_MS) {
          timedOut.push(entry);
        } else {
          active.push(entry);
        }
      }

      // Notify timed-out agents
      for (const entry of timedOut) {
        this.notifyAgent(entry.agent_id, "queue_timeout", {
          wait_time_ms: now - entry.joined_at,
          message: "Queue timeout — no match found. Try again later.",
        });
        this.recordQueueResult(entry, false, null, null);
      }

      if (active.length < 2) {
        this.queues.set(mode, active);
        continue;
      }

      // Widen ELO range over time
      for (const entry of active) {
        const waitSeconds = (now - entry.joined_at) / 1000;
        entry.elo_range = Math.min(
          MAX_ELO_RANGE,
          INITIAL_ELO_RANGE + Math.floor(waitSeconds / 30) * RANGE_WIDEN_PER_30S
        );
      }

      // Sort by wait time (longest first = highest priority)
      active.sort((a, b) => a.joined_at - b.joined_at);

      const matched = new Set<string>();

      for (let i = 0; i < active.length; i++) {
        if (matched.has(active[i].agent_id)) continue;

        for (let j = i + 1; j < active.length; j++) {
          if (matched.has(active[j].agent_id)) continue;

          const eloDiff = Math.abs(active[i].elo - active[j].elo);
          const maxRange = Math.max(active[i].elo_range, active[j].elo_range);

          if (eloDiff <= maxRange) {
            // ─── MATCH FOUND ──────────────────────────
            const factions = this.assignFactions(active[i], active[j]);
            const map = this.selectMap(mode);

            const pairing: MatchPairing = {
              mode: mode as GameMode,
              map,
              players: [
                {
                  agent_id: active[i].agent_id,
                  agent_name: active[i].agent_name,
                  faction: factions[0],
                  elo: active[i].elo,
                },
                {
                  agent_id: active[j].agent_id,
                  agent_name: active[j].agent_name,
                  faction: factions[1],
                  elo: active[j].elo,
                },
              ],
            };

            pairings.push(pairing);
            matched.add(active[i].agent_id);
            matched.add(active[j].agent_id);

            console.log(
              `⚔️  MATCH: ${active[i].agent_name} (${active[i].elo}) vs ` +
              `${active[j].agent_name} (${active[j].elo}) on ${map}`
            );

            // Record queue stats
            this.recordQueueResult(
              active[i], true, active[j].agent_id,
              Math.abs(active[i].elo - active[j].elo)
            );
            this.recordQueueResult(
              active[j], true, active[i].agent_id,
              Math.abs(active[i].elo - active[j].elo)
            );

            // Notify both agents
            this.notifyAgent(active[i].agent_id, "match_found", pairing);
            this.notifyAgent(active[j].agent_id, "match_found", pairing);

            break;
          }
        }
      }

      // Remove matched entries
      this.queues.set(mode, active.filter(e => !matched.has(e.agent_id)));
    }

    return pairings;
  }

  // ─── Faction Assignment ─────────────────────────────────

  private assignFactions(a: QueueEntry, b: QueueEntry): [Faction, Faction] {
    const prefA = a.faction_preference;
    const prefB = b.faction_preference;

    // Both have different specific preferences
    if (prefA !== "random" && prefB !== "random" && prefA !== prefB) {
      return [prefA, prefB];
    }

    // One has preference, other is random
    if (prefA !== "random" && prefB === "random") {
      return [prefA, prefA === "allies" ? "soviet" : "allies"];
    }
    if (prefB !== "random" && prefA === "random") {
      return [prefB === "allies" ? "soviet" : "allies", prefB];
    }

    // Both want the same or both random — check rotation history
    const factionA = this.getNextFaction(a.agent_id);
    const factionB = factionA === "allies" ? "soviet" : "allies";

    return [factionA, factionB];
  }

  /** Determine next faction based on rotation history. */
  private getNextFaction(agentId: string): Faction {
    const db = getDb();
    const agent = agentQueries.getById(db, agentId);
    if (!agent) return Math.random() > 0.5 ? "allies" : "soviet";

    try {
      const history: string[] = JSON.parse(agent.faction_history);
      const recent = history.slice(-FACTION_ROTATION_WINDOW);

      if (recent.length >= FACTION_ROTATION_WINDOW) {
        const allSame = recent.every(f => f === recent[0]);
        if (allSame) {
          // Force switch
          return recent[0] === "allies" ? "soviet" : "allies";
        }
      }

      // Prefer the less-played faction
      const alliesCount = recent.filter(f => f === "allies").length;
      const sovietCount = recent.filter(f => f === "soviet").length;
      if (alliesCount > sovietCount) return "soviet";
      if (sovietCount > alliesCount) return "allies";
    } catch {
      // Corrupted history, start fresh
    }

    return Math.random() > 0.5 ? "allies" : "soviet";
  }

  /** Update faction history for an agent after a match. */
  updateFactionHistory(agentId: string, faction: Faction): void {
    const db = getDb();
    const agent = agentQueries.getById(db, agentId);
    if (!agent) return;

    try {
      const history: string[] = JSON.parse(agent.faction_history);
      history.push(faction);
      // Keep last 10 entries
      const trimmed = history.slice(-10);
      agentQueries.updateFactionHistory(db, agentId, trimmed);
    } catch {
      agentQueries.updateFactionHistory(db, agentId, [faction]);
    }
  }

  // ─── Map Selection ──────────────────────────────────────

  private selectMap(mode: GameMode): string {
    const pool = mode.includes("1v1") ? MAP_POOL_1V1 : MAP_POOL_1V1;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ─── Notifications ──────────────────────────────────────

  private notifyAgent(agentId: string, event: string, data: unknown): void {
    const ws = this.queueConnections.get(agentId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event, data }));
    }
  }

  // ─── Queue Recording ───────────────────────────────────

  private recordQueueResult(
    entry: QueueEntry,
    matched: boolean,
    opponentId: string | null,
    eloDiff: number | null
  ): void {
    try {
      const db = getDb();
      queueQueries.insert(db, {
        agent_id: entry.agent_id,
        mode: entry.mode,
        elo_at_queue: entry.elo,
        wait_time_ms: Date.now() - entry.joined_at,
        matched: matched ? 1 : 0,
        opponent_id: opponentId,
        elo_diff: eloDiff,
        match_id: null, // Updated later when match is created
      });
    } catch (err) {
      console.error("Failed to record queue history:", err);
    }
  }
}

// ─── Errors ─────────────────────────────────────────────

export class MatchmakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatchmakerError";
  }
}
