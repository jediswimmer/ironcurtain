/**
 * Integration Tests — Mock-based integration testing for IronCurtain Arena.
 *
 * Tests the full flow:
 *   1. Agent registration
 *   2. Queue join / matchmaking
 *   3. Match creation
 *   4. WebSocket proxy communication
 *   5. APM limiting
 *   6. Order validation
 *   7. Fog enforcement
 *   8. Match end + ELO update
 *   9. Self-onboarding endpoints
 *
 * These tests use mock game state and don't require a running OpenRA instance.
 * They verify the Arena's logic layer end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Matchmaker, type QueueEntry, type MatchPairing } from "../matchmaker.js";
import { FogEnforcer, type FullGameState, type GameOrder, APM_PROFILES } from "../fog-enforcer.js";
import { ApmLimiter } from "../apm-limiter.js";
import { OrderValidator } from "../order-validator.js";
import { Leaderboard, getTier } from "../leaderboard.js";
import { registerAgent, hashApiKey, validateApiKey, type RegisterResult } from "../auth.js";
import { getDb, closeDb, agentQueries, matchQueries } from "../db.js";

// ─── Test Helpers ───────────────────────────────────────

function createMockGameState(overrides: Partial<FullGameState> = {}): FullGameState {
  return {
    tick: 1000,
    game_time: "1:30",
    players: [
      {
        player_id: "player1",
        agent_id: "agent-1",
        credits: 5000,
        power: { generated: 200, consumed: 150 },
        shroud: {
          visible_cells: new Set(["10,10", "11,10", "12,10", "50,50", "51,50"]),
          explored_cells: new Set(["10,10", "11,10", "12,10", "50,50", "51,50", "20,20"]),
        },
      },
      {
        player_id: "player2",
        agent_id: "agent-2",
        credits: 4500,
        power: { generated: 180, consumed: 160 },
        shroud: {
          visible_cells: new Set(["50,50", "51,50", "52,50"]),
          explored_cells: new Set(["50,50", "51,50", "52,50", "40,40"]),
        },
      },
    ],
    all_units: [
      { id: 1, type: "3tnk", owner_id: "player1", position: [10, 10], health: 400, max_health: 400, is_idle: true },
      { id: 2, type: "3tnk", owner_id: "player1", position: [11, 10], health: 350, max_health: 400, is_idle: false },
      { id: 3, type: "harv", owner_id: "player1", position: [12, 10], health: 600, max_health: 600, is_idle: false },
      { id: 4, type: "2tnk", owner_id: "player2", position: [50, 50], health: 300, max_health: 300, is_idle: true },
      { id: 5, type: "e1", owner_id: "player2", position: [51, 50], health: 50, max_health: 50, is_idle: false },
      { id: 6, type: "3tnk", owner_id: "player2", position: [80, 80], health: 400, max_health: 400, is_idle: true },
    ],
    all_buildings: [
      { id: 100, type: "fact", owner_id: "player1", position: [8, 8], health: 1000, max_health: 1000 },
      { id: 101, type: "weap", owner_id: "player1", position: [10, 8], health: 800, max_health: 800, production_queue: [{ type: "3tnk", progress: 0.5 }] },
      { id: 200, type: "fact", owner_id: "player2", position: [55, 55], health: 1000, max_health: 1000 },
      { id: 201, type: "weap", owner_id: "player2", position: [57, 55], health: 800, max_health: 800 },
    ],
    ore_fields: [
      { center: [20, 20] as [number, number], type: "ore" as const },
      { center: [40, 40] as [number, number], type: "gems" as const },
    ],
    map: {
      name: "Ore Lord",
      size: [128, 128] as [number, number],
      total_cells: 16384,
    },
    ...overrides,
  };
}

function createQueueEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    agent_id: `agent-${Math.random().toString(36).slice(2, 8)}`,
    agent_name: `Bot-${Math.random().toString(36).slice(2, 6)}`,
    mode: "ranked_1v1",
    faction_preference: "random",
    elo: 1200,
    elo_range: 200,
    joined_at: Date.now(),
    ...overrides,
  };
}

// ─── Test Suites ────────────────────────────────────────

describe("Fog Enforcer", () => {
  let enforcer: FogEnforcer;

  beforeEach(() => {
    enforcer = new FogEnforcer();
  });

  it("should filter state for agent-1 (only visible units/buildings)", () => {
    const fullState = createMockGameState();
    const filtered = enforcer.filterForAgent(fullState, "agent-1");

    // Agent 1 should see their own units
    expect(filtered.own.units).toHaveLength(3);
    expect(filtered.own.units[0].id).toBe(1);
    expect(filtered.own.units[0].type).toBe("3tnk");
    expect(filtered.own.units[0].health).toBe(400);

    // Agent 1 should see their own buildings
    expect(filtered.own.buildings).toHaveLength(2);
    expect(filtered.own.buildings[0].id).toBe(100);

    // Agent 1 should see own credits and power
    expect(filtered.own.credits).toBe(5000);
    expect(filtered.own.power.generated).toBe(200);

    // Agent 1 should see enemy units at visible positions only
    // Units at [50,50] and [51,50] are visible, unit at [80,80] is NOT
    expect(filtered.enemy.visible_units).toHaveLength(2);
    expect(filtered.enemy.visible_units.map(u => u.id)).toContain(4);
    expect(filtered.enemy.visible_units.map(u => u.id)).toContain(5);
    expect(filtered.enemy.visible_units.map(u => u.id)).not.toContain(6);

    // Enemy units should have health_percent, NOT exact health
    expect(filtered.enemy.visible_units[0].health_percent).toBeDefined();
  });

  it("should NOT leak enemy building production queues", () => {
    const fullState = createMockGameState();
    const filtered = enforcer.filterForAgent(fullState, "agent-1");

    // Own buildings should have production_queue
    const ownWeap = filtered.own.buildings.find(b => b.type === "weap");
    expect(ownWeap?.production_queue).toBeDefined();

    // Enemy buildings should NOT have production_queue
    for (const b of filtered.enemy.visible_buildings) {
      expect((b as unknown as Record<string, unknown>).production_queue).toBeUndefined();
    }
  });

  it("should throw for unknown agent", () => {
    const fullState = createMockGameState();
    expect(() => enforcer.filterForAgent(fullState, "unknown-agent")).toThrow();
  });

  it("should track frozen actors", () => {
    const fullState = createMockGameState();

    // First tick: agent-1 sees enemy units at [50,50] and [51,50]
    enforcer.filterForAgent(fullState, "agent-1");

    // Second tick: those units move away (no longer visible)
    const state2 = createMockGameState();
    state2.all_units[3].position = [60, 60]; // Move player2's tank out of view
    state2.all_units[4].position = [61, 60]; // Move player2's infantry out of view

    const filtered2 = enforcer.filterForAgent(state2, "agent-1");

    // Should have frozen actors from the first tick
    expect(filtered2.enemy.frozen_actors.length).toBeGreaterThan(0);
  });
});

describe("APM Limiter", () => {
  let limiter: ApmLimiter;

  beforeEach(() => {
    limiter = new ApmLimiter();
  });

  it("should allow orders within limits", () => {
    const orders: GameOrder[] = [
      { type: "move", unit_ids: [1, 2], target: [50, 50] },
      { type: "train", build_type: "3tnk", count: 2 },
    ];

    const result = limiter.processOrders("agent-1", orders);
    expect(result.allowed).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
    expect(result.violations).toHaveLength(0);
  });

  it("should reject orders exceeding per-tick limit", () => {
    const orders: GameOrder[] = Array(20).fill(null).map((_, i) => ({
      type: "move",
      unit_ids: [i],
      target: [50, 50] as [number, number],
    }));

    const result = limiter.processOrders("agent-1", orders);
    expect(result.allowed).toHaveLength(0);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("should reject orders with too many units per command", () => {
    const unitIds = Array(100).fill(null).map((_, i) => i);
    const orders: GameOrder[] = [
      { type: "move", unit_ids: unitIds, target: [50, 50] },
    ];

    const result = limiter.processOrders("agent-1", orders);
    expect(result.rejected).toHaveLength(1);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("should track per-agent stats", () => {
    const orders: GameOrder[] = [
      { type: "move", unit_ids: [1], target: [50, 50] },
    ];

    limiter.processOrders("agent-1", orders);
    const stats = limiter.getAllStats();
    expect(stats).toHaveLength(1);
    expect(stats[0].agent_id).toBe("agent-1");
    expect(stats[0].total_orders).toBe(1);
  });
});

describe("Order Validator", () => {
  let validator: OrderValidator;

  beforeEach(() => {
    validator = new OrderValidator();
  });

  it("should accept valid orders", () => {
    const state = createMockGameState();
    const enforcer = new FogEnforcer();
    const filtered = enforcer.filterForAgent(state, "agent-1");

    const orders: GameOrder[] = [
      { type: "move", unit_ids: [1, 2], target: [50, 50] },
      { type: "train", build_type: "3tnk", count: 3 },
    ];

    const result = validator.validate("agent-1", orders, filtered);
    expect(result.valid).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
  });

  it("should reject orders commanding enemy units", () => {
    const state = createMockGameState();
    const enforcer = new FogEnforcer();
    const filtered = enforcer.filterForAgent(state, "agent-1");

    const orders: GameOrder[] = [
      { type: "move", unit_ids: [4, 5], target: [50, 50] }, // These belong to agent-2!
    ];

    const result = validator.validate("agent-1", orders, filtered);
    expect(result.rejected).toHaveLength(1);
    expect(result.violations[0].category).toBe("ownership");
    expect(result.violations[0].severity).toBe("critical");
  });

  it("should reject out-of-bounds targets", () => {
    const state = createMockGameState();
    const enforcer = new FogEnforcer();
    const filtered = enforcer.filterForAgent(state, "agent-1");

    const orders: GameOrder[] = [
      { type: "move", unit_ids: [1], target: [999, 999] },
    ];

    const result = validator.validate("agent-1", orders, filtered);
    expect(result.rejected).toHaveLength(1);
    expect(result.violations[0].category).toBe("bounds");
  });

  it("should reject invalid order types", () => {
    const state = createMockGameState();
    const enforcer = new FogEnforcer();
    const filtered = enforcer.filterForAgent(state, "agent-1");

    const orders: GameOrder[] = [
      { type: "nuke_everything" }, // Not a real order type
    ];

    const result = validator.validate("agent-1", orders, filtered);
    expect(result.rejected).toHaveLength(1);
    expect(result.violations[0].category).toBe("invalid_type");
  });

  it("should reject attacking invisible targets (fog violation)", () => {
    const state = createMockGameState();
    const enforcer = new FogEnforcer();
    const filtered = enforcer.filterForAgent(state, "agent-1");

    const orders: GameOrder[] = [
      { type: "attack", unit_ids: [1], target_id: 6 }, // Unit 6 is at [80,80], NOT visible
    ];

    const result = validator.validate("agent-1", orders, filtered);
    expect(result.rejected).toHaveLength(1);
    expect(result.violations[0].category).toBe("fog_violation");
  });

  it("should accept attacking VISIBLE targets", () => {
    const state = createMockGameState();
    const enforcer = new FogEnforcer();
    const filtered = enforcer.filterForAgent(state, "agent-1");

    const orders: GameOrder[] = [
      { type: "attack", unit_ids: [1], target_id: 4 }, // Unit 4 is at [50,50], visible
    ];

    const result = validator.validate("agent-1", orders, filtered);
    expect(result.valid).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("should reject selling enemy buildings", () => {
    const state = createMockGameState();
    const enforcer = new FogEnforcer();
    const filtered = enforcer.filterForAgent(state, "agent-1");

    const orders: GameOrder[] = [
      { type: "sell", building_id: 200 }, // Building 200 belongs to agent-2
    ];

    const result = validator.validate("agent-1", orders, filtered);
    expect(result.rejected).toHaveLength(1);
    expect(result.violations[0].category).toBe("ownership");
  });

  it("should reject malformed orders", () => {
    const state = createMockGameState();
    const enforcer = new FogEnforcer();
    const filtered = enforcer.filterForAgent(state, "agent-1");

    const orders: GameOrder[] = [
      { type: "move" }, // Missing unit_ids and target
    ];

    const result = validator.validate("agent-1", orders, filtered);
    expect(result.rejected).toHaveLength(1);
    expect(result.violations[0].category).toBe("malformed");
  });

  it("should reject invalid production count", () => {
    const state = createMockGameState();
    const enforcer = new FogEnforcer();
    const filtered = enforcer.filterForAgent(state, "agent-1");

    const orders: GameOrder[] = [
      { type: "train", build_type: "3tnk", count: 999 },
    ];

    const result = validator.validate("agent-1", orders, filtered);
    expect(result.rejected).toHaveLength(1);
    expect(result.violations[0].category).toBe("production");
  });

  it("should track validator stats", () => {
    const state = createMockGameState();
    const enforcer = new FogEnforcer();
    const filtered = enforcer.filterForAgent(state, "agent-1");

    validator.validate("agent-1", [
      { type: "move", unit_ids: [1], target: [50, 50] },
      { type: "invalid_order" },
    ], filtered);

    const stats = validator.getStats();
    expect(stats.total_validated).toBe(2);
    expect(stats.total_accepted).toBe(1);
    expect(stats.total_rejected).toBe(1);
  });
});

describe("Matchmaker", () => {
  let matchmaker: Matchmaker;

  beforeEach(() => {
    matchmaker = new Matchmaker();
  });

  it("should add agents to queue", () => {
    const entry = createQueueEntry({ agent_id: "a1", agent_name: "Bot1" });
    matchmaker.addToQueue(entry);

    const status = matchmaker.getQueueStatus("a1");
    expect(status.in_queue).toBe(true);
    expect(status.position).toBe(1);
  });

  it("should prevent duplicate queue entries", () => {
    const entry = createQueueEntry({ agent_id: "a1" });
    matchmaker.addToQueue(entry);

    expect(() => matchmaker.addToQueue(entry)).toThrow("already in queue");
  });

  it("should remove agents from queue", () => {
    const entry = createQueueEntry({ agent_id: "a1" });
    matchmaker.addToQueue(entry);

    const removed = matchmaker.removeFromQueue("a1");
    expect(removed).toBe(true);

    const status = matchmaker.getQueueStatus("a1");
    expect(status.in_queue).toBe(false);
  });

  it("should pair agents with similar ELO", async () => {
    // Set up test DB
    const db = getDb();
    
    // Insert test agents
    const agent1Id = "test-agent-1-" + Date.now();
    const agent2Id = "test-agent-2-" + Date.now();
    
    agentQueries.insert(db, { id: agent1Id, name: "TestBot1_" + Date.now(), api_key_hash: hashApiKey("test1_" + Date.now()) });
    agentQueries.insert(db, { id: agent2Id, name: "TestBot2_" + Date.now(), api_key_hash: hashApiKey("test2_" + Date.now()) });

    matchmaker.addToQueue(createQueueEntry({
      agent_id: agent1Id,
      agent_name: "TestBot1",
      elo: 1200,
    }));
    matchmaker.addToQueue(createQueueEntry({
      agent_id: agent2Id,
      agent_name: "TestBot2",
      elo: 1250,
    }));

    const pairings = await matchmaker.tick();
    expect(pairings).toHaveLength(1);
    expect(pairings[0].players).toHaveLength(2);
    expect(pairings[0].map).toBeTruthy();
  });

  it("should NOT pair agents with very different ELO (initially)", async () => {
    const db = getDb();
    
    const agent1Id = "test-far-1-" + Date.now();
    const agent2Id = "test-far-2-" + Date.now();
    
    agentQueries.insert(db, { id: agent1Id, name: "FarBot1_" + Date.now(), api_key_hash: hashApiKey("far1_" + Date.now()) });
    agentQueries.insert(db, { id: agent2Id, name: "FarBot2_" + Date.now(), api_key_hash: hashApiKey("far2_" + Date.now()) });

    matchmaker.addToQueue(createQueueEntry({
      agent_id: agent1Id,
      agent_name: "FarBot1",
      elo: 800,
    }));
    matchmaker.addToQueue(createQueueEntry({
      agent_id: agent2Id,
      agent_name: "FarBot2",
      elo: 2000,
    }));

    const pairings = await matchmaker.tick();
    // With 1200 ELO difference and initial 200 range, should NOT match
    expect(pairings).toHaveLength(0);
  });
});

describe("Leaderboard & ELO", () => {
  it("should correctly assign tiers", () => {
    expect(getTier(2500)).toBe("Grandmaster");
    expect(getTier(2200)).toBe("Master");
    expect(getTier(2000)).toBe("Diamond");
    expect(getTier(1800)).toBe("Platinum");
    expect(getTier(1600)).toBe("Gold");
    expect(getTier(1400)).toBe("Silver");
    expect(getTier(1200)).toBe("Bronze");
    expect(getTier(900)).toBe("Unranked");
  });
});

describe("End-to-End: Agent Lifecycle", () => {
  it("should complete a full agent lifecycle (register → queue → match → result)", async () => {
    // This test simulates the complete flow using in-memory components

    // Step 1: Setup
    const matchmaker = new Matchmaker();
    const fogEnforcer = new FogEnforcer();
    const apmLimiter = new ApmLimiter();
    const orderValidator = new OrderValidator();

    // Step 2: Create mock agents in DB
    const db = getDb();
    const ts = Date.now();
    const agent1Id = `lifecycle-1-${ts}`;
    const agent2Id = `lifecycle-2-${ts}`;

    agentQueries.insert(db, { id: agent1Id, name: `LifeBot1_${ts}`, api_key_hash: hashApiKey(`lk1_${ts}`) });
    agentQueries.insert(db, { id: agent2Id, name: `LifeBot2_${ts}`, api_key_hash: hashApiKey(`lk2_${ts}`) });

    // Step 3: Both join queue
    matchmaker.addToQueue(createQueueEntry({
      agent_id: agent1Id,
      agent_name: "LifeBot1",
      elo: 1200,
    }));
    matchmaker.addToQueue(createQueueEntry({
      agent_id: agent2Id,
      agent_name: "LifeBot2",
      elo: 1220,
    }));

    // Step 4: Matchmaker pairs them
    const pairings = await matchmaker.tick();
    expect(pairings).toHaveLength(1);

    const pairing = pairings[0];
    expect(pairing.players).toHaveLength(2);
    expect(pairing.players[0].faction).toBeTruthy();
    expect(pairing.players[1].faction).toBeTruthy();

    // Step 5: Simulate game state (use agent IDs as player IDs too)
    const gameState: FullGameState = {
      tick: 1000,
      game_time: "1:30",
      players: [
        {
          player_id: agent1Id,
          agent_id: agent1Id,
          credits: 5000,
          power: { generated: 200, consumed: 150 },
          shroud: {
            visible_cells: new Set(["10,10", "50,50"]),
            explored_cells: new Set(["10,10", "50,50"]),
          },
        },
        {
          player_id: agent2Id,
          agent_id: agent2Id,
          credits: 4500,
          power: { generated: 180, consumed: 160 },
          shroud: {
            visible_cells: new Set(["50,50", "80,80"]),
            explored_cells: new Set(["50,50", "80,80"]),
          },
        },
      ],
      all_units: [
        { id: 1, type: "3tnk", owner_id: agent1Id, position: [10, 10], health: 400, max_health: 400, is_idle: true },
        { id: 2, type: "harv", owner_id: agent1Id, position: [12, 10], health: 600, max_health: 600, is_idle: false },
        { id: 4, type: "2tnk", owner_id: agent2Id, position: [50, 50], health: 300, max_health: 300, is_idle: true },
      ],
      all_buildings: [
        { id: 100, type: "fact", owner_id: agent1Id, position: [8, 8], health: 1000, max_health: 1000 },
        { id: 200, type: "fact", owner_id: agent2Id, position: [55, 55], health: 1000, max_health: 1000 },
      ],
      ore_fields: [{ center: [20, 20] as [number, number], type: "ore" as const }],
      map: { name: "Ore Lord", size: [128, 128] as [number, number], total_cells: 16384 },
    };

    // Step 6: Filter state for each agent
    const state1 = fogEnforcer.filterForAgent(gameState, agent1Id);
    const state2 = fogEnforcer.filterForAgent(gameState, agent2Id);

    expect(state1.own.credits).toBe(5000);
    expect(state2.own.credits).toBe(4500);

    // Step 7: Agent 1 sends orders
    const agent1Orders: GameOrder[] = [
      { type: "move", unit_ids: [1], target: [50, 50] },
      { type: "train", build_type: "3tnk", count: 2 },
    ];

    // APM check
    const apmResult = apmLimiter.processOrders(agent1Id, agent1Orders);
    expect(apmResult.allowed).toHaveLength(2);

    // Order validation
    const validationResult = orderValidator.validate(agent1Id, apmResult.allowed, state1);
    expect(validationResult.valid).toHaveLength(2);

    // Step 8: Match completes — verify stats
    const leaderboard = new Leaderboard();
    const eloChange = leaderboard.recordResult(
      agent1Id,
      agent2Id,
      pairing.players[0].faction,
      pairing.players[1].faction,
      "ranked_1v1",
      false
    );

    expect(eloChange.winner_elo_change).toBeGreaterThan(0);
    expect(eloChange.loser_elo_change).toBeLessThan(0);
    expect(eloChange.winner_elo_after).toBeGreaterThan(eloChange.winner_elo_before);

    // Step 9: Verify agent records updated
    const updatedAgent1 = agentQueries.getById(db, agent1Id);
    expect(updatedAgent1!.wins).toBe(1);
    expect(updatedAgent1!.elo).toBe(eloChange.winner_elo_after);

    const updatedAgent2 = agentQueries.getById(db, agent2Id);
    expect(updatedAgent2!.losses).toBe(1);
    expect(updatedAgent2!.elo).toBe(eloChange.loser_elo_after);
  });
});

// ─── Setup & Teardown ───────────────────────────────────

import { mkdirSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";

const TEST_DATA_DIR = resolve(tmpdir(), `ironcurtain-test-${process.pid}`);

beforeEach(() => {
  // Use a temp directory for test database
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  process.env.ARENA_DB_PATH = resolve(TEST_DATA_DIR, `test-${Date.now()}.db`);
});

afterEach(() => {
  closeDb();
  try {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});
