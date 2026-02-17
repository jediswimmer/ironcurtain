/**
 * IronCurtain JavaScript/TypeScript WebSocket Adapter
 *
 * A complete client for connecting AI agents to the IronCurtain
 * competitive platform. Handles registration, matchmaking, and game
 * communication via the Standardized Agent Protocol (SAP) v1.0.
 *
 * Works in Node.js (with `ws` package) and browsers (native WebSocket).
 *
 * Usage:
 *   import { IronCurtainAgent, Orders, GameState } from './ironcurtain-client';
 *
 *   const bot = new IronCurtainAgent({
 *     name: 'MyBot',
 *     arenaUrl: 'http://localhost:8080',
 *     onGameState: (state) => {
 *       const orders = [];
 *       if (state.credits > 1000) {
 *         orders.push(Orders.train('3tnk', 2));
 *       }
 *       return orders;
 *     },
 *   });
 *
 *   bot.run();
 *
 * Dependencies (Node.js only):
 *   npm install ws
 */

// ─── Types ──────────────────────────────────────────────

export type GameMode = "ranked_1v1" | "casual_1v1" | "tournament";
export type FactionPreference = "allies" | "soviet" | "random";

export interface AgentConfig {
  /** Bot name (2-32 characters) */
  name: string;
  /** Arena server URL */
  arenaUrl: string;
  /** Game mode */
  mode?: GameMode;
  /** Faction preference */
  faction?: FactionPreference;
  /** Existing API key (skip registration) */
  apiKey?: string;
  /** Existing agent ID */
  agentId?: string;
  /** Auto re-queue after match ends */
  autoQueue?: boolean;
  /** Game state handler — THE CORE OF YOUR BOT */
  onGameState: (state: GameState) => GameOrder[];
  /** Optional: match start handler */
  onMatchStart?: (info: MatchInfo) => void;
  /** Optional: match end handler */
  onMatchEnd?: (result: MatchResult) => void;
  /** Optional: order violation handler */
  onViolation?: (violations: string[]) => void;
  /** Optional: chat handler */
  onChat?: (from: string, message: string) => void;
  /** Logging level */
  logLevel?: "debug" | "info" | "warn" | "error";
}

export interface AgentCredentials {
  agentId: string;
  name: string;
  apiKey: string;
  elo: number;
}

export interface MatchInfo {
  matchId: string;
  mapName: string;
  faction: string;
  opponent: string;
  settings: Record<string, unknown>;
}

export interface MatchResult {
  result: "victory" | "defeat" | "draw";
  winnerId: string | null;
  reason: string;
  durationSecs: number;
  eloChange?: {
    winnerEloBefore: number;
    winnerEloAfter: number;
    winnerEloChange: number;
    loserEloBefore: number;
    loserEloAfter: number;
    loserEloChange: number;
  };
}

export interface GameState {
  tick: number;
  gameTime: string;
  credits: number;
  powerGenerated: number;
  powerConsumed: number;
  isLowPower: boolean;
  ownUnits: UnitInfo[];
  ownBuildings: BuildingInfo[];
  enemyVisibleUnits: EnemyUnit[];
  enemyVisibleBuildings: EnemyBuilding[];
  frozenActors: FrozenActor[];
  exploredPercentage: number;
  mapName: string;
  mapSize: [number, number];
  knownOreFields: OreField[];
  /** Convenience: units with is_idle === true */
  idleUnits: UnitInfo[];
  unitCount: number;
  buildingCount: number;
}

export interface UnitInfo {
  id: number;
  type: string;
  position: [number, number];
  health: number;
  maxHealth: number;
  isIdle: boolean;
}

export interface BuildingInfo {
  id: number;
  type: string;
  position: [number, number];
  health: number;
  maxHealth: number;
  productionQueue?: { type: string; progress: number }[];
  rallyPoint?: [number, number];
  isPrimary?: boolean;
}

export interface EnemyUnit {
  id: number;
  type: string;
  position: [number, number];
  healthPercent: number;
}

export interface EnemyBuilding {
  id: number;
  type: string;
  position: [number, number];
  healthPercent: number;
}

export interface FrozenActor {
  id: number;
  type: string;
  position: [number, number];
  lastSeenTick: number;
}

export interface OreField {
  center: [number, number];
  type: "ore" | "gems";
}

export interface GameOrder {
  type: string;
  unit_ids?: number[];
  building_id?: number;
  target?: [number, number];
  target_id?: number;
  build_type?: string;
  count?: number;
  queued?: boolean;
}

// ─── Order Helpers ──────────────────────────────────────

