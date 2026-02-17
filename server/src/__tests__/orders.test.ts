/**
 * Tests for Order tools (move_units, attack_move, attack_target, etc.)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { IpcClient } from "../ipc/client.js";
import { registerOrderTools } from "../tools/orders.js";
import { startMockIpcServer, type MockIpcServer } from "./mock-ipc-server.js";
import type {
  ToolMap,
  MoveResult,
  AttackMoveResult,
  AttackTargetResult,
  BuildStructureResult,
  TrainUnitResult,
  DeployResult,
  RallyPointResult,
  SellResult,
  RepairResult,
} from "../types.js";

describe("Order Tools", () => {
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
    registerOrderTools(tools, ipc);
  });

  afterAll(async () => {
    ipc.disconnect();
    await mockServer.close();
  });

  it("should register all 9 order tools", () => {
    const expected = [
      "move_units",
      "attack_move",
      "attack_target",
      "build_structure",
      "train_unit",
      "deploy_unit",
      "set_rally_point",
      "sell_building",
      "repair_building",
    ];
    for (const name of expected) {
      expect(tools.has(name), `Missing tool: ${name}`).toBe(true);
    }
  });

  describe("move_units", () => {
    it("should move units to a position", async () => {
      const handler = tools.get("move_units")!.handler;
      const result = (await handler({
        unit_ids: [10, 11],
        target: [60, 40],
      })) as MoveResult;

      expect(result.success).toBe(true);
      expect(result.units_moved).toBe(2);
      expect(result.target).toEqual([60, 40]);
      expect(result.estimated_arrival_ticks).toBeGreaterThan(0);
    });

    it("should reject missing required params", async () => {
      const handler = tools.get("move_units")!.handler;
      await expect(handler({})).rejects.toThrow();
    });

    it("should reject empty unit_ids", async () => {
      const handler = tools.get("move_units")!.handler;
      await expect(
        handler({ unit_ids: [], target: [60, 40] })
      ).rejects.toThrow();
    });
  });

  describe("attack_move", () => {
    it("should attack-move units", async () => {
      const handler = tools.get("attack_move")!.handler;
      const result = (await handler({
        unit_ids: [10, 11],
        target: [80, 70],
      })) as AttackMoveResult;

      expect(result.success).toBe(true);
      expect(result.units_ordered).toBe(2);
    });
  });

  describe("attack_target", () => {
    it("should focus fire on a target", async () => {
      const handler = tools.get("attack_target")!.handler;
      const result = (await handler({
        unit_ids: [10, 11],
        target_id: 200,
      })) as AttackTargetResult;

      expect(result.success).toBe(true);
      expect(result.attackers).toBe(2);
    });
  });

  describe("build_structure", () => {
    it("should queue a building", async () => {
      const handler = tools.get("build_structure")!.handler;
      const result = (await handler({
        type: "powr",
        position: [43, 34],
      })) as BuildStructureResult;

      expect(result.success).toBe(true);
      expect(result.cost).toBe(300);
    });

    it("should work without position (auto-place)", async () => {
      const handler = tools.get("build_structure")!.handler;
      const result = (await handler({ type: "powr" })) as BuildStructureResult;
      expect(result.success).toBe(true);
    });
  });

  describe("train_unit", () => {
    it("should queue unit production", async () => {
      const handler = tools.get("train_unit")!.handler;
      const result = (await handler({
        type: "2tnk",
        count: 3,
      })) as TrainUnitResult;

      expect(result.success).toBe(true);
    });

    it("should default to count=1", async () => {
      const handler = tools.get("train_unit")!.handler;
      const result = (await handler({ type: "e1" })) as TrainUnitResult;
      expect(result.success).toBe(true);
    });
  });

  describe("deploy_unit", () => {
    it("should deploy MCV", async () => {
      const handler = tools.get("deploy_unit")!.handler;
      const result = (await handler({
        unit_id: 1,
      })) as DeployResult;

      expect(result.success).toBe(true);
      expect(result.deployed_as).toBe("fact");
    });
  });

  describe("set_rally_point", () => {
    it("should set rally point", async () => {
      const handler = tools.get("set_rally_point")!.handler;
      const result = (await handler({
        building_id: 103,
        position: [55, 40],
      })) as RallyPointResult;

      expect(result.success).toBe(true);
      expect(result.building).toBe("weap");
    });
  });

  describe("sell_building", () => {
    it("should sell a building", async () => {
      const handler = tools.get("sell_building")!.handler;
      const result = (await handler({
        building_id: 101,
      })) as SellResult;

      expect(result.success).toBe(true);
      expect(result.refund_estimate).toBeGreaterThan(0);
    });
  });

  describe("repair_building", () => {
    it("should toggle repair", async () => {
      const handler = tools.get("repair_building")!.handler;
      const result = (await handler({
        building_id: 103,
      })) as RepairResult;

      expect(result.success).toBe(true);
      expect(result.repairing).toBe(true);
    });
  });
});
