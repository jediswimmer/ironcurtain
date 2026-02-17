/**
 * Strategy Tools — higher-level AI assistance
 * scout_area, get_build_options, get_production_queue
 */

import { IpcClient } from "../ipc/client.js";

type ToolMap = Map<string, {
  description: string;
  inputSchema: object;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}>;

export function registerStrategyTools(tools: ToolMap, ipc: IpcClient) {
  tools.set("scout_area", {
    description:
      "Send a fast unit to explore an area. Auto-selects the fastest available idle unit if none specified.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description: "Target area to scout [x, y]",
        },
        unit_id: {
          type: "number",
          description: "Specific unit to send. Null for auto-select.",
        },
      },
      required: ["target"],
    },
    handler: async (args) => {
      const target = args.target as number[];
      const unitId = args.unit_id as number | undefined;

      if (unitId) {
        // Move specific unit to target
        return await ipc.request("issue_order", {
          order: "Move",
          subject_id: unitId,
          target_cell: target,
        });
      }

      // Auto-select: get idle units, pick fastest (dogs > light vehicles > infantry)
      const units = (await ipc.request("get_units", {
        filter_status: "idle",
      })) as any;

      // Priority: dog > jeep/apc > e1/e2
      const scoutPriority = ["dog", "jeep", "apc", "1tnk", "e1"];
      let scout: any = null;

      for (const type of scoutPriority) {
        scout = units?.units?.find((u: any) => u.type === type);
        if (scout) break;
      }

      if (!scout) {
        // Just pick any idle unit
        scout = units?.units?.[0];
      }

      if (!scout) {
        return { success: false, error: "No available units to scout with" };
      }

      return await ipc.request("issue_order", {
        order: "Move",
        subject_id: scout.id,
        target_cell: target,
      });
    },
  });

  tools.set("get_build_options", {
    description:
      "Get all units and buildings that can currently be produced, based on tech tree state, prerequisites, and available funds.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["building", "vehicle", "infantry", "aircraft", "naval", "all"],
          description: "Filter by production category. Default: all",
        },
      },
    },
    handler: async (args) => {
      return await ipc.request("get_build_options", args);
    },
  });

  tools.set("get_production_queue", {
    description:
      "Get the current production queue — what's being built, progress percentage, costs, and remaining time for all active queues.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      return await ipc.request("get_production_queue");
    },
  });
}
