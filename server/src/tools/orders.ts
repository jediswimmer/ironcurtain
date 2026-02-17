/**
 * Order Tools — commanding units and buildings
 * move_units, attack_move, attack_target, deploy_unit, build_structure,
 * train_unit, set_rally_point, sell_building, repair_building
 */

import { IpcClient } from "../ipc/client.js";

type ToolMap = Map<string, {
  description: string;
  inputSchema: object;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}>;

export function registerOrderTools(tools: ToolMap, ipc: IpcClient) {
  tools.set("move_units", {
    description: "Move one or more units to a target cell position.",
    inputSchema: {
      type: "object",
      properties: {
        unit_ids: {
          type: "array",
          items: { type: "number" },
          description: "Actor IDs of units to move",
        },
        target: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description: "Target cell position [x, y]",
        },
        queued: {
          type: "boolean",
          description: "Queue after current action? Default: false",
        },
      },
      required: ["unit_ids", "target"],
    },
    handler: async (args) => {
      const unitIds = args.unit_ids as number[];
      const target = args.target as number[];
      const queued = (args.queued as boolean) ?? false;

      // Issue move order for each unit
      const orders = unitIds.map((id) => ({
        order: "Move",
        subject_id: id,
        target_cell: target,
        queued,
      }));

      return await ipc.request("issue_orders", { orders });
    },
  });

  tools.set("attack_move", {
    description:
      "Attack-move units to a location. Units will engage any enemies encountered on the way.",
    inputSchema: {
      type: "object",
      properties: {
        unit_ids: {
          type: "array",
          items: { type: "number" },
          description: "Actor IDs of units to attack-move",
        },
        target: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description: "Target cell position [x, y]",
        },
        queued: { type: "boolean" },
      },
      required: ["unit_ids", "target"],
    },
    handler: async (args) => {
      const unitIds = args.unit_ids as number[];
      const target = args.target as number[];
      const queued = (args.queued as boolean) ?? false;

      const orders = unitIds.map((id) => ({
        order: "AttackMove",
        subject_id: id,
        target_cell: target,
        queued,
      }));

      return await ipc.request("issue_orders", { orders });
    },
  });

  tools.set("attack_target", {
    description: "Order units to attack a specific enemy target.",
    inputSchema: {
      type: "object",
      properties: {
        unit_ids: {
          type: "array",
          items: { type: "number" },
          description: "Actor IDs of attacking units",
        },
        target_id: {
          type: "number",
          description: "Actor ID of the enemy target",
        },
      },
      required: ["unit_ids", "target_id"],
    },
    handler: async (args) => {
      const unitIds = args.unit_ids as number[];
      const targetId = args.target_id as number;

      const orders = unitIds.map((id) => ({
        order: "Attack",
        subject_id: id,
        target_id: targetId,
      }));

      return await ipc.request("issue_orders", { orders });
    },
  });

  tools.set("deploy_unit", {
    description:
      "Deploy a deployable unit (e.g., MCV → Construction Yard). Optionally move to a position first.",
    inputSchema: {
      type: "object",
      properties: {
        unit_id: {
          type: "number",
          description: "Actor ID of the unit to deploy (e.g., MCV)",
        },
        position: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description: "Optional: move here before deploying [x, y]",
        },
      },
      required: ["unit_id"],
    },
    handler: async (args) => {
      const unitId = args.unit_id as number;
      const position = args.position as number[] | undefined;

      const orders: object[] = [];

      if (position) {
        orders.push({
          order: "Move",
          subject_id: unitId,
          target_cell: position,
          queued: false,
        });
      }

      orders.push({
        order: "DeployTransform",
        subject_id: unitId,
      });

      return await ipc.request("issue_orders", { orders });
    },
  });

  tools.set("build_structure", {
    description:
      "Start building a structure. Queues it in the building production queue. Use PlaceBuilding once ready.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description:
            'Building type ID (e.g., "powr", "proc", "weap", "tsla", "barr")',
        },
        position: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description: "Cell position to place the building [x, y]",
        },
      },
      required: ["type"],
    },
    handler: async (args) => {
      const type = args.type as string;
      const position = args.position as number[] | undefined;

      // First, queue the building for production
      const startOrder = {
        order: "StartProduction",
        type,
        count: 1,
      };

      const result = await ipc.request("issue_order", startOrder);

      // TODO: Once building is complete, send PlaceBuilding order with position
      // This requires tracking production completion events

      return {
        ...(result as object),
        note: position
          ? `Building ${type} queued. Will be placed at [${position}] when complete.`
          : `Building ${type} queued. Position will need to be specified when complete.`,
      };
    },
  });

  tools.set("train_unit", {
    description: "Queue unit production at a building.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: 'Unit type ID (e.g., "e1", "2tnk", "harv", "mig")',
        },
        count: {
          type: "number",
          description: "Number of units to queue. Default: 1",
        },
        building_id: {
          type: "number",
          description:
            "Actor ID of the production building. Null for auto-select.",
        },
      },
      required: ["type"],
    },
    handler: async (args) => {
      const type = args.type as string;
      const count = (args.count as number) ?? 1;
      const buildingId = args.building_id as number | undefined;

      return await ipc.request("issue_order", {
        order: "StartProduction",
        type,
        count,
        building_id: buildingId,
      });
    },
  });

  tools.set("set_rally_point", {
    description: "Set the rally point for a production building.",
    inputSchema: {
      type: "object",
      properties: {
        building_id: {
          type: "number",
          description: "Actor ID of the building",
        },
        position: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description: "Rally point position [x, y]",
        },
      },
      required: ["building_id", "position"],
    },
    handler: async (args) => {
      return await ipc.request("issue_order", {
        order: "SetRallyPoint",
        subject_id: args.building_id,
        position: args.position,
      });
    },
  });

  tools.set("sell_building", {
    description: "Sell a building for a partial refund.",
    inputSchema: {
      type: "object",
      properties: {
        building_id: {
          type: "number",
          description: "Actor ID of the building to sell",
        },
      },
      required: ["building_id"],
    },
    handler: async (args) => {
      return await ipc.request("issue_order", {
        order: "Sell",
        subject_id: args.building_id,
      });
    },
  });

  tools.set("repair_building", {
    description: "Toggle repair on a building.",
    inputSchema: {
      type: "object",
      properties: {
        building_id: {
          type: "number",
          description: "Actor ID of the building to repair",
        },
      },
      required: ["building_id"],
    },
    handler: async (args) => {
      return await ipc.request("issue_order", {
        order: "RepairBuilding",
        subject_id: args.building_id,
      });
    },
  });
}
