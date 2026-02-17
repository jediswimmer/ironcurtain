/**
 * Mock IPC Server — simulates the OpenRA ExternalBot for testing.
 *
 * Provides realistic fake game state so the MCP server can be tested
 * end-to-end without running OpenRA.
 */

import * as net from "node:net";
import type {
  GameStatus,
  GameSettings,
  UnitsResponse,
  BuildingsResponse,
  ResourcesResponse,
  EnemyIntelResponse,
  MapInfo,
  BuildOptionsResponse,
  ProductionQueueResponse,
  MoveResult,
  AttackMoveResult,
  AttackTargetResult,
  BuildStructureResult,
  TrainUnitResult,
  DeployResult,
  RallyPointResult,
  SellResult,
  RepairResult,
  ScoutResult,
} from "../types.js";

// ─── Mock Game State ─────────────────────────────────────────────────────────

const MOCK_STATUS: GameStatus = {
  phase: "playing",
  tick: 15000,
  elapsed_time: "10:25",
  game_speed: "normal",
  our_faction: "soviet",
  our_credits: 5420,
  unit_count: 12,
  building_count: 8,
  power: { current: 300, drain: 250, surplus: 50 },
  kill_count: 7,
  loss_count: 3,
  players: [
    { name: "Skippy", faction: "soviet", is_us: true, is_bot: false, color: "#FF0000" },
    { name: "Enemy", faction: "allies", is_us: false, is_bot: true, color: "#0000FF" },
  ],
};

const MOCK_SETTINGS: GameSettings = {
  game_id: "match-001",
  map_name: "Ore Lord",
  map_size: [128, 128],
  game_speed: "normal",
  fog_of_war: true,
  shroud: true,
  starting_cash: 10000,
  tech_level: "unrestricted",
  players: MOCK_STATUS.players,
};

const MOCK_UNITS: UnitsResponse = {
  units: [
    {
      id: 1,
      type: "mcv",
      display_name: "Mobile Construction Vehicle",
      position: [45, 32],
      health: 600,
      max_health: 600,
      health_percent: 100,
      status: "idle",
      activity: null,
      can_attack: false,
      can_move: true,
      veterancy: 0,
    },
    {
      id: 10,
      type: "2tnk",
      display_name: "Heavy Tank",
      position: [50, 35],
      health: 400,
      max_health: 400,
      health_percent: 100,
      status: "idle",
      activity: null,
      can_attack: true,
      can_move: true,
      veterancy: 0,
    },
    {
      id: 11,
      type: "2tnk",
      display_name: "Heavy Tank",
      position: [51, 35],
      health: 300,
      max_health: 400,
      health_percent: 75,
      status: "moving",
      activity: "Moving to [60, 40]",
      can_attack: true,
      can_move: true,
      veterancy: 1,
    },
    {
      id: 20,
      type: "e1",
      display_name: "Rifle Infantry",
      position: [44, 30],
      health: 50,
      max_health: 50,
      health_percent: 100,
      status: "idle",
      activity: null,
      can_attack: true,
      can_move: true,
      veterancy: 0,
    },
    {
      id: 30,
      type: "harv",
      display_name: "Ore Harvester",
      position: [55, 50],
      health: 600,
      max_health: 600,
      health_percent: 100,
      status: "harvesting",
      activity: "Harvesting ore",
      can_attack: false,
      can_move: true,
      veterancy: 0,
    },
    {
      id: 40,
      type: "dog",
      display_name: "Attack Dog",
      position: [46, 33],
      health: 20,
      max_health: 20,
      health_percent: 100,
      status: "idle",
      activity: null,
      can_attack: true,
      can_move: true,
      veterancy: 0,
    },
  ],
  total_count: 6,
  by_type: { mcv: 1, "2tnk": 2, e1: 1, harv: 1, dog: 1 },
};

