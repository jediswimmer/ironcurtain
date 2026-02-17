#!/usr/bin/env node

/**
 * IronCurtain MCP Server
 *
 * The bridge between any MCP-compatible AI agent (OpenClaw, Claude, etc.)
 * and the OpenRA game engine. Exposes game commands as MCP tools, translates
 * them to IPC messages, and sends them to the OpenRA ExternalBot mod.
 *
 * Architecture:
 *   AI Agent → MCP (stdio) → This Server → TCP/Unix Socket → ExternalBot (OpenRA)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { IpcClient } from "./ipc/client.js";
import { registerGameManagementTools } from "./tools/game-management.js";
import { registerIntelligenceTools } from "./tools/intelligence.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerStrategyTools } from "./tools/strategy.js";
import type { ToolMap, ToolDefinition } from "./types.js";

// ─── Server Setup ────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: config.serverName,
    version: config.serverVersion,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ─── IPC Client ──────────────────────────────────────────────────────────────

const ipcClient = new IpcClient(config);

ipcClient.on("connected", () => {
  console.error("[IronCurtain] Connected to OpenRA ExternalBot");
});

ipcClient.on("disconnected", () => {
  console.error("[IronCurtain] Disconnected from OpenRA ExternalBot");
});

ipcClient.on("reconnected", () => {
  console.error("[IronCurtain] Reconnected to OpenRA ExternalBot");
});

ipcClient.on("reconnect_failed", () => {
  console.error("[IronCurtain] Failed to reconnect after maximum attempts");
});

ipcClient.on("game_event", (event: { event: string; data: Record<string, unknown> }) => {
  console.error(`[IronCurtain] Game event: ${event.event}`);
});

// ─── Tool Registry ───────────────────────────────────────────────────────────

const tools: ToolMap = new Map();

registerGameManagementTools(tools, ipcClient);
registerIntelligenceTools(tools, ipcClient);
registerOrderTools(tools, ipcClient);
registerStrategyTools(tools, ipcClient);

console.error(`[IronCurtain] Registered ${tools.size} tools`);

// ─── MCP Handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Array.from(tools.entries()).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool: ToolDefinition | undefined = tools.get(name);

  if (!tool) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: `Unknown tool: ${name}`, available_tools: Array.from(tools.keys()) }),
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await tool.handler(args ?? {});
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);

    // Provide helpful context for common errors
    let hint = "";
    if (message.includes("Not connected")) {
      hint =
        " Hint: The OpenRA game may not be running yet. Start a game with the ExternalBot selected.";
    } else if (message.includes("timed out")) {
      hint =
        " Hint: The ExternalBot may be unresponsive. Check if the game is still running.";
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: message + hint, tool: name }),
        },
      ],
      isError: true,
    };
  }
});

// ─── Startup ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Start MCP server on stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[IronCurtain] MCP server started on stdio — awaiting tool calls");

  // Attempt IPC connection (non-blocking — game may not be running yet)
  try {
    await ipcClient.connect();
  } catch {
    console.error(
      "[IronCurtain] Could not connect to ExternalBot — game not running yet. Will auto-reconnect when available."
    );
  }

  // Graceful shutdown
  const shutdown = (): void => {
    console.error("[IronCurtain] Shutting down...");
    ipcClient.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error("[IronCurtain] Fatal error:", err);
  process.exit(1);
});
