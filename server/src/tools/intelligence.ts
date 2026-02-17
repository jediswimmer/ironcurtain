/**
 * Intelligence Tools — reading game state
 * get_units, get_buildings, get_resources, get_enemy_intel, map_info, get_minimap
 */

import { IpcClient } from "../ipc/client.js";

type ToolMap = Map<string, {
  description: string;
  inputSchema: object;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}>;

export function registerIntelligenceTools(tools: ToolMap, ipc: IpcClient) {
  tools.set("get_units", {
    description:
      "List all own units with type, position, health, and status. Can filter by type, status, or area.",
    inputSchema: {
      type: "object",
      properties: {
        filter_type: {
          type: "string",
          description: "Filter by unit type (e.g., '2tnk', 'e1')",
        },
        filter_status: {
          type: "string",
          enum: ["idle", "moving", "attacking", "all"],
          description: "Filter by status. Default: all",
        },
      },
    },
    handler: async (args) => {
      return await ipc.request("get_units", args);
    },
  });

  tools.set("get_buildings", {
    description:
      "List all own buildings with type, position, health, production queues, rally points, power info, and repair status.",
    inputSchema: {
      type: "object",
      properties: {
        include_production_info: {
          type: "boolean",
          description: "Include production queue details. Default: true",
        },
      },
    },
    handler: async (args) => {
      return await ipc.request("get_buildings", args);
    },
  });

  tools.set("get_resources", {
    description:
      "Get current resource status: credits, income rate, harvester positions and status, known ore fields, refineries, and silo capacity.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      return await ipc.request("get_resources");
    },
  });

  tools.set("get_enemy_intel", {
    description:
      "Get known enemy units and buildings. ONLY includes what is currently visible or last-known from fog of war. No cheating — respects fog of war.",
    inputSchema: {
      type: "object",
      properties: {
        include_frozen: {
          type: "boolean",
          description: "Include last-known positions from fog of war. Default: true",
        },
      },
    },
    handler: async (args) => {
      return await ipc.request("get_enemy_intel", args);
    },
  });

  tools.set("map_info", {
    description:
      "Get map layout information: name, size, tileset, spawn points, explored percentage, terrain summary, and known ore field locations.",
    inputSchema: {
      type: "object",
      properties: {
        detail: {
          type: "string",
          enum: ["overview", "full"],
          description: "Level of detail. Overview = metadata only. Default: overview",
        },
      },
    },
    handler: async (args) => {
      return await ipc.request("get_map_info", args);
    },
  });

  tools.set("get_minimap", {
    description:
      "Get a simplified text representation of the minimap showing terrain, units, buildings, and resources.",
    inputSchema: {
      type: "object",
      properties: {
        include_units: {
          type: "boolean",
          description: "Show unit positions on minimap. Default: true",
        },
      },
    },
    handler: async (args) => {
      return await ipc.request("get_minimap", args);
    },
  });
}