export const Orders = {
  move(unitIds: number[], target: [number, number], queued = false): GameOrder {
    return { type: "move", unit_ids: unitIds, target, queued };
  },

  attack(unitIds: number[], targetId: number): GameOrder {
    return { type: "attack", unit_ids: unitIds, target_id: targetId };
  },

  attackMove(unitIds: number[], target: [number, number]): GameOrder {
    return { type: "attack_move", unit_ids: unitIds, target };
  },

  deploy(unitIds: number[]): GameOrder {
    return { type: "deploy", unit_ids: unitIds };
  },

  build(buildType: string, position: [number, number]): GameOrder {
    return { type: "build", build_type: buildType, target: position };
  },

  train(unitType: string, count = 1): GameOrder {
    return { type: "train", build_type: unitType, count };
  },

  sell(buildingId: number): GameOrder {
    return { type: "sell", building_id: buildingId };
  },

  repair(buildingId: number): GameOrder {
    return { type: "repair", building_id: buildingId };
  },

  setRally(buildingId: number, target: [number, number]): GameOrder {
    return { type: "set_rally", building_id: buildingId, target };
  },

  stop(unitIds: number[]): GameOrder {
    return { type: "stop", unit_ids: unitIds };
  },

  scatter(unitIds: number[]): GameOrder {
    return { type: "scatter", unit_ids: unitIds };
  },

  guard(unitIds: number[], targetId: number): GameOrder {
    return { type: "guard", unit_ids: unitIds, target_id: targetId };
  },

  patrol(unitIds: number[], target: [number, number]): GameOrder {
    return { type: "patrol", unit_ids: unitIds, target };
  },
} as const;

// ─── State Parser ───────────────────────────────────────

function parseGameState(raw: Record<string, unknown>): GameState {
  const own = (raw.own ?? {}) as Record<string, unknown>;
  const enemy = (raw.enemy ?? {}) as Record<string, unknown>;
  const mapInfo = (raw.map ?? {}) as Record<string, unknown>;
  const power = (own.power ?? {}) as Record<string, number>;

  const ownUnits = ((own.units ?? []) as Record<string, unknown>[]).map(
    (u) => ({
      id: u.id as number,
      type: u.type as string,
      position: u.position as [number, number],
      health: u.health as number,
      maxHealth: u.max_health as number,
      isIdle: u.is_idle as boolean,
    })
  );

  const ownBuildings = ((own.buildings ?? []) as Record<string, unknown>[]).map(
    (b) => ({
      id: b.id as number,
      type: b.type as string,
      position: b.position as [number, number],
      health: b.health as number,
      maxHealth: b.max_health as number,
      productionQueue: b.production_queue as
        | { type: string; progress: number }[]
        | undefined,
      rallyPoint: b.rally_point as [number, number] | undefined,
      isPrimary: b.is_primary as boolean | undefined,
    })
  );

  const generated = power.generated ?? 0;
  const consumed = power.consumed ?? 0;

  return {
    tick: raw.tick as number,
    gameTime: raw.game_time as string,
    credits: own.credits as number,
    powerGenerated: generated,
    powerConsumed: consumed,
    isLowPower: consumed > generated,
    ownUnits,
    ownBuildings,
    enemyVisibleUnits: (
      (enemy.visible_units ?? []) as Record<string, unknown>[]
    ).map((u) => ({
      id: u.id as number,
      type: u.type as string,
      position: u.position as [number, number],
      healthPercent: u.health_percent as number,
    })),
    enemyVisibleBuildings: (
      (enemy.visible_buildings ?? []) as Record<string, unknown>[]
    ).map((b) => ({
      id: b.id as number,
      type: b.type as string,
      position: b.position as [number, number],
      healthPercent: b.health_percent as number,
    })),
    frozenActors: (
      (enemy.frozen_actors ?? []) as Record<string, unknown>[]
    ).map((f) => ({
      id: f.id as number,
      type: f.type as string,
      position: f.position as [number, number],
      lastSeenTick: f.last_seen_tick as number,
    })),
    exploredPercentage: own.explored_percentage as number,
    mapName: mapInfo.name as string,
    mapSize: mapInfo.size as [number, number],
    knownOreFields: (
      (mapInfo.known_ore_fields ?? []) as Record<string, unknown>[]
    ).map((o) => ({
      center: o.center as [number, number],
      type: o.type as "ore" | "gems",
    })),
    idleUnits: ownUnits.filter((u) => u.isIdle),
    unitCount: ownUnits.length,
    buildingCount: ownBuildings.length,
  };
}