const MOCK_BUILDINGS: BuildingsResponse = {
  buildings: [
    {
      id: 100,
      type: "fact",
      display_name: "Construction Yard",
      position: [45, 32],
      health: 1500,
      max_health: 1500,
      health_percent: 100,
      is_producing: true,
      production_queue: [
        { type: "powr", display_name: "Power Plant", progress_percent: 65, cost: 300, paused: false },
      ],
      rally_point: null,
      power_generated: 0,
      power_consumed: 15,
      is_being_repaired: false,
      is_primary: true,
    },
    {
      id: 101,
      type: "powr",
      display_name: "Power Plant",
      position: [43, 32],
      health: 400,
      max_health: 400,
      health_percent: 100,
      is_producing: false,
      production_queue: [],
      rally_point: null,
      power_generated: 100,
      power_consumed: 0,
      is_being_repaired: false,
      is_primary: false,
    },
    {
      id: 102,
      type: "proc",
      display_name: "Ore Refinery",
      position: [47, 34],
      health: 800,
      max_health: 800,
      health_percent: 100,
      is_producing: false,
      production_queue: [],
      rally_point: null,
      power_generated: 0,
      power_consumed: 30,
      is_being_repaired: false,
      is_primary: false,
    },
    {
      id: 103,
      type: "weap",
      display_name: "War Factory",
      position: [43, 30],
      health: 1000,
      max_health: 1000,
      health_percent: 100,
      is_producing: true,
      production_queue: [
        { type: "2tnk", display_name: "Heavy Tank", progress_percent: 80, cost: 1200, paused: false },
        { type: "2tnk", display_name: "Heavy Tank", progress_percent: 0, cost: 1200, paused: false },
      ],
      rally_point: [50, 35],
      power_generated: 0,
      power_consumed: 30,
      is_being_repaired: false,
      is_primary: true,
    },
  ],
  power_summary: { current: 300, drain: 250, surplus: 50 },
};

const MOCK_RESOURCES: ResourcesResponse = {
  credits: 5420,
  income_per_minute: 850,
  harvesters: [
    {
      id: 30,
      status: "harvesting",
      position: [55, 50],
      load_percent: 75,
      assigned_refinery: 102,
    },
  ],
  known_ore_fields: [
    {
      center: [55, 50],
      type: "ore",
      estimated_value: "high",
      distance_from_base: 10,
      threat_level: "safe",
    },
    {
      center: [30, 80],
      type: "gems",
      estimated_value: "medium",
      distance_from_base: 50,
      threat_level: "contested",
    },
  ],
  refineries: [{ id: 102, position: [47, 34], harvesters_assigned: 1 }],
  silos: { count: 1, storage_capacity: 2000, storage_used: 1420 },
};

const MOCK_ENEMY_INTEL: EnemyIntelResponse = {
  visible_units: [
    {
      id: 200,
      type: "1tnk",
      display_name: "Light Tank",
      owner: "Enemy",
      position: [80, 70],
      health_percent: 100,
      is_frozen: false,
      last_seen_tick: null,
    },
  ],
  visible_buildings: [
    {
      id: 250,
      type: "fact",
      display_name: "Construction Yard",
      owner: "Enemy",
      position: [110, 105],
      health_percent: 80,
      is_frozen: true,
      last_seen_tick: 12000,
    },
  ],
  enemy_base_locations: [[110, 105]],
  threat_assessment: {
    known_army_value: 15000,
    known_building_value: 25000,
    estimated_strength: "moderate",
  },
};

const MOCK_MAP_INFO: MapInfo = {
  name: "Ore Lord",
  size: [128, 128],
  tileset: "temperate",
  spawn_points: [
    [10, 10],
    [118, 118],
  ],
  explored_percentage: 45.2,
  terrain_summary: {
    water_cells: 1200,
    buildable_cells: 8500,
    cliff_cells: 400,
  },
  ore_fields: [
    {
      center: [55, 50],
      type: "ore",
      estimated_value: "high",
      distance_from_base: 10,
      threat_level: "safe",
    },
    {
      center: [30, 80],
      type: "gems",
      estimated_value: "medium",
      distance_from_base: 50,
      threat_level: "contested",
    },
  ],
};

