/**
 * Tests for Intelligence tools (get_units, get_buildings, get_resources, etc.)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { IpcClient } from "../ipc/client.js";
import { registerIntelligenceTools } from "../tools/intelligence.js";
import { startMockIpcServer, type MockIpcServer } from "./mock-ipc-server.js";
import type {
  ToolMap,
  UnitsResponse,
  BuildingsResponse,
  ResourcesResponse,
  EnemyIntelResponse,
  MapInfo,
  BuildOptionsResponse,
} from "../types.js";

describe("Intelligence Tools", () => {
  let mockServer: MockIpcServer;
  let ipc: IpcClient;
  let tools: ToolMap;

  beforeAll(async () => {
    mockServer = await startMockIpcServer(0);
    ipc = new IpcClient({
      ipcSocketPath: "/tmp/nonexistent.sock",
      ipcHost: "127.0.0.1",
      ipcPort: mockServer.port,
      ipcTimeoutMs: 5000,
      ipcMaxReconnectAttempts: 0,
      ipcReconnectBaseDelayMs: 1000,
      serverName: "test",
      serverVersion: "0.0.0",
      verbose: false,
    });
    await ipc.connect();

    tools = new Map();
    registerIntelligenceTools(tools, ipc);
  });

  afterAll(async () => {
    ipc.disconnect();
    await mockServer.close();
  });

  it("should register all 6 intelligence tools", () => {
    expect(tools.has("get_units")).toBe(true);
    expect(tools.has("get_buildings")).toBe(true);
    expect(tools.has("get_resources")).toBe(true);
    expect(tools.has("get_enemy_intel")).toBe(true);
    expect(tools.has("get_map")).toBe(true);
    expect(tools.has("get_tech_tree")).toBe(true);
  });

  describe("get_units", () => {
    it("should return all units when no filter", async () => {
      const handler = tools.get("get_units")!.handler;
      const result = (await handler({})) as UnitsResponse;

      expect(result.units.length).toBeGreaterThan(0);
      expect(result.total_count).toBe(result.units.length);
      expect(result.by_type).toBeDefined();

      const unit = result.units[0];
      expect(unit).toHaveProperty("id");
      expect(unit).toHaveProperty("type");
      expect(unit).toHaveProperty("display_name");
      expect(unit).toHaveProperty("position");
      expect(unit).toHaveProperty("health");
      expect(unit).toHaveProperty("max_health");
      expect(unit).toHaveProperty("health_percent");
      expect(unit).toHaveProperty("status");
    });

    it("should filter units by type", async () => {
      const handler = tools.get("get_units")!.handler;
      const result = (await handler({ filter_type: "2tnk" })) as UnitsResponse;

      expect(result.units.length).toBe(2);
      for (const unit of result.units) {
        expect(unit.type).toBe("2tnk");
      }
    });

    it("should filter units by status", async () => {
      const handler = tools.get("get_units")!.handler;
      const result = (await handler({ filter_status: "idle" })) as UnitsResponse;

      for (const unit of result.units) {
        expect(unit.status).toBe("idle");
      }
    });
  });

  describe("get_buildings", () => {
    it("should return all buildings with production info", async () => {
      const handler = tools.get("get_buildings")!.handler;
      const result = (await handler({})) as BuildingsResponse;

      expect(result.buildings.length).toBeGreaterThan(0);
      expect(result.power_summary).toBeDefined();
      expect(result.power_summary.current).toBeGreaterThan(0);

      const building = result.buildings[0];
      expect(building).toHaveProperty("id");
      expect(building).toHaveProperty("type");
      expect(building).toHaveProperty("production_queue");
      expect(building).toHaveProperty("power_generated");
      expect(building).toHaveProperty("power_consumed");
    });
  });

  describe("get_resources", () => {
    it("should return economic data", async () => {
      const handler = tools.get("get_resources")!.handler;
      const result = (await handler({})) as ResourcesResponse;

      expect(result.credits).toBe(5420);
      expect(result.income_per_minute).toBe(850);
      expect(result.harvesters.length).toBeGreaterThan(0);
      expect(result.known_ore_fields.length).toBeGreaterThan(0);
      expect(result.refineries.length).toBeGreaterThan(0);
      expect(result.silos).toBeDefined();
    });
  });

  describe("get_enemy_intel", () => {
    it("should return visible enemy forces", async () => {
      const handler = tools.get("get_enemy_intel")!.handler;
      const result = (await handler({})) as EnemyIntelResponse;

      expect(result.visible_units.length).toBeGreaterThan(0);
      expect(result.visible_buildings.length).toBeGreaterThan(0);
      expect(result.enemy_base_locations.length).toBeGreaterThan(0);
      expect(result.threat_assessment.estimated_strength).toBe("moderate");
    });
  });

  describe("get_map", () => {
    it("should return map metadata", async () => {
      const handler = tools.get("get_map")!.handler;
      const result = (await handler({})) as MapInfo;

      expect(result.name).toBe("Ore Lord");
      expect(result.size).toEqual([128, 128]);
      expect(result.tileset).toBe("temperate");
      expect(result.spawn_points.length).toBeGreaterThan(0);
      expect(result.explored_percentage).toBeGreaterThan(0);
      expect(result.terrain_summary).toBeDefined();
    });
  });

  describe("get_tech_tree", () => {
    it("should return buildable items", async () => {
      const handler = tools.get("get_tech_tree")!.handler;
      const result = (await handler({})) as BuildOptionsResponse;

      expect(result.buildings.length).toBeGreaterThan(0);
      expect(result.units.length).toBeGreaterThan(0);

      const building = result.buildings[0];
      expect(building).toHaveProperty("type");
      expect(building).toHaveProperty("cost");
      expect(building).toHaveProperty("prerequisites_met");
      expect(building).toHaveProperty("can_afford");
    });
  });
});
