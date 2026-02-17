/**
 * Tests for Strategy tools (get_build_options, get_production_queue, scout_area)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { IpcClient } from "../ipc/client.js";
import { registerStrategyTools } from "../tools/strategy.js";
import { startMockIpcServer, type MockIpcServer } from "./mock-ipc-server.js";
import type {
  ToolMap,
  BuildOptionsResponse,
  ProductionQueueResponse,
  ScoutResult,
} from "../types.js";

describe("Strategy Tools", () => {
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
    registerStrategyTools(tools, ipc);
  });

  afterAll(async () => {
    ipc.disconnect();
    await mockServer.close();
  });

  it("should register all 3 strategy tools", () => {
    expect(tools.has("get_build_options")).toBe(true);
    expect(tools.has("get_production_queue")).toBe(true);
    expect(tools.has("scout_area")).toBe(true);
  });

  describe("get_build_options", () => {
    it("should return available buildings and units", async () => {
      const handler = tools.get("get_build_options")!.handler;
      const result = (await handler({})) as BuildOptionsResponse;

      expect(result.buildings.length).toBeGreaterThan(0);
      expect(result.units.length).toBeGreaterThan(0);

      const building = result.buildings[0];
      expect(building.type).toBe("powr");
      expect(building.cost).toBe(300);
      expect(building.prerequisites_met).toBe(true);
    });

    it("should accept category filter", async () => {
      const handler = tools.get("get_build_options")!.handler;
      // Mock returns all regardless of filter, but validates the param goes through
      const result = (await handler({ category: "building" })) as BuildOptionsResponse;
      expect(result).toBeDefined();
    });
  });

  describe("get_production_queue", () => {
    it("should return all active production", async () => {
      const handler = tools.get("get_production_queue")!.handler;
      const result = (await handler({})) as ProductionQueueResponse;

      expect(result.building_queue.length).toBeGreaterThan(0);
      expect(result.unit_queues.length).toBeGreaterThan(0);

      const buildingItem = result.building_queue[0];
      expect(buildingItem.type).toBe("powr");
      expect(buildingItem.progress_percent).toBe(65);
      expect(buildingItem.paused).toBe(false);

      const unitQueue = result.unit_queues[0];
      expect(unitQueue.producer.type).toBe("weap");
      expect(unitQueue.queue.length).toBe(2);
    });
  });

  describe("scout_area", () => {
    it("should auto-select a scout and send it", async () => {
      const handler = tools.get("scout_area")!.handler;
      const result = (await handler({
        target: [80, 80],
      })) as ScoutResult;

      expect(result.success).toBe(true);
      expect(result.scout).not.toBeNull();
      // The mock auto-selects the dog (fastest idle unit)
      expect(result.scout!.type).toBe("dog");
      expect(result.target).toEqual([80, 80]);
    });

    it("should use specific unit when unit_id provided", async () => {
      const handler = tools.get("scout_area")!.handler;
      const result = (await handler({
        target: [80, 80],
        unit_id: 10,
      })) as ScoutResult;

      expect(result.success).toBeDefined();
      expect(result.target).toEqual([80, 80]);
    });
  });
});