const MOCK_BUILD_OPTIONS: BuildOptionsResponse = {
  buildings: [
    {
      type: "powr",
      display_name: "Power Plant",
      cost: 300,
      build_time_ticks: 375,
      prerequisites_met: true,
      can_afford: true,
      prerequisites: [],
      produced_at: "fact",
      power: 100,
    },
    {
      type: "barr",
      display_name: "Barracks",
      cost: 400,
      build_time_ticks: 500,
      prerequisites_met: true,
      can_afford: true,
      prerequisites: ["powr"],
      produced_at: "fact",
    },
    {
      type: "tsla",
      display_name: "Tesla Coil",
      cost: 1500,
      build_time_ticks: 750,
      prerequisites_met: true,
      can_afford: true,
      prerequisites: ["stek"],
      produced_at: "fact",
      power: -75,
    },
  ],
  units: [
    {
      type: "e1",
      display_name: "Rifle Infantry",
      cost: 100,
      build_time_ticks: 125,
      prerequisites_met: true,
      can_afford: true,
      prerequisites: [],
      produced_at: "barr",
    },
    {
      type: "2tnk",
      display_name: "Heavy Tank",
      cost: 1200,
      build_time_ticks: 600,
      prerequisites_met: true,
      can_afford: true,
      prerequisites: [],
      produced_at: "weap",
    },
  ],
};

const MOCK_PRODUCTION_QUEUE: ProductionQueueResponse = {
  building_queue: [
    {
      type: "powr",
      display_name: "Power Plant",
      progress_percent: 65,
      paused: false,
      remaining_ticks: 131,
      cost: 300,
      cost_remaining: 105,
    },
  ],
  unit_queues: [
    {
      producer: { id: 103, type: "weap" },
      queue: [
        {
          type: "2tnk",
          display_name: "Heavy Tank",
          progress_percent: 80,
          paused: false,
          remaining_ticks: 120,
          cost: 1200,
          cost_remaining: 240,
        },
        {
          type: "2tnk",
          display_name: "Heavy Tank",
          progress_percent: 0,
          paused: false,
          remaining_ticks: 600,
          cost: 1200,
          cost_remaining: 1200,
        },
      ],
    },
  ],
};

// ─── Request Handler ─────────────────────────────────────────────────────────

type MockResponse =
  | GameStatus
  | GameSettings
  | UnitsResponse
  | BuildingsResponse
  | ResourcesResponse
  | EnemyIntelResponse
  | MapInfo
  | BuildOptionsResponse
  | ProductionQueueResponse
  | MoveResult
  | AttackMoveResult
  | AttackTargetResult
  | BuildStructureResult
  | TrainUnitResult
  | DeployResult
  | RallyPointResult
  | SellResult
  | RepairResult
  | ScoutResult
  | { error: string };