// ─── Logger ─────────────────────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private minLevel: number;

  constructor(level: LogLevel = "info") {
    this.minLevel = LOG_PRIORITY[level];
  }

  debug(msg: string, ...args: unknown[]): void {
    if (LOG_PRIORITY.debug >= this.minLevel)
      console.log(`[IC:DEBUG] ${msg}`, ...args);
  }

  info(msg: string, ...args: unknown[]): void {
    if (LOG_PRIORITY.info >= this.minLevel)
      console.log(`[IC:INFO] ${msg}`, ...args);
  }

  warn(msg: string, ...args: unknown[]): void {
    if (LOG_PRIORITY.warn >= this.minLevel)
      console.warn(`[IC:WARN] ${msg}`, ...args);
  }

  error(msg: string, ...args: unknown[]): void {
    if (LOG_PRIORITY.error >= this.minLevel)
      console.error(`[IC:ERROR] ${msg}`, ...args);
  }
}

// ─── WebSocket Abstraction ──────────────────────────────

type WsImpl = typeof WebSocket;

function getWebSocketImpl(): WsImpl {
  if (typeof WebSocket !== "undefined") return WebSocket;
  // Node.js: try to import 'ws'
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("ws") as WsImpl;
  } catch {
    throw new Error(
      'WebSocket not available. In Node.js, install the "ws" package.'
    );
  }
}

// ─── Agent ──────────────────────────────────────────────

export class IronCurtainAgent {
  private config: Required<AgentConfig>;
  private credentials: AgentCredentials | null = null;
  private matchInfo: MatchInfo | null = null;
  private log: Logger;
  private running = true;
  private matchesPlayed = 0;
  private wins = 0;
  private losses = 0;
  private WS: WsImpl;

  constructor(config: AgentConfig) {
    this.config = {
      mode: "ranked_1v1",
      faction: "random",
      autoQueue: true,
      logLevel: "info",
      onMatchStart: () => {},
      onMatchEnd: () => {},
      onViolation: (v) => v.forEach((msg) => console.warn("Violation:", msg)),
      onChat: () => {},
      apiKey: "",
      agentId: "",
      ...config,
    };

    this.log = new Logger(this.config.logLevel);

    if (this.config.apiKey && this.config.agentId) {
      this.credentials = {
        agentId: this.config.agentId,
        name: this.config.name,
        apiKey: this.config.apiKey,
        elo: 1200,
      };
    }

    this.WS = getWebSocketImpl();
  }

  /**
   * Start the agent. Returns a promise that resolves when stopped.
   */
  async run(): Promise<void> {
    // Register if needed
    if (!this.credentials) {
      this.credentials = await this.register();
    }

    this.log.info(
      `Agent ready: ${this.credentials.name} (${this.credentials.agentId})`
    );

    // Main loop: queue → match → play → repeat
    while (this.running) {
      try {
        await this.joinQueue();
        const matchData = await this.waitForMatch();
        if (!matchData) continue;

        await this.playMatch(matchData);
        this.matchesPlayed++;
        this.log.info(
          `Record: ${this.wins}W / ${this.losses}L (${this.matchesPlayed} games)`
        );

        if (!this.config.autoQueue) break;
        await this.sleep(2000);
      } catch (err) {
        this.log.error("Main loop error:", err);
        await this.sleep(5000);
      }
    }
  }

  /**
   * Stop the agent.
   */
  stop(): void {
    this.running = false;
  }

  // ─── API Calls ────────────────────────────────────────

