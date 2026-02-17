/**
 * Agent WebSocket Proxy — Bidirectional relay between AI agents and OpenRA game servers.
 *
 * Architecture:
 *   Agent ──WebSocket──→ Proxy ──IPC──→ OpenRA Dedicated Server
 *
 * The proxy:
 *   1. Authenticates agents via API key on first message
 *   2. Routes orders through the APM Limiter
 *   3. Routes orders through the Order Validator
 *   4. Passes validated orders to the game server via IPC
 *   5. Receives full game state from the server
 *   6. Filters state through the Fog Enforcer
 *   7. Sends fog-filtered state to each agent
 *   8. Broadcasts full state to spectators
 *
 * The agent NEVER connects directly to the game — always through this proxy.
 */

import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage } from "http";
import { ApmLimiter, APM_PROFILES, type ApmProfile } from "./apm-limiter.js";
import { OrderValidator, type OrderViolation } from "./order-validator.js";
import {
  FogEnforcer,
  type FullGameState,
  type GameOrder,
  type FogFilteredState,
} from "./fog-enforcer.js";
import { validateApiKey } from "./auth.js";
import type { AgentRow } from "./db.js";
import { sanitizeChatMessage, stripControlChars } from "./input-sanitizer.js";

// ─── Types ──────────────────────────────────────────────

export interface ProxyConfig {
  /** Port for the WebSocket proxy server */
  port: number;
  /** APM profile name to use */
  apmProfile: string;
  /** How often to send state updates (ms) */
  stateUpdateInterval: number;
  /** Max spectators per match */
  maxSpectatorsPerMatch: number;
  /** Enable verbose logging */
  verbose: boolean;
}

const DEFAULT_CONFIG: ProxyConfig = {
  port: 8081,
  apmProfile: "competitive",
  stateUpdateInterval: 250, // 4 updates/second
  maxSpectatorsPerMatch: 100,
  verbose: false,
};

export interface ProxiedAgent {
  agentId: string;
  agentName: string;
  ws: WebSocket;
  matchId: string;
  faction: "allies" | "soviet";
  authenticated: boolean;
  connectedAt: number;
}

export interface ProxiedMatch {
  matchId: string;
  agents: Map<string, ProxiedAgent>;
  spectators: Set<WebSocket>;
  fogEnforcer: FogEnforcer;
  apmLimiter: ApmLimiter;
  orderValidator: OrderValidator;
  lastState: FullGameState | null;
  startedAt: number;
  apmProfile: ApmProfile;
}

interface AgentMessage {
  type: string;
  agent_id?: string;
  api_key?: string;
  orders?: GameOrder[];
  message?: string;
}

// ─── Agent WebSocket Proxy ──────────────────────────────

export class AgentWebSocketProxy {
  private config: ProxyConfig;
  private wss: WebSocketServer | null = null;
  private matches = new Map<string, ProxiedMatch>();

  /** Total connections served */
  private totalConnections = 0;

  /** Total orders processed */
  private totalOrders = 0;

  /** Total violations caught */
  private totalViolations = 0;

