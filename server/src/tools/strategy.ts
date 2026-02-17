/**
 * Strategy Tools — Higher-Level Convenience Tools
 *
 * These tools combine multiple lower-level operations or provide
 * strategic analysis for smarter AI decision-making.
 *   - get_build_options    — What structures/units are available now
 *   - get_production_queue — All active production across all buildings
 *   - scout_area           — Auto-select fastest unit and send to explore
 */

import { z } from "zod";
import type { IpcClient } from "../ipc/client.js";
import type {
  ToolMap,
  BuildOptionsResponse,
  ProductionQueueResponse,
  ScoutResult,
  UnitsResponse,
  UnitInfo,
} from "../types.js";
import { zodToJsonSchema } from "../util/schema.js";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const GetBuildOptionsInputSchema = z.object({
  category: z
    .enum(["building", "vehicle", "infantry", "aircraft", "naval", "all"])
    .optional()
    .describe(
      "Filter by production category. 'all' returns everything. Default: all."
    ),
});

const GetProductionQueueInputSchema = z.object({}).strict();

const ScoutAreaInputSchema = z.object({
  target: z
    .tuple([z.number(), z.number()])
    .describe(
      "Cell position [x, y] to scout. Pick unexplored areas, likely enemy base locations, or expansion points."
    ),
  unit_id: z
    .number()
    .optional()
    .describe(
      "Specific unit actor ID to send as scout. If omitted, auto-selects the fastest available idle unit (dogs > light vehicles > infantry)."
    ),
  return_after: z
    .boolean()
    .optional()
    .describe("If true, the scout will return to base after reaching the target. Default: false."),
});

// ─── Scout Unit Priority ─────────────────────────────────────────────────────

/** Unit types in order of scouting preference (fastest/cheapest first) */
const SCOUT_PRIORITY: readonly string[] = [
  "dog",  // Attack Dog — fastest ground unit
  "jeep", // Ranger — fast, armed
  "apc",  // APC — fast, armored
  "1tnk", // Light Tank — decent speed
  "e1",   // Rifle Infantry — slow but expendable
  "e2",   // Grenadier — similar
  "e3",   // Rocket Soldier — similar
];

/**
 * Pick the best scout from available idle units.
 * Priority: dogs > jeeps > APCs > light tanks > infantry
 */
function selectBestScout(units: readonly UnitInfo[]): UnitInfo | null {
  const idle = units.filter((u) => u.status === "idle" && u.can_move);

  for (const type of SCOUT_PRIORITY) {
    const found = idle.find((u) => u.type === type);
    if (found) return found;
  }

  // Fallback: any idle mobile unit
  return idle.length > 0 ? idle[0] : null;
}

function speedCategory(type: string): string {
  if (type === "dog") return "very fast";
  if (["jeep", "apc", "1tnk"].includes(type)) return "fast";
  if (["2tnk", "3tnk", "4tnk"].includes(type)) return "moderate";
  return "slow";
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerStrategyTools(tools: ToolMap, ipc: IpcClient): void {
  tools.set("get_build_options", {
    description: [
      "Get all buildings and units that can currently be produced, based on your",
      "tech tree state, completed prerequisites, and available funds. Each item shows:",
      "type ID, display name, cost, build time, whether prerequisites are met,",
      "whether you can afford it, the prerequisite chain, and which building produces it.",
      "Use this to plan your build order and tech path. Filter by category to focus",
      "on buildings, vehicles, infantry, aircraft, or naval units.",
    ].join(" "),
    inputSchema: zodToJsonSchema(GetBuildOptionsInputSchema),
    async handler(args: Record<string, unknown>): Promise<BuildOptionsResponse> {
      const parsed = GetBuildOptionsInputSchema.parse(args);
      const params: Record<string, unknown> = {};
      if (parsed.category) params.category = parsed.category;
      return ipc.request<BuildOptionsResponse>("get_build_options", params);
    },
  });

  tools.set("get_production_queue", {
    description: [
      "Get the current production state across ALL production buildings.",
      "Shows the building construction queue (structures being built by the ConYard)",
      "and all unit production queues (what each barracks/factory is producing).",
      "Each item shows: type, display name, progress percentage, paused state,",
      "remaining ticks, cost, and cost remaining. Essential for tracking what's cooking.",
    ].join(" "),
    inputSchema: zodToJsonSchema(GetProductionQueueInputSchema),
    async handler(_args: Record<string, unknown>): Promise<ProductionQueueResponse> {
      return ipc.request<ProductionQueueResponse>("get_production_queue");
    },
  });

  tools.set("scout_area", {
    description: [
      "Send a unit to explore an area of the map. If no unit_id is specified,",
      "auto-selects the fastest available idle unit (dogs > jeeps > APCs > tanks > infantry).",
      "Scouting is CRITICAL — you can only see what your units can see (fog of war).",
      "Scout early and often: find the enemy base, locate ore fields, watch for attacks.",
      "Returns info about which unit was sent and estimated arrival time.",
    ].join(" "),
    inputSchema: zodToJsonSchema(ScoutAreaInputSchema),
    async handler(args: Record<string, unknown>): Promise<ScoutResult> {
      const parsed = ScoutAreaInputSchema.parse(args);
      const target: [number, number] = [parsed.target[0], parsed.target[1]];

      // If a specific unit was requested, just send it
      if (parsed.unit_id !== undefined) {
        const result = await ipc.request<ScoutResult>("issue_order", {
          order: "Move",
          subject_id: parsed.unit_id,
          target_cell: target,
        });
        return {
          ...result,
          target,
        };
      }

      // Auto-select: get all units and pick the best scout
      const unitsResponse = await ipc.request<UnitsResponse>("get_units", {
        filter_status: "idle",
      });

      const scout = selectBestScout(unitsResponse.units);

      if (!scout) {
        return {
          success: false,
          error: "No available idle units to scout with. Build a dog or infantry unit first.",
          scout: null,
          target,
          estimated_arrival: 0,
        };
      }

      const moveResult = await ipc.request<ScoutResult>("issue_order", {
        order: "Move",
        subject_id: scout.id,
        target_cell: target,
      });

      return {
        success: true,
        scout: {
          id: scout.id,
          type: scout.type,
          speed: speedCategory(scout.type),
        },
        target,
        estimated_arrival: moveResult.estimated_arrival ?? 0,
        message: `Sent ${scout.display_name} (${scout.type}) to scout [${target[0]}, ${target[1]}]`,
      };
    },
  });
}
