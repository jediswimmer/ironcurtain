#!/usr/bin/env node

/**
 * Iron Curtain
 * 
 * Bridges Claude's MCP tool calls to the OpenRA ExternalBot via IPC.
 * 
 * Architecture:
 *   Claude (OpenClaw) → MCP Server (this) → Unix Socket → ExternalBot (OpenRA mod)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { IpcClient } from "./ipc/client.js";
import { registerGameManagementTools } from "./tools/game-management.js";
import { registerIntelligenceTools } from "./tools/intelligence.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerStrategyTools } from "./tools/strategy.js";

const server = new Server(
  {
    name: "iron-curtain-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// IPC client connects to ExternalBot inside OpenRA
const ipcClient = new IpcClient("/tmp/openra-mcp.sock", 18642);

// Tool definitions
const tools: Map<string, {
  description: string;
  inputSchema: object;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}> = new Map();

// Register all tool categories
registerGameManagementTools(tools, ipcClient);
registerIntelligenceTools(tools, ipcClient);
registerOrderTools(tools, ipcClient);
registerStrategyTools(tools, ipcClient);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Array.from(tools.entries()).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema as any,
  })),
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = tools.get(name);

  if (!tool) {
    return {
      content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
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
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Iron Curtain Server started — awaiting tool calls from Claude");
  
  // Connect to OpenRA ExternalBot
  try {
    await ipcClient.connect();
    console.error("Connected to OpenRA ExternalBot via IPC");
  } catch {
    console.error("Warning: Could not connect to OpenRA ExternalBot. Game may not be running yet.");
  }
}

main().catch(console.error);