  constructor(config: Partial<ProxyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a match proxy entry. Called when a match is created by the matchmaker.
   */
  createMatch(
    matchId: string,
    apmProfileName?: string
  ): ProxiedMatch {
    const profileName = apmProfileName ?? this.config.apmProfile;
    const apmProfile = APM_PROFILES[profileName] ?? APM_PROFILES.competitive;

    const match: ProxiedMatch = {
      matchId,
      agents: new Map(),
      spectators: new Set(),
      fogEnforcer: new FogEnforcer(),
      apmLimiter: new ApmLimiter(apmProfile),
      orderValidator: new OrderValidator(),
      lastState: null,
      startedAt: Date.now(),
      apmProfile,
    };

    this.matches.set(matchId, match);
    this.log(`🎮 Match proxy created: ${matchId} (APM: ${apmProfile.name})`);
    return match;
  }

  /**
   * Handle a new agent WebSocket connection.
   */
  handleAgentConnection(matchId: string, ws: WebSocket): void {
    const match = this.matches.get(matchId);
    if (!match) {
      ws.close(4004, "Match not found");
      return;
    }

    this.totalConnections++;
    let authenticated = false;
    let agentData: AgentRow | null = null;

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as AgentMessage;

        // First message must authenticate
        if (!authenticated) {
          if (msg.type === "identify" && msg.api_key) {
            agentData = validateApiKey(msg.api_key);
            if (!agentData) {
              ws.close(4001, "Invalid API key");
              return;
            }

            authenticated = true;
            const proxy: ProxiedAgent = {
              agentId: agentData.id,
              agentName: agentData.name,
              ws,
              matchId,
              faction: "allies", // Will be set by match config
              authenticated: true,
              connectedAt: Date.now(),
            };

            match.agents.set(agentData.id, proxy);
            ws.send(
              JSON.stringify({
                type: "authenticated",
                agent_id: agentData.id,
                match_id: matchId,
              })
            );

            this.log(
              `🔌 Agent ${agentData.name} authenticated for ${matchId}`
            );
            return;
          }

          // Also support identify by agent_id (for pre-authenticated connections)
          if (msg.type === "identify" && msg.agent_id) {
            const proxy: ProxiedAgent = {
              agentId: msg.agent_id,
              agentName: msg.agent_id, // Will be enriched later
              ws,
              matchId,
              faction: "allies",
              authenticated: true,
              connectedAt: Date.now(),
            };

            match.agents.set(msg.agent_id, proxy);
            authenticated = true;

            ws.send(
              JSON.stringify({
                type: "identified",
                agent_id: msg.agent_id,
                match_id: matchId,
              })
            );
            return;
          }

          ws.send(
            JSON.stringify({
              type: "error",
              message: "First message must be identify with agent_id or api_key",
            })
          );
          return;
        }

        // Authenticated — handle messages
        const agentId = agentData?.id ?? msg.agent_id;
        if (!agentId) return;

        switch (msg.type) {
          case "orders":
            this.handleOrders(match, agentId, msg.orders ?? []);
            break;

          case "get_state":
            this.sendState(match, agentId);
            break;

          case "chat":
            this.broadcastChat(match, agentId, msg.message ?? "");
            break;

          case "surrender":
            this.handleSurrender(match, agentId);
            break;

          default:
            ws.send(
              JSON.stringify({
                type: "error",
                message: `Unknown message type: ${msg.type}`,
              })
            );
        }
      } catch (err) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Invalid JSON message",
          })
        );
      }
    });

    ws.on("close", () => {
      if (agentData) {
        match.agents.delete(agentData.id);
        this.log(`🔌 Agent ${agentData.name} disconnected from ${matchId}`);
      }
    });

    ws.on("error", (err) => {
      this.log(`⚠️ WebSocket error for ${matchId}: ${err.message}`);
    });
  }

  /**
   * Handle a spectator WebSocket connection.
   */
  handleSpectatorConnection(matchId: string, ws: WebSocket): void {
    const match = this.matches.get(matchId);
    if (!match) {
      ws.close(4004, "Match not found");
      return;
    }

    if (match.spectators.size >= this.config.maxSpectatorsPerMatch) {
      ws.close(4029, "Match spectator limit reached");
      return;
    }

    match.spectators.add(ws);

    // Send current state if available
    if (match.lastState) {
      ws.send(
        JSON.stringify({
          type: "state_update",
          state: match.lastState,
        })
      );
    }

    ws.on("close", () => {
      match.spectators.delete(ws);
    });

    this.log(
      `👀 Spectator joined ${matchId} (${match.spectators.size} watching)`
    );
  }

  /**
   * Push a game state update from the OpenRA server.
   * Filters and distributes to agents and spectators.
   */
  pushGameState(matchId: string, fullState: FullGameState): void {
    const match = this.matches.get(matchId);
    if (!match) return;

    match.lastState = fullState;

    // Send fog-filtered state to each agent
    for (const [agentId, proxy] of match.agents) {
      if (proxy.ws.readyState !== WebSocket.OPEN) continue;

      try {
        const filtered = match.fogEnforcer.filterForAgent(fullState, agentId);
        proxy.ws.send(
          JSON.stringify({
            type: "state_update",
            state: filtered,
          })
        );
      } catch {
        // Agent not in game state — skip
      }
    }

    // Send FULL state to spectators (they see everything)
    const spectatorMsg = JSON.stringify({
      type: "state_update",
      state: fullState,
      tick: fullState.tick,
    });

    for (const ws of match.spectators) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(spectatorMsg);
      }
    }
  }

  /**
   * Clean up a match when it ends.
   */
  destroyMatch(matchId: string): void {
    const match = this.matches.get(matchId);
    if (!match) return;

    // Close all agent connections
    for (const [, proxy] of match.agents) {
      if (proxy.ws.readyState === WebSocket.OPEN) {
        proxy.ws.close(1000, "Match ended");
      }
    }

    // Close all spectator connections
    for (const ws of match.spectators) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "Match ended");
      }
    }

    // Clean up fog enforcer state
    for (const [agentId] of match.agents) {
      match.fogEnforcer.cleanupMatch(agentId);
    }

    match.apmLimiter.resetAll();
    match.orderValidator.reset();
    this.matches.delete(matchId);

    this.log(`🗑️ Match proxy destroyed: ${matchId}`);
  }

  /**
   * Get proxy statistics.
   */
  getStats(): {
    active_matches: number;
    total_connections: number;
    total_orders: number;
    total_violations: number;
    matches: Array<{
      match_id: string;
      agents: number;
      spectators: number;
      uptime_secs: number;
    }>;
  } {
    const matchStats = Array.from(this.matches.values()).map((m) => ({
      match_id: m.matchId,
      agents: m.agents.size,
      spectators: m.spectators.size,
      uptime_secs: Math.floor((Date.now() - m.startedAt) / 1000),
    }));

    return {
      active_matches: this.matches.size,
      total_connections: this.totalConnections,
      total_orders: this.totalOrders,
      total_violations: this.totalViolations,
      matches: matchStats,
    };
  }

  // ─── Private Order Handling ────────────────────────────

  private handleOrders(
    match: ProxiedMatch,
    agentId: string,
    orders: GameOrder[]
  ): void {
    if (orders.length === 0) return;

    const proxy = match.agents.get(agentId);
    if (!proxy || proxy.ws.readyState !== WebSocket.OPEN) return;

    // Step 1: APM Limiter check
    const apmResult = match.apmLimiter.processOrders(
      agentId,
      orders,
      match.apmProfile
    );

    if (apmResult.violations.length > 0) {
      this.totalViolations += apmResult.violations.length;
      proxy.ws.send(
        JSON.stringify({
          type: "order_violations",
          source: "apm_limiter",
          violations: apmResult.violations,
        })
      );
    }

    if (apmResult.allowed.length === 0) return;

    // Step 2: Order Validator (if we have game state)
    if (match.lastState) {
      try {
        const filteredState = match.fogEnforcer.filterForAgent(
          match.lastState,
          agentId
        );

        const validationResult = match.orderValidator.validate(
          agentId,
          apmResult.allowed,
          filteredState
        );

        if (validationResult.violations.length > 0) {
          this.totalViolations += validationResult.violations.length;
          proxy.ws.send(
            JSON.stringify({
              type: "order_violations",
              source: "order_validator",
              violations: validationResult.violations.map(
                (v: OrderViolation) => v.reason
              ),
            })
          );
        }

        this.totalOrders += validationResult.valid.length;

        // TODO: Forward valid orders to OpenRA server via IPC
        // gameServerIpc.sendOrders(match.matchId, validationResult.valid);

        this.logVerbose(
          `📋 ${agentId}: ${validationResult.valid.length} orders accepted, ` +
            `${validationResult.rejected.length} rejected`
        );
      } catch {
        // Agent not found in game state — accept orders anyway
        // (may happen during connection phase)
        this.totalOrders += apmResult.allowed.length;
      }
    } else {
      this.totalOrders += apmResult.allowed.length;
    }
  }

  private sendState(match: ProxiedMatch, agentId: string): void {
    const proxy = match.agents.get(agentId);
    if (!proxy || !match.lastState) return;

    try {
      const filtered = match.fogEnforcer.filterForAgent(
        match.lastState,
        agentId
      );
      proxy.ws.send(
        JSON.stringify({
          type: "state_response",
          state: filtered,
        })
      );
    } catch {
      proxy.ws.send(
        JSON.stringify({
          type: "error",
          message: "Game state not available yet",
        })
      );
    }
  }

  private broadcastChat(
    match: ProxiedMatch,
    agentId: string,
    message: string
  ): void {
    const proxy = match.agents.get(agentId);
    // Sanitize chat message — strip control chars, prompt injection, limit length
    const sanitizedMessage = sanitizeChatMessage(message);
    if (!sanitizedMessage) return; // Don't broadcast empty messages
    const chatMsg = JSON.stringify({
      type: "chat",
      from: stripControlChars(proxy?.agentName ?? agentId),
      message: sanitizedMessage,
    });

    for (const [, p] of match.agents) {
      if (p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(chatMsg);
      }
    }
    for (const ws of match.spectators) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chatMsg);
      }
    }
  }

  private handleSurrender(match: ProxiedMatch, agentId: string): void {
    // Emit event for the game server manager to handle
    this.log(`🏳️ Agent ${agentId} surrendered in ${match.matchId}`);
    // The GameServerManager will call endMatch() which will call destroyMatch()
  }

  // ─── Logging ───────────────────────────────────────────

  private log(msg: string): void {
    console.log(`[WSProxy] ${msg}`);
  }

  private logVerbose(msg: string): void {
    if (this.config.verbose) {
      console.log(`[WSProxy] ${msg}`);
    }
  }
}
