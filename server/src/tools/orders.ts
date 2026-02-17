/**
 * Order Tools — Commanding Units and Buildings
 *
 * These tools issue commands to the game via IPC → ExternalBot → OpenRA Order system.
 *   - move_units      — Move unit(s) to a map position
 *   - attack_move     — Attack-move to position (engage enemies en route)
 *   - attack_target   — Focus fire on a specific enemy actor
 *   - build_structure — Queue a building for production and place it
 *   - train_unit      — Queue unit production at a building
 *   - deploy_unit     — Deploy MCV or other deployable unit
 *   - set_rally_point — Set rally point for a production building
 *   - sell_building   — Sell a structure for partial refund
 *   - repair_building — Toggle repair on a building
 */

import { z } from "zod";
import type { IpcClient } from "../ipc/client.js";
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
  IpcMoveOrder,
  IpcAttackMoveOrder,
  IpcAttackOrder,
  OrderResult,
} from "../types.js";
import { zodToJsonSchema } from "../util/schema.js";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const CellPositionSchema = z
  .tuple([z.number(), z.number()])
  .describe("Cell position on the map as [x, y]");

const MoveUnitsInputSchema = z.object({
  unit_ids: z
    .array(z.number())
    .min(1)
    .describe("Actor IDs of units to move. Get IDs from get_units."),
  target: CellPositionSchema.describe("Target cell position [x, y] to move to."),
  queued: z
    .boolean()
    .optional()
    .describe("If true, queue this order after the unit's current action. Default: false."),
});

const AttackMoveInputSchema = z.object({
  unit_ids: z
    .array(z.number())
    .min(1)
    .describe("Actor IDs of units to attack-move."),
  target: CellPositionSchema.describe("Target cell position [x, y]. Units will engage enemies encountered en route."),
  queued: z.boolean().optional().describe("Queue after current action? Default: false."),
});

const AttackTargetInputSchema = z.object({
  unit_ids: z
    .array(z.number())
    .min(1)
    .describe("Actor IDs of units that should attack."),
  target_id: z
    .number()
    .describe("Actor ID of the enemy unit or building to focus fire on. Get IDs from get_enemy_intel."),
  force_attack: z
    .boolean()
    .optional()
    .describe("Force attack even on allied units. Default: false."),
});

const BuildStructureInputSchema = z.object({
  type: z
    .string()
    .describe(
      "Building type ID (e.g., 'powr' for Power Plant, 'proc' for Ore Refinery, 'weap' for War Factory, 'tsla' for Tesla Coil, 'barr' for Barracks). Use get_tech_tree to see available options."
    ),
  position: z
    .tuple([z.number(), z.number()])
    .optional()
    .describe("Cell position [x, y] to place the building. If omitted, auto-placement is attempted."),
});

const TrainUnitInputSchema = z.object({
  type: z
    .string()
    .describe(
      "Unit type ID (e.g., 'e1' for Rifle Infantry, '2tnk' for Heavy Tank, 'harv' for Ore Harvester, 'mig' for MiG). Use get_tech_tree to see available options."
    ),
  count: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Number of units to queue. Default: 1. Max: 10."),
  building_id: z
    .number()
    .optional()
    .describe("Actor ID of the production building. If omitted, auto-selects the best available producer."),
});

const DeployUnitInputSchema = z.object({
  unit_id: z
    .number()
    .describe("Actor ID of the unit to deploy (e.g., MCV). Get IDs from get_units."),
  position: z
    .tuple([z.number(), z.number()])
    .optional()
    .describe("Move to this position before deploying [x, y]. If omitted, deploys in place."),
});

const SetRallyPointInputSchema = z.object({
  building_id: z
    .number()
    .describe("Actor ID of the production building. Get IDs from get_buildings."),
  position: CellPositionSchema.describe("Rally point position [x, y]. New units will move here after production."),
});

const SellBuildingInputSchema = z.object({
  building_id: z
    .number()
    .describe("Actor ID of the building to sell. You get a partial refund (~50%). Get IDs from get_buildings."),
});

const RepairBuildingInputSchema = z.object({
  building_id: z
    .number()
    .describe("Actor ID of the building to repair. Costs credits over time. Get IDs from get_buildings."),
  enable: z
    .boolean()
    .optional()
    .describe("true to start repairing, false to stop. Toggles if omitted."),
});

// ─── Registration ────────────────────────────────────────────────────────────

