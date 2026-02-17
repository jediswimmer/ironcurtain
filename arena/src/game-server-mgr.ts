/**
 * Game Server Manager — lifecycle management for OpenRA dedicated server instances.
 *
 * Responsible for:
 *   - Spinning up headless OpenRA instances for each match
 *   - Proxying agent WebSocket connections through the fog enforcer
 *   - Managing spectator connections (full game state, no fog)
 *   - Tearing down servers when matches end or error out
 *
 * TODO(#1): Implement container-based game server pool for production.
 */

import { WebSocket } from "ws";
import type { MatchPairing } from "./matchmaker.js";

export interface ActiveMatch {
  readonly id: string;
  readonly pairing: MatchPairing;
  readonly startedAt: number;
  readonly agentConnections: Map<string, WebSocket>;
  readonly spectatorConnections: Set<WebSocket>;
  status: "starting" | "running" | "completed" | "error";
}

export class GameServerManager {
  private activeMatches = new Map<string, ActiveMatch>();

  /**
   * Create a new match from a matchmaker pairing.
   * Spins up a game server and waits for agents to connect.
   */
  async createMatch(pairing: MatchPairing): Promise<string> {
    const matchId = crypto.randomUUID();

    const match: ActiveMatch = {
      id: matchId,
      pairing,
      startedAt: Date.now(),
      agentConnections: new Map(),
      spectatorConnections: new Set(),
      status: "starting",
    };

    this.activeMatches.set(matchId, match);
    console.error(`🎮 Match ${matchId} created: ${pairing.players.map(p => p.agent_name).join(" vs ")}`);

    return matchId;
  }

  /**
   * Handle an agent WebSocket connection to a match.
   */
  handleAgentConnection(matchId: string, ws: WebSocket): void {
    const match = this.activeMatches.get(matchId);
    if (!match) {
      ws.close(4004, "Match not found");
      return;
    }

    ws.on("message", (data) => {
      // Forward agent messages to game server (through fog enforcer)
      // TODO(#2): Implement fog-enforced message proxying
      console.error(`[Match ${matchId}] Agent message: ${data.toString().slice(0, 100)}`);
    });

    ws.on("close", () => {
      console.error(`[Match ${matchId}] Agent disconnected`);
    });
  }

  /**
   * Handle a spectator WebSocket connection to a match.
   */
  handleSpectatorConnection(matchId: string, ws: WebSocket): void {
    const match = this.activeMatches.get(matchId);
    if (!match) {
      ws.close(4004, "Match not found");
      return;
    }

    match.spectatorConnections.add(ws);

    ws.on("close", () => {
      match.spectatorConnections.delete(ws);
    });
  }

  /**
   * Get all currently active matches.
   */
  getActiveMatches(): ActiveMatch[] {
    return Array.from(this.activeMatches.values()).filter(
      (m) => m.status === "running" || m.status === "starting"
    );
  }
}
