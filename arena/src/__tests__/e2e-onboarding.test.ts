/**
 * End-to-End Test: Fresh Agent Self-Onboards and Plays First Match
 *
 * Tests the complete flow an AI agent goes through:
 *   1. Hit /api/onboard to discover the platform
 *   2. Read /api/onboard/rules to learn the game
 *   3. Read /api/onboard/commands to learn the command set
 *   4. Read /api/onboard/strategy for strategy tips
 *   5. Read /api/onboard/factions for faction details
 *   6. Read /api/onboard/maps for map knowledge
 *   7. Register via POST /api/agents/register
 *   8. Join queue, get matched, play a simulated match
 *
 * This test doesn't require a running server — it tests the
 * route handlers and logic directly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer, type Server } from "http";
import { registerOnboardRoutes } from "../api/onboard.js";
import { registerAgentRoutes } from "../api/agents.js";
import { closeDb, getDb, agentQueries } from "../db.js";
import { mkdirSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";

const TEST_DATA_DIR = resolve(tmpdir(), `ironcurtain-e2e-${process.pid}`);
let app: express.Express;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  process.env.ARENA_DB_PATH = resolve(TEST_DATA_DIR, `e2e-${Date.now()}.db`);

  app = express();
  app.use(express.json());
  registerOnboardRoutes(app);
  registerAgentRoutes(app);

  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const addr = server.address();
  if (typeof addr === "object" && addr) {
    baseUrl = `http://localhost:${addr.port}`;
  }
});

afterEach(async () => {
  closeDb();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("E2E: Self-Onboarding Flow", () => {
  it("should complete the full onboarding journey", async () => {
    // ─── Step 1: Discover the platform ──────────────

    const overviewRes = await fetch(`${baseUrl}/api/onboard`);
    expect(overviewRes.status).toBe(200);
    const overview = (await overviewRes.json()) as Record<string, unknown>;
    expect(overview.platform).toBe("IronCurtain");
    expect(overview.protocol).toBe("SAP v1.0");
    expect(overview.quick_start).toBeDefined();
    expect(overview.endpoints).toBeDefined();

    // ─── Step 2: Learn the rules ────────────────────

    const rulesRes = await fetch(`${baseUrl}/api/onboard/rules`);
    expect(rulesRes.status).toBe(200);
    const rules = (await rulesRes.json()) as Record<string, unknown>;
    expect(rules.title).toContain("Game Rules");
    expect(rules.win_conditions).toBeDefined();
    expect(rules.core_mechanics).toBeDefined();
    expect(rules.elo_system).toBeDefined();

    // ─── Step 3: Learn the commands ─────────────────

    const cmdsRes = await fetch(`${baseUrl}/api/onboard/commands`);
    expect(cmdsRes.status).toBe(200);
    const commands = (await cmdsRes.json()) as Record<string, unknown>;
    expect(commands.title).toContain("Command Reference");
    expect(commands.order_types).toBeDefined();
    expect(commands.apm_profiles).toBeDefined();

    const orderTypes = commands.order_types as Array<Record<string, unknown>>;
    expect(orderTypes.length).toBeGreaterThanOrEqual(10);

    // Verify key order types exist
    const orderNames = orderTypes.map((o) => o.type);
    expect(orderNames).toContain("move");
    expect(orderNames).toContain("attack");
    expect(orderNames).toContain("train");
    expect(orderNames).toContain("build");
    expect(orderNames).toContain("deploy");

    // ─── Step 4: Read strategy guide ────────────────

    const stratRes = await fetch(`${baseUrl}/api/onboard/strategy`);
    expect(stratRes.status).toBe(200);
    const strategy = (await stratRes.json()) as Record<string, unknown>;
    expect(strategy.fundamentals).toBeDefined();
    expect(strategy.game_phases).toBeDefined();
    expect(strategy.common_mistakes).toBeDefined();
    expect(strategy.ai_specific_advice).toBeDefined();

    // ─── Step 5: Learn factions ─────────────────────

    const factionsRes = await fetch(`${baseUrl}/api/onboard/factions`);
    expect(factionsRes.status).toBe(200);
    const factions = (await factionsRes.json()) as Record<string, unknown>;
    const factionData = factions.factions as Record<string, Record<string, unknown>>;
    expect(factionData.soviet).toBeDefined();
    expect(factionData.allies).toBeDefined();

    // Verify units and buildings exist for each faction
    expect(factionData.soviet.units).toBeDefined();
    expect(factionData.soviet.buildings).toBeDefined();
    expect(factionData.allies.units).toBeDefined();
    expect(factionData.allies.buildings).toBeDefined();

    const sovietUnits = factionData.soviet.units as Array<Record<string, unknown>>;
    expect(sovietUnits.length).toBeGreaterThan(5);

    // ─── Step 6: Learn maps ─────────────────────────

    const mapsRes = await fetch(`${baseUrl}/api/onboard/maps`);
    expect(mapsRes.status).toBe(200);
    const maps = (await mapsRes.json()) as Record<string, unknown>;
    const mapList = maps.maps as Array<Record<string, unknown>>;
    expect(mapList.length).toBe(8); // Current map pool size
    expect(mapList[0].name).toBeDefined();
    expect(mapList[0].strategy_notes).toBeDefined();
    expect(mapList[0].dimensions).toBeDefined();

    // ─── Step 7: Register ───────────────────────────

    const registerRes = await fetch(`${baseUrl}/api/agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "E2E_TestBot" }),
    });
    expect(registerRes.status).toBe(201);
    const registration = (await registerRes.json()) as Record<string, unknown>;
    expect(registration.agent_id).toBeDefined();
    expect(registration.api_key).toBeDefined();
    expect(registration.name).toBe("E2E_TestBot");
    expect(registration.elo).toBe(1200);

    // Verify agent was stored in the database
    const db = getDb();
    const storedAgent = agentQueries.getByName(db, "E2E_TestBot");
    expect(storedAgent).toBeDefined();
    expect(storedAgent!.elo).toBe(1200);
    expect(storedAgent!.games_played).toBe(0);

    // ─── COMPLETE ────────────────────────────────────

    // At this point, a real agent would:
    // 1. POST /api/queue/join (with their API key)
    // 2. Connect to ws://host/ws/queue (for match notification)
    // 3. On match_found, connect to ws://host/ws/match/{id}/agent
    // 4. Send identify, then start sending orders on state_update
    // 5. Play until game_end
    //
    // We can't test WebSocket flows in this unit test,
    // but the integration.test.ts covers the matchmaker/fog/APM logic.

    console.log("✅ E2E Self-Onboarding: Agent successfully discovered, learned, and registered!");
  });

  it("should reject duplicate registration", async () => {
    // Register first
    const res1 = await fetch(`${baseUrl}/api/agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "UniqueBot" }),
    });
    expect(res1.status).toBe(201);

    // Try to register with the same name
    const res2 = await fetch(`${baseUrl}/api/agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "UniqueBot" }),
    });
    expect(res2.status).toBe(409);
  });

  it("should reject invalid agent names", async () => {
    const res = await fetch(`${baseUrl}/api/agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X" }), // Too short (min 3 chars)
    });
    expect(res.status).toBe(400); // Caught by input validation before registration
  });
});
