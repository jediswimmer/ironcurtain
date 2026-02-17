/**
 * Game Server Manager — OpenRA dedicated server lifecycle.
 *
 * Manages the creation, monitoring, and teardown of OpenRA dedicated
 * server instances for each match. Each match gets its own server process.
 *
 * In production, these would be containers (ACI/Docker).
 * For dev/MVP, they're local child processes.
 *
 * Responsibilities:
 *   - Spawn OpenRA dedicated server for each match
 *   - Configure map, players, settings
 *   - Proxy agent connections through fog enforcer
 *   - Monitor game progress
 *   - Collect results when game ends
 *   - Save replay files
 *   - Clean up after match
 */

import { EventEmitter } from "events";
import { nanoid } from "nanoid";
import { WebSocket } from "ws";
import { FogEnforcer, type FogFilteredState, type FullGameState } from "./fog-enforcer.js";
import { Leaderboard, type EloChange } from "./leaderboard.js";
import { Matchmaker, type MatchPairing } from "./matchmaker.js";
import { getDb, matchQueries, eventQueries, type MatchRow } from "./db.js";

// ─── Types ──────────────────────────────────────────────

export interface GameServerConfig {
  matchId: string;
  mode: string;
  map: string;
  players: GameServerPlayer[];
  settings: GameSettings;
}

export interface GameServerPlayer {
  agent_id: string;
  agent_name: string;
  faction: "allies" | "soviet";
  elo: number;
}

export interface GameSettings {
  fog_of_war: boolean;
  shroud: boolean;
  starting_cash: number;
  tech_level: "low" | "medium" | "high" | "unrestricted";
  game_speed: "slower" | "slow" | "normal" | "fast" | "faster";
  apm_profile: string;
}

const DEFAULT_SETTINGS: GameSettings = {
  fog_of_war: true,
  shroud: true,
  starting_cash: 10000,
  tech_level: "unrestricted",
  game_speed: "normal",
  apm_profile: "competitive",
};

export type MatchStatus = "pending" | "connecting" | "running" | "completed" | "cancelled" | "error";

interface ActiveMatch {
  id: string;
  config: GameServerConfig;
  status: MatchStatus;
  startedAt: number;
  agentConnections: Map<string, WebSocket>;
  spectatorConnections: Set<WebSocket>;
  gameState: FullGameState | null;
  fogEnforcer: FogEnforcer;
  connectTimeout?: ReturnType<typeof setTimeout>;
  // In production: reference to the OpenRA process/container
  serverPort?: number;
}

export interface MatchResult {
  match_id: string;
  winner_id: string | null;
  loser_id: string | null;
  is_draw: boolean;
  duration_secs: number;
  elo_change: EloChange | null;
  replay_path: string | null;
}

// ─── Game Server Manager ────────────────────────────────

export class GameServerManager extends EventEmitter {
  private activeMatches = new Map<string, ActiveMatch>();
  private leaderboard: Leaderboard;
  private matchmaker: Matchmaker;

  // Port allocation for local dev
  private nextPort = 10000;

  constructor(leaderboard: Leaderboard, matchmaker: Matchmaker) {
    super();
    this.leaderboard = leaderboard;
    this.matchmaker = matchmaker;
  }