export function registerOrderTools(tools: ToolMap, ipc: IpcClient): void {
  tools.set("move_units", {
    description: [
      "Move one or more units to a target cell position.",
      "Units will path-find around obstacles. Use 'queued' to chain movements.",
      "Returns the number of units that received the order and estimated arrival time.",
    ].join(" "),
    inputSchema: zodToJsonSchema(MoveUnitsInputSchema),
    async handler(args: Record<string, unknown>): Promise<MoveResult> {
      const parsed = MoveUnitsInputSchema.parse(args);
      const orders: IpcMoveOrder[] = parsed.unit_ids.map((id) => ({
        order: "Move" as const,
        subject_id: id,
        target_cell: [parsed.target[0], parsed.target[1]] as const,
        queued: parsed.queued ?? false,
      }));
      return ipc.request<MoveResult>("issue_orders", { orders });
    },
  });

  tools.set("attack_move", {
    description: [
      "Attack-move units to a location. Units will engage any enemies encountered",
      "along the way, then continue to the target. Best for advancing an army",
      "through contested territory. Units won't just walk past enemies.",
    ].join(" "),
    inputSchema: zodToJsonSchema(AttackMoveInputSchema),
    async handler(args: Record<string, unknown>): Promise<AttackMoveResult> {
      const parsed = AttackMoveInputSchema.parse(args);
      const orders: IpcAttackMoveOrder[] = parsed.unit_ids.map((id) => ({
        order: "AttackMove" as const,
        subject_id: id,
        target_cell: [parsed.target[0], parsed.target[1]] as const,
        queued: parsed.queued ?? false,
      }));
      return ipc.request<AttackMoveResult>("issue_orders", { orders });
    },
  });

  tools.set("attack_target", {
    description: [
      "Order units to focus fire on a specific enemy unit or building.",
      "All specified units will attack the same target — essential for",
      "taking down high-value targets quickly (enemy harvesters, production buildings, etc.).",
    ].join(" "),
    inputSchema: zodToJsonSchema(AttackTargetInputSchema),
    async handler(args: Record<string, unknown>): Promise<AttackTargetResult> {
      const parsed = AttackTargetInputSchema.parse(args);
      const orders: IpcAttackOrder[] = parsed.unit_ids.map((id) => ({
        order: "Attack" as const,
        subject_id: id,
        target_id: parsed.target_id,
      }));
      return ipc.request<AttackTargetResult>("issue_orders", {
        orders,
        force_attack: parsed.force_attack ?? false,
      });
    },
  });

  tools.set("build_structure", {
    description: [
      "Start building a structure. This queues it in the construction yard's",
      "production queue. When construction completes, it will be placed at the",
      "specified position (or auto-placed if no position given).",
      "Requires a Construction Yard. Check get_tech_tree for available buildings.",
      "Building costs credits — check get_resources first.",
    ].join(" "),
    inputSchema: zodToJsonSchema(BuildStructureInputSchema),
    async handler(args: Record<string, unknown>): Promise<BuildStructureResult> {
      const parsed = BuildStructureInputSchema.parse(args);
      const params: Record<string, unknown> = {
        order: "StartProduction",
        type: parsed.type,
        count: 1,
      };
      if (parsed.position) {
        params.placement_position = [parsed.position[0], parsed.position[1]];
      }
      return ipc.request<BuildStructureResult>("issue_order", params);
    },
  });

  tools.set("train_unit", {
    description: [
      "Queue unit production at a factory/barracks. The unit will be produced",
      "and appear at the building's rally point. You can queue multiple units at once.",
      "Requires the appropriate production building (e.g., War Factory for tanks,",
      "Barracks for infantry). Check get_tech_tree for available units.",
    ].join(" "),
    inputSchema: zodToJsonSchema(TrainUnitInputSchema),
    async handler(args: Record<string, unknown>): Promise<TrainUnitResult> {
      const parsed = TrainUnitInputSchema.parse(args);
      return ipc.request<TrainUnitResult>("issue_order", {
        order: "StartProduction",
        type: parsed.type,
        count: parsed.count ?? 1,
        building_id: parsed.building_id,
      });
    },
  });

  tools.set("deploy_unit", {
    description: [
      "Deploy a deployable unit — most importantly, deploy your MCV into a",
      "Construction Yard at the start of the game. Can also deploy other",
      "deployable units. If a position is specified, the unit moves there first.",
    ].join(" "),
    inputSchema: zodToJsonSchema(DeployUnitInputSchema),
    async handler(args: Record<string, unknown>): Promise<DeployResult> {
      const parsed = DeployUnitInputSchema.parse(args);
      const orders: Record<string, unknown>[] = [];

      if (parsed.position) {
        orders.push({
          order: "Move",
          subject_id: parsed.unit_id,
          target_cell: [parsed.position[0], parsed.position[1]],
          queued: false,
        });
      }

      orders.push({
        order: "DeployTransform",
        subject_id: parsed.unit_id,
      });

      return ipc.request<DeployResult>("issue_orders", { orders });
    },
  });

  tools.set("set_rally_point", {
    description: [
      "Set the rally point for a production building. Newly produced units",
      "will automatically move to this position. Essential for directing",
      "fresh units to defensive positions or staging areas.",
    ].join(" "),
    inputSchema: zodToJsonSchema(SetRallyPointInputSchema),
    async handler(args: Record<string, unknown>): Promise<RallyPointResult> {
      const parsed = SetRallyPointInputSchema.parse(args);
      return ipc.request<RallyPointResult>("issue_order", {
        order: "SetRallyPoint",
        subject_id: parsed.building_id,
        position: [parsed.position[0], parsed.position[1]],
      });
    },
  });

  tools.set("sell_building", {
    description: [
      "Sell a building for a partial credit refund (~50% of build cost).",
      "The building is destroyed and the credits are returned. Use this",
      "to recoup funds from buildings you no longer need, or to sell a",
      "damaged building before the enemy destroys it (you get no refund from destruction).",
    ].join(" "),
    inputSchema: zodToJsonSchema(SellBuildingInputSchema),
    async handler(args: Record<string, unknown>): Promise<SellResult> {
      const parsed = SellBuildingInputSchema.parse(args);
      return ipc.request<SellResult>("issue_order", {
        order: "Sell",
        subject_id: parsed.building_id,
      });
    },
  });

  tools.set("repair_building", {
    description: [
      "Toggle repair on a damaged building. Repairing costs credits over time",
      "but restores the building to full health. Cancel repair to save money",
      "if funds are low. Only works on buildings you own.",
    ].join(" "),
    inputSchema: zodToJsonSchema(RepairBuildingInputSchema),
    async handler(args: Record<string, unknown>): Promise<RepairResult> {
      const parsed = RepairBuildingInputSchema.parse(args);
      const params: Record<string, unknown> = {
        order: "RepairBuilding",
        subject_id: parsed.building_id,
      };
      if (parsed.enable !== undefined) {
        params.enable = parsed.enable;
      }
      return ipc.request<RepairResult>("issue_order", params);
    },
  });
}
