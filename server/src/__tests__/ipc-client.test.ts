/**
 * Tests for the IPC Client — connection, request/response, error handling
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { IpcClient } from "../ipc/client.js";
import { startMockIpcServer, type MockIpcServer } from "./mock-ipc-server.js";

describe("IPC Client", () => {
  let mockServer: MockIpcServer;

  beforeAll(async () => {
    mockServer = await startMockIpcServer(0);
  });

  afterAll(async () => {
    await mockServer.close();
  });

  function createClient(overrides: Record<string, unknown> = {}): IpcClient {
    return new IpcClient({
      ipcSocketPath: "/tmp/nonexistent.sock",
      ipcHost: "127.0.0.1",
      ipcPort: mockServer.port,
      ipcTimeoutMs: 5000,
      ipcMaxReconnectAttempts: 0,
      ipcReconnectBaseDelayMs: 100,
      serverName: "test",
      serverVersion: "0.0.0",
      verbose: false,
      ...overrides,
    });
  }

  it("should connect to the mock server via TCP", async () => {
    const client = createClient();
    await client.connect();
    expect(client.isConnected).toBe(true);
    client.disconnect();
    expect(client.isConnected).toBe(false);
  });

  it("should send requests and receive responses", async () => {
    const client = createClient();
    await client.connect();

    const result = await client.request<{ phase: string }>("get_state");
    expect(result.phase).toBe("playing");

    client.disconnect();
  });

  it("should handle multiple concurrent requests", async () => {
    const client = createClient();
    await client.connect();

    const [state, units, resources] = await Promise.all([
      client.request<{ phase: string }>("get_state"),
      client.request<{ units: unknown[] }>("get_units", {}),
      client.request<{ credits: number }>("get_resources"),
    ]);

    expect(state.phase).toBe("playing");
    expect(units.units.length).toBeGreaterThan(0);
    expect(resources.credits).toBe(5420);

    client.disconnect();
  });

  it("should throw when requesting while disconnected", async () => {
    const client = createClient();
    // Don't connect
    await expect(client.request("get_state")).rejects.toThrow("Not connected");
  });

  it("should throw on unknown methods", async () => {
    const client = createClient();
    await client.connect();

    await expect(client.request("nonexistent_method")).rejects.toThrow(
      "Unknown method"
    );

    client.disconnect();
  });

  it("should fail to connect to unreachable host", async () => {
    const client = createClient({ ipcPort: 1 }); // Port 1 should fail
    await expect(client.connect()).rejects.toThrow();
    expect(client.isConnected).toBe(false);
  });
});