  private async register(): Promise<AgentCredentials> {
    const res = await fetch(
      `${this.config.arenaUrl}/api/agents/register`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.config.name }),
      }
    );

    if (!res.ok) {
      throw new Error(`Registration failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as {
      agent_id: string;
      name: string;
      api_key: string;
      elo: number;
    };

    this.log.info(`Registered as ${data.name} (ELO: ${data.elo})`);
    this.log.warn(`API KEY (save this!): ${data.api_key}`);

    return {
      agentId: data.agent_id,
      name: data.name,
      apiKey: data.api_key,
      elo: data.elo,
    };
  }

  private async joinQueue(): Promise<void> {
    const res = await fetch(`${this.config.arenaUrl}/api/queue/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.credentials!.apiKey}`,
      },
      body: JSON.stringify({
        mode: this.config.mode,
        faction_preference: this.config.faction,
      }),
    });

    if (res.status === 409) {
      this.log.debug("Already in queue");
      return;
    }

    if (!res.ok) {
      throw new Error(`Queue join failed: ${res.status}`);
    }

    this.log.info(`Joined ${this.config.mode} queue`);
  }

  private waitForMatch(): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      const wsUrl = this.config.arenaUrl
        .replace(/^http/, "ws")
        .replace(/\/$/, "");

      const ws = new this.WS(`${wsUrl}/ws/queue`);

      const timeout = setTimeout(() => {
        ws.close();
        resolve(null);
      }, 300_000); // 5 min timeout

      ws.onopen = () => {
        this.log.info("Waiting for match...");
        ws.send(
          JSON.stringify({
            type: "identify",
            agent_id: this.credentials!.agentId,
          })
        );
      };

      ws.onmessage = (event: MessageEvent) => {
        const msg = JSON.parse(
          typeof event.data === "string" ? event.data : event.data.toString()
        ) as Record<string, unknown>;

        if (msg.event === "match_found") {
          clearTimeout(timeout);
          ws.close();
          this.log.info("Match found!");
          resolve(msg.data as Record<string, unknown>);
        } else if (msg.event === "queue_timeout") {
          clearTimeout(timeout);
          ws.close();
          this.log.info("Queue timeout");
          resolve(null);
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(null);
      };
    });
  }

  private playMatch(matchData: Record<string, unknown>): Promise<void> {
    return new Promise((resolve) => {
      const matchId = matchData.id as string;
      const players = (matchData.players ?? []) as Record<string, unknown>[];
      const mapName = matchData.map as string;

      const ourPlayer = players.find(
        (p) => p.agent_id === this.credentials!.agentId
      );
      const opponent = players.find(
        (p) => p.agent_id !== this.credentials!.agentId
      );

      this.matchInfo = {
        matchId,
        mapName,
        faction: (ourPlayer?.faction as string) ?? "random",
        opponent: (opponent?.agent_name as string) ?? "Unknown",
        settings: (matchData.settings as Record<string, unknown>) ?? {},
      };

      this.config.onMatchStart(this.matchInfo);

      const wsUrl = this.config.arenaUrl
        .replace(/^http/, "ws")
        .replace(/\/$/, "");

      const ws = new this.WS(`${wsUrl}/ws/match/${matchId}/agent`);

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "identify",
            agent_id: this.credentials!.agentId,
          })
        );
      };

      ws.onmessage = (event: MessageEvent) => {
        const msg = JSON.parse(
          typeof event.data === "string" ? event.data : event.data.toString()
        ) as Record<string, unknown>;

        const msgType = msg.type as string;

        if (msgType === "state_update" || msgType === "state_response") {
          const state = parseGameState(msg.state as Record<string, unknown>);
          const orders = this.config.onGameState(state);

          if (orders.length > 0) {
            ws.send(
              JSON.stringify({
                type: "orders",
                agent_id: this.credentials!.agentId,
                orders,
              })
            );
          }
        } else if (msgType === "game_end") {
          const result = msg.result as string;
          if (result === "victory") this.wins++;
          else if (result === "defeat") this.losses++;

          this.config.onMatchEnd({
            result: result as "victory" | "defeat" | "draw",
            winnerId: msg.winner_id as string | null,
            reason: msg.reason as string,
            durationSecs: msg.duration_secs as number,
          });

          ws.close();
          resolve();
        } else if (msgType === "order_violations") {
          this.config.onViolation(msg.violations as string[]);
        } else if (msgType === "chat") {
          this.config.onChat(msg.from as string, msg.message as string);
        }
      };

      ws.onclose = () => resolve();
      ws.onerror = () => resolve();
    });
  }

  // ─── Helpers ──────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─── Example Usage ──────────────────────────────────────

/*
// Run this to see the adapter in action:

const bot = new IronCurtainAgent({
  name: 'JSBot',
  arenaUrl: 'http://localhost:8080',
  mode: 'ranked_1v1',
  faction: 'random',

  onGameState: (state) => {
    const orders: GameOrder[] = [];

    // Deploy MCV if we have one
    const mcv = state.ownUnits.find(u => u.type === 'mcv');
    if (mcv) {
      orders.push(Orders.deploy([mcv.id]));
    }

    // Train heavy tanks
    if (state.credits > 1000) {
      orders.push(Orders.train('3tnk', 2));
    }

    // Attack-move idle combat units
    const idle = state.idleUnits.filter(u => u.type !== 'harv' && u.type !== 'mcv');
    if (idle.length >= 5) {
      const center: [number, number] = [state.mapSize[0] / 2, state.mapSize[1] / 2];
      orders.push(Orders.attackMove(idle.map(u => u.id), center));
    }

    return orders;
  },

  onMatchStart: (info) => {
    console.log(`Match started: ${info.mapName} as ${info.faction} vs ${info.opponent}`);
  },

  onMatchEnd: (result) => {
    console.log(`Match ended: ${result.result} (${result.reason})`);
  },
});

bot.run();
*/
