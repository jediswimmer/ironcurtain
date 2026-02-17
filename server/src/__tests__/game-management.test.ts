/**
 * Tests for Game Management tools (game_status, game_settings)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { IpcClient } from "../ipc/client.js";
import { registerGameManagementTools } from "../tools/game-management.js";
import { startMockIpcServer, type MockIpcServer } from "./mock-ipc-server.js";
import type { ToolMap, GameStatus, GameSettings } from "../types.js";

describe("Game Management Tools", () => {
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
    registerGameManagementTools(tools, ipc);
  });

  afterAll(async () => {
    ipc.disconnect();
    await mockServer.close();
  });

  it("should register game_status and game_settings tools", () => {
    expect(tools.has("game_status")).toBe(true);
    expect(tools.has("game_settings")).toBe(true);
  });

  it("game_status should return game phase and stats", async () => {
    const handler = tools.get("game_status")!.handler;
    const result = (await handler({})) as GameStatus;

    expect(result.phase).toBe("playing");
    expect(result.tick).toBe(15000);
    expect(result.our_faction).toBe("soviet");
    expect(result.our_credits).toBe(5420);
    expect(result.unit_count).toBe(12);
    expect(result.building_count).toBe(8);
    expect(result.power.current).toBe(300);
    expect(result.power.drain).toBe(250);
    expect(result.kill_count).toBe(7);
    expect(result.loss_count).toBe(3);
    expect(result.players).toHaveLength(2);
  });

  it("game_settings should return match configuration", async () => {
    const handler = tools.get("game_settings")!.handler;
    const result = (await handler({})) as GameSettings;

    expect(result.game_id).toBe("match-001");
    expect(result.map_name).toBe("Ore Lord");
    expect(result.map_size).toEqual([128, 128]);
    expect(result.fog_of_war).toBe(true);
    expect(result.starting_cash).toBe(10000);
    expect(result.players).toHaveLength(2);
  });

  it("tools should have proper descriptions", () => {
    const status = tools.get("game_status")!;
    expect(status.description).toContain("game status");
    expect(status.description.length).toBeGreaterThan(20);

    const settings = tools.get("game_settings")!;
    expect(settings.description).toContain("match settings");
  });

  it("tools should have JSON Schema input schemas", () => {
    const status = tools.get("game_status")!;
    expect(status.inputSchema).toHaveProperty("type", "object");

    const settings = tools.get("game_settings")!;
    expect(settings.inputSchema).toHaveProperty("type", "object");
  });
});