  /**
   * Create a new match from a matchmaker pairing.
   * Sets up the game server and waits for agents to connect.
   */
  async createMatch(pairing: MatchPairing): Promise<string> {
    const matchId = nanoid(12);
    const db = getDb();

    const config: GameServerConfig = {
      matchId,
      mode: pairing.mode,
      map: pairing.map,
      players: pairing.players.map(p => ({
        agent_id: p.agent_id,
        agent_name: p.agent_name,
        faction: p.faction,
        elo: p.elo,
      })),
      settings: this.getSettingsForMode(pairing.mode),
    };

    // Record match in DB
    matchQueries.insert(db, {
      id: matchId,
      mode: pairing.mode,
      agent1_id: pairing.players[0].agent_id,
      agent2_id: pairing.players[1].agent_id,
      agent1_faction: pairing.players[0].faction,
      agent2_faction: pairing.players[1].faction,
      map: pairing.map,
    });

    // Create active match tracking
    const match: ActiveMatch = {
      id: matchId,
      config,
      status: "pending",
      startedAt: Date.now(),
      agentConnections: new Map(),
      spectatorConnections: new Set(),
      gameState: null,
      fogEnforcer: new FogEnforcer(),
    };

    this.activeMatches.set(matchId, match);

    // Start the OpenRA dedicated server
    await this.spawnGameServer(match);

    // Set connect timeout — agents have 60s to connect
    match.connectTimeout = setTimeout(() => {
      if (match.agentConnections.size < 2) {
        console.warn(`⏰ Match ${matchId}: Connection timeout. ${match.agentConnections.size}/2 agents connected.`);
        this.cancelMatch(matchId, "Agent connection timeout");
      }
    }, 60_000);

    console.log(`🎮 Match ${matchId} created: ${config.players[0].agent_name} vs ${config.players[1].agent_name} on ${config.map}`);

    // Record match events
    eventQueries.insert(db, {
      match_id: matchId,
      tick: 0,
      event_type: "match_created",
      agent_id: null,
      data: JSON.stringify({ map: config.map, players: config.players }),
    });

    return matchId;
  }