function handleRequest(method: string, params: Record<string, unknown>): MockResponse {
  switch (method) {
    case "get_state":
      return MOCK_STATUS;
    case "get_settings":
      return MOCK_SETTINGS;
    case "get_units": {
      const filterStatus = params.filter_status as string | undefined;
      const filterType = params.filter_type as string | undefined;
      let units = [...MOCK_UNITS.units];
      if (filterType) units = units.filter((u) => u.type === filterType);
      if (filterStatus && filterStatus !== "all") {
        units = units.filter((u) => u.status === filterStatus);
      }
      return {
        units,
        total_count: units.length,
        by_type: units.reduce(
          (acc, u) => {
            acc[u.type] = (acc[u.type] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        ),
      };
    }
    case "get_buildings":
      return MOCK_BUILDINGS;
    case "get_resources":
      return MOCK_RESOURCES;
    case "get_enemy_intel":
      return MOCK_ENEMY_INTEL;
    case "get_map_info":
      return MOCK_MAP_INFO;
    case "get_build_options":
    case "get_tech_tree":
      return MOCK_BUILD_OPTIONS;
    case "get_production_queue":
      return MOCK_PRODUCTION_QUEUE;
    case "issue_order":
    case "issue_orders": {
      const order = params.order as string | undefined;
      const orders = params.orders as Array<Record<string, unknown>> | undefined;
      const primaryOrder = order ?? (orders?.[0]?.order as string) ?? "unknown";
      const unitCount = orders?.length ?? 1;

      switch (primaryOrder) {
        case "Move":
          return {
            success: true,
            units_moved: unitCount,
            target: (params.target_cell ?? orders?.[0]?.target_cell ?? [0, 0]) as [number, number],
            estimated_arrival_ticks: 200,
          };
        case "AttackMove":
          return {
            success: true,
            units_ordered: unitCount,
            target: (params.target_cell ?? orders?.[0]?.target_cell ?? [0, 0]) as [number, number],
          };
        case "Attack":
          return {
            success: true,
            attackers: unitCount,
            target: { id: (params.target_id ?? 0) as number, type: "1tnk", position: [80, 70] as [number, number] },
          };
        case "StartProduction":
          return {
            success: true,
            building_type: (params.type ?? "powr") as string,
            position: (params.placement_position ?? null) as [number, number] | null,
            estimated_completion_ticks: 500,
            cost: 300,
          };
        case "DeployTransform":
          return {
            success: true,
            deployed_as: "fact",
            position: [45, 32] as [number, number],
            message: "MCV deployed as Construction Yard",
          };
        case "SetRallyPoint":
          return {
            success: true,
            building: "weap",
            rally_point: (params.position ?? [0, 0]) as [number, number],
          };
        case "Sell":
          return {
            success: true,
            sold: "powr",
            refund_estimate: 150,
          };
        case "RepairBuilding":
          return {
            success: true,
            building: "weap",
            repairing: true,
            estimated_cost: 200,
          };
        default:
          return {
            success: true,
            message: `Order ${primaryOrder} accepted`,
          } as MoveResult;
      }
    }
    default:
      return { error: `Unknown method: ${method}` };
  }
}

// ─── TCP Server ──────────────────────────────────────────────────────────────

export interface MockIpcServer {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Start a mock IPC server on the specified port.
 * Returns a handle with the port and a close() method.
 */
export function startMockIpcServer(port = 0): Promise<MockIpcServer> {
  return new Promise((resolve, reject) => {
    const tcpServer = net.createServer((socket) => {
      let buffer = "";

      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const msg = JSON.parse(trimmed) as {
              id: number;
              method: string;
              params: Record<string, unknown>;
            };
            const result = handleRequest(msg.method, msg.params);

            if ("error" in result && typeof result.error === "string") {
              socket.write(
                JSON.stringify({ id: msg.id, error: result.error }) + "\n"
              );
            } else {
              socket.write(
                JSON.stringify({ id: msg.id, result }) + "\n"
              );
            }
          } catch {
            // Ignore malformed JSON
          }
        }
      });
    });

    tcpServer.on("error", reject);

    tcpServer.listen(port, "127.0.0.1", () => {
      const addr = tcpServer.address();
      const assignedPort = typeof addr === "object" && addr !== null ? addr.port : port;

      resolve({
        port: assignedPort,
        async close() {
          return new Promise<void>((res, rej) => {
            tcpServer.close((err) => (err ? rej(err) : res()));
          });
        },
      });
    });
  });
}

// ─── Standalone Mode ─────────────────────────────────────────────────────────

// When run directly, start the mock server on port 18642
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("mock-ipc-server.ts") ||
    process.argv[1].endsWith("mock-ipc-server.js"));

if (isMainModule) {
  const DEFAULT_PORT = 18642;
  startMockIpcServer(DEFAULT_PORT).then((srv) => {
    console.log(`Mock IPC server listening on port ${srv.port}`);
    console.log("Simulating OpenRA ExternalBot — ready for MCP server connections");
    console.log("Press Ctrl+C to stop");
  });
}