  /**
   * Handle an agent connecting to their match via WebSocket.
   */
  handleAgentConnection(matchId: string, ws: WebSocket): void {
    const match = this.activeMatches.get(matchId);
    if (!match) {
      ws.close(4004, "Match not found");
      return;
    }

    // Agent identifies itself
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "identify") {
          const agentId = msg.agent_id;
          const apiKey = msg.api_key;

          // Verify this agent is part of this match
          const isPlayer = match.config.players.some(p => p.agent_id === agentId);
          if (!isPlayer) {
            ws.close(4003, "Not a participant in this match");
            return;
          }

          match.agentConnections.set(agentId, ws);
          ws.send(JSON.stringify({
            type: "connected",
            match_id: matchId,
            map: match.config.map,
            faction: match.config.players.find(p => p.agent_id === agentId)?.faction,
            opponent: match.config.players.find(p => p.agent_id !== agentId)?.agent_name,
            settings: match.config.settings,
          }));

          console.log(`🔌 Agent ${agentId} connected to match ${matchId} (${match.agentConnections.size}/2)`);

          // Both agents connected — start the game
          if (match.agentConnections.size === 2) {
            if (match.connectTimeout) clearTimeout(match.connectTimeout);
            this.startGame(matchId);
          }
        } else if (msg.type === "orders") {
          this.handleAgentOrders(matchId, msg.agent_id, msg.orders);
        } else if (msg.type === "get_state") {
          this.sendFilteredState(matchId, msg.agent_id);
        } else if (msg.type === "chat") {
          this.broadcastChat(matchId, msg.agent_id, msg.message);
        } else if (msg.type === "surrender") {
          this.handleSurrender(matchId, msg.agent_id);
        }
      } catch (err) {
        console.error(`Error processing agent message for match ${matchId}:`, err);
      }
    });

    ws.on("close", () => {
      // Agent disconnected — find which one
      for (const [agentId, conn] of match.agentConnections) {
        if (conn === ws) {
          match.agentConnections.delete(agentId);
          console.log(`🔌 Agent ${agentId} disconnected from match ${matchId}`);

          // If game is running, the disconnecting agent forfeits
          if (match.status === "running") {
            const opponent = match.config.players.find(p => p.agent_id !== agentId);
            if (opponent) {
              this.endMatch(matchId, opponent.agent_id, "opponent_disconnect");
            }
          }
          break;
        }
      }
    });
  }

  /**
   * Handle a spectator connecting to a match.
   */
  handleSpectatorConnection(matchId: string, ws: WebSocket): void {
    const match = this.activeMatches.get(matchId);
    if (!match) {
      ws.close(4004, "Match not found");
      return;
    }

    match.spectatorConnections.add(ws);

    // Send current state (full, unfiltered — spectators see everything)
    if (match.gameState) {
      ws.send(JSON.stringify({
        type: "state_update",
        state: match.gameState,
        players: match.config.players,
      }));
    }

    ws.on("close", () => {
      match.spectatorConnections.delete(ws);
    });

    console.log(`👀 Spectator joined match ${matchId} (${match.spectatorConnections.size} watching)`);
  }

  /**
   * Get info about a live match.
   */
  getLiveMatch(matchId: string): {
    id: string;
    status: MatchStatus;
    players: GameServerPlayer[];
    map: string;
    mode: string;
    duration_secs: number;
    spectators: number;
  } | null {
    const match = this.activeMatches.get(matchId);
    if (!match) return null;

    return {
      id: match.id,
      status: match.status,
      players: match.config.players,
      map: match.config.map,
      mode: match.config.mode,
      duration_secs: Math.floor((Date.now() - match.startedAt) / 1000),
      spectators: match.spectatorConnections.size,
    };
  }

  /**
   * Get all live matches.
   */
  getLiveMatches(): Array<{
    id: string;
    status: MatchStatus;
    players: GameServerPlayer[];
    map: string;
    mode: string;
    duration_secs: number;
    spectators: number;
  }> {
    const results = [];
    for (const [id] of this.activeMatches) {
      const info = this.getLiveMatch(id);
      if (info && (info.status === "running" || info.status === "connecting")) {
        results.push(info);
      }
    }
    return results;
  }

  // ─── Game Lifecycle ─────────────────────────────────────

  /**
   * Spawn the OpenRA dedicated server for a match.
   * In production, this creates a container (ACI/Docker).
   * For dev, it would spawn a local process.
   */
  private async spawnGameServer(match: ActiveMatch): Promise<void> {
    const port = this.nextPort++;
    match.serverPort = port;
    match.status = "connecting";

    const db = getDb();
    matchQueries.setRunning(db, match.id, port);

    // TODO: In production, this spawns an actual OpenRA dedicated server:
    //
    // const container = await docker.createContainer({
    //   Image: "ironcurtain/openra-server:latest",
    //   Env: [
    //     `MAP=${match.config.map}`,
    //     `PLAYER1_FACTION=${match.config.players[0].faction}`,
    //     `PLAYER2_FACTION=${match.config.players[1].faction}`,
    //     `GAME_SPEED=${match.config.settings.game_speed}`,
    //     `STARTING_CASH=${match.config.settings.starting_cash}`,
    //     `IPC_PORT=${port}`,
    //   ],
    //   ExposedPorts: { [`${port}/tcp`]: {} },
    //   HostConfig: {
    //     PortBindings: { [`${port}/tcp`]: [{ HostPort: `${port}` }] },
    //   },
    // });
    // await container.start();
    //
    // For now, we simulate the game server internally.

    console.log(`🖥️  Game server allocated on port ${port} for match ${match.id}`);
  }

  /**
   * Start the game once both agents are connected.
   */
  private startGame(matchId: string): void {
    const match = this.activeMatches.get(matchId);
    if (!match) return;

    match.status = "running";
    match.startedAt = Date.now();

    const db = getDb();
    eventQueries.insert(db, {
      match_id: matchId,
      tick: 0,
      event_type: "game_started",
      agent_id: null,
      data: JSON.stringify({ timestamp: new Date().toISOString() }),
    });

    // Notify all agents
    for (const [agentId, ws] of match.agentConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "game_start",
          match_id: matchId,
          map: match.config.map,
          settings: match.config.settings,
        }));
      }
    }

    // Notify spectators
    for (const ws of match.spectatorConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "game_start",
          match_id: matchId,
          players: match.config.players,
          map: match.config.map,
        }));
      }
    }

    console.log(`🚀 Match ${matchId} STARTED!`);

    // Update faction histories
    for (const player of match.config.players) {
      this.matchmaker.updateFactionHistory(player.agent_id, player.faction);
    }

    this.emit("match_started", { matchId, players: match.config.players });
  }

  /**
   * Process game state update from the OpenRA server.
   * Filters state per-agent and broadcasts to spectators.
   */
  updateGameState(matchId: string, fullState: FullGameState): void {
    const match = this.activeMatches.get(matchId);
    if (!match || match.status !== "running") return;

    match.gameState = fullState;

    // Send fog-filtered state to each agent
    for (const [agentId, ws] of match.agentConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          const filtered = match.fogEnforcer.filterForAgent(fullState, agentId);
          ws.send(JSON.stringify({ type: "state_update", state: filtered }));
        } catch (err) {
          console.error(`Failed to send state to agent ${agentId}:`, err);
        }
      }
    }

    // Send full state to spectators
    for (const ws of match.spectatorConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "state_update",
          state: fullState,
          tick: fullState.tick,
        }));
      }
    }
  }

  /**
   * Handle orders from an agent.
   */
  private handleAgentOrders(matchId: string, agentId: string, orders: unknown[]): void {
    const match = this.activeMatches.get(matchId);
    if (!match || match.status !== "running") return;

    // Validate orders through fog enforcer
    if (match.gameState) {
      const ownState = match.fogEnforcer.filterForAgent(match.gameState, agentId);
      const result = match.fogEnforcer.validateOrders(
        agentId, matchId, orders as any, ownState
      );

      if (result.violations.length > 0) {
        const ws = match.agentConnections.get(agentId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "order_violations",
            violations: result.violations,
          }));
        }
      }

      // TODO: Forward valid orders to OpenRA server via IPC
      // gameServer.sendOrders(result.valid);
    }
  }

  /**
   * Send filtered state to a specific agent on request.
   */
  private sendFilteredState(matchId: string, agentId: string): void {
    const match = this.activeMatches.get(matchId);
    if (!match || !match.gameState) return;

    const ws = match.agentConnections.get(agentId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    try {
      const filtered = match.fogEnforcer.filterForAgent(match.gameState, agentId);
      ws.send(JSON.stringify({ type: "state_response", state: filtered }));
    } catch (err) {
      console.error(`Failed to send state to agent ${agentId}:`, err);
    }
  }

  /**
   * Broadcast chat message to all participants.
   */
  private broadcastChat(matchId: string, agentId: string, message: string): void {
    const match = this.activeMatches.get(matchId);
    if (!match) return;

    const player = match.config.players.find(p => p.agent_id === agentId);
    const chatMsg = JSON.stringify({
      type: "chat",
      from: player?.agent_name ?? "Unknown",
      message: message.slice(0, 200), // Limit length
    });

    // Send to all agents
    for (const [, ws] of match.agentConnections) {
      if (ws.readyState === WebSocket.OPEN) ws.send(chatMsg);
    }
    // Send to spectators
    for (const ws of match.spectatorConnections) {
      if (ws.readyState === WebSocket.OPEN) ws.send(chatMsg);
    }
  }

  /**
   * Handle agent surrender.
   */
  private handleSurrender(matchId: string, surrenderingAgentId: string): void {
    const match = this.activeMatches.get(matchId);
    if (!match || match.status !== "running") return;

    const winner = match.config.players.find(p => p.agent_id !== surrenderingAgentId);
    if (winner) {
      this.endMatch(matchId, winner.agent_id, "surrender");
    }
  }

  /**
   * End a match with a result.
   */
  endMatch(
    matchId: string,
    winnerId: string | null,
    reason: "victory" | "surrender" | "opponent_disconnect" | "draw" | "timeout" | "error"
  ): MatchResult | null {
    const match = this.activeMatches.get(matchId);
    if (!match) return null;

    match.status = "completed";
    const durationSecs = Math.floor((Date.now() - match.startedAt) / 1000);
    const isDraw = reason === "draw" || winnerId === null;

    const loserId = winnerId
      ? match.config.players.find(p => p.agent_id !== winnerId)?.agent_id ?? null
      : null;

    // Calculate ELO changes
    let eloChange: EloChange | null = null;
    if (winnerId && loserId) {
      const winnerPlayer = match.config.players.find(p => p.agent_id === winnerId)!;
      const loserPlayer = match.config.players.find(p => p.agent_id === loserId)!;

      eloChange = this.leaderboard.recordResult(
        winnerId, loserId,
        winnerPlayer.faction, loserPlayer.faction,
        match.config.mode, isDraw
      );
    }

    // Update DB
    const db = getDb();
    matchQueries.setCompleted(
      db, matchId, winnerId, isDraw, durationSecs,
      eloChange?.winner_elo_change ?? 0,
      eloChange?.loser_elo_change ?? 0,
      undefined // replay path
    );

    // Record event
    eventQueries.insert(db, {
      match_id: matchId,
      tick: match.gameState?.tick ?? 0,
      event_type: "game_ended",
      agent_id: winnerId,
      data: JSON.stringify({ reason, winner_id: winnerId, loser_id: loserId, elo_change: eloChange }),
    });

    // Notify agents
    const resultMsg = JSON.stringify({
      type: "game_end",
      result: isDraw ? "draw" : (winnerId ? "victory" : "cancelled"),
      winner_id: winnerId,
      reason,
      duration_secs: durationSecs,
      elo_change: eloChange,
    });

    for (const [agentId, ws] of match.agentConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        const isWinner = agentId === winnerId;
        ws.send(JSON.stringify({
          type: "game_end",
          result: isDraw ? "draw" : (isWinner ? "victory" : "defeat"),
          winner_id: winnerId,
          reason,
          duration_secs: durationSecs,
          elo_change: eloChange,
        }));
        ws.close(1000, "Match ended");
      }
    }

    // Notify spectators
    for (const ws of match.spectatorConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(resultMsg);
        ws.close(1000, "Match ended");
      }
    }

    // Clean up
    for (const player of match.config.players) {
      match.fogEnforcer.cleanupMatch(player.agent_id);
    }

    // Keep match in active list for a bit (for result queries), then remove
    setTimeout(() => this.activeMatches.delete(matchId), 30_000);

    const winner = match.config.players.find(p => p.agent_id === winnerId);
    const loser = match.config.players.find(p => p.agent_id === loserId);

    console.log(
      `🏁 Match ${matchId} ended: ${winner?.agent_name ?? "DRAW"} ${isDraw ? "DRAW" : "WINS"} ` +
      `(${reason}) — ${durationSecs}s` +
      (eloChange ? ` [${eloChange.winner_elo_change > 0 ? "+" : ""}${eloChange.winner_elo_change}/${eloChange.loser_elo_change}]` : "")
    );

    const result: MatchResult = {
      match_id: matchId,
      winner_id: winnerId,
      loser_id: loserId,
      is_draw: isDraw,
      duration_secs: durationSecs,
      elo_change: eloChange,
      replay_path: null,
    };

    this.emit("match_ended", result);
    return result;
  }

  /**
   * Cancel a match before it starts or completes.
   */
  cancelMatch(matchId: string, reason: string): void {
    const match = this.activeMatches.get(matchId);
    if (!match) return;

    match.status = "cancelled";
    const db = getDb();
    matchQueries.setCancelled(db, matchId);

    // Notify agents
    for (const [, ws] of match.agentConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "match_cancelled", reason }));
        ws.close(1000, reason);
      }
    }

    // Notify spectators
    for (const ws of match.spectatorConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "match_cancelled", reason }));
        ws.close(1000, reason);
      }
    }

    // Clean up
    if (match.connectTimeout) clearTimeout(match.connectTimeout);
    this.activeMatches.delete(matchId);

    console.log(`❌ Match ${matchId} cancelled: ${reason}`);
  }

  // ─── Settings ───────────────────────────────────────────

  private getSettingsForMode(mode: string): GameSettings {
    switch (mode) {
      case "ranked_1v1":
        return { ...DEFAULT_SETTINGS, apm_profile: "competitive" };
      case "casual_1v1":
        return { ...DEFAULT_SETTINGS, apm_profile: "unlimited" };
      case "tournament":
        return { ...DEFAULT_SETTINGS, game_speed: "normal", apm_profile: "competitive" };
      default:
        return { ...DEFAULT_SETTINGS };
    }
  }
}
