/**
 * Intelligence Tools — Reading Game State
 *
 * Tools for gathering information about the battlefield.
 *   - get_units      — List own units with type, position, health, status
 *   - get_buildings  — List own buildings with production info, power, health
 *   - get_resources  — Credits, harvesters, ore fields, refineries, silos
 *   - get_enemy_intel — Visible enemy forces (fog of war enforced server-side)
 *   - get_map        — Map metadata, terrain, explored area, ore locations
 *   - get_tech_tree  — What can currently be built/trained
 */

import { z } from "zod";
import type { IpcClient } from "../ipc/client.js";
import type {
  ToolMap,
  UnitsResponse,
  BuildingsResponse,
  ResourcesResponse,
  EnemyIntelResponse,
  MapInfo,
  BuildOptionsResponse,
} from "../types.js";
import { zodToJsonSchema } from "../util/schema.js";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const GetUnitsInputSchema = z.object({
  filter_type: z
    .string()
    .optional()
    .describe("Filter by unit type ID (e.g., '2tnk', 'e1', 'harv'). Omit for all."),
  filter_status: z
    .enum(["idle", "moving", "attacking", "all"])
    .optional()
    .describe("Filter by current activity. Default: all."),
  area: z
    .object({
      x: z.number().describe("Top-left X cell coordinate"),
      y: z.number().describe("Top-left Y cell coordinate"),
      width: z.number().describe("Area width in cells"),
      height: z.number().describe("Area height in cells"),
    })
    .optional()
    .describe("Only return units within this rectangular area."),
});

const GetBuildingsInputSchema = z.object({
  include_production_info: z
    .boolean()
    .optional()
    .describe("Include detailed production queue info for each building. Default: true."),
});

const GetResourcesInputSchema = z.object({}).strict();

const GetEnemyIntelInputSchema = z.object({
  include_frozen: z
    .boolean()
    .optional()
    .describe(
      "Include last-known positions from fog of war (units/buildings seen before but no longer visible). Default: true."
    ),
});

const GetMapInputSchema = z.object({
  detail: z
    .enum(["overview", "full"])
    .optional()
    .describe("'overview' returns metadata only; 'full' includes terrain grid. Default: overview."),
  region: z
    .object({
      x: z.number().describe("Top-left X"),
      y: z.number().describe("Top-left Y"),
      width: z.number().describe("Region width"),
      height: z.number().describe("Region height"),
    })
    .optional()
    .describe("Optional: only return data for this rectangular region."),
});

const GetTechTreeInputSchema = z.object({
  category: z
    .enum(["building", "vehicle", "infantry", "aircraft", "naval", "all"])
    .optional()
    .describe("Filter by production category. Default: all."),
});

// ─── Registration ────────────────────────────────────────────────────────────

export function registerIntelligenceTools(tools: ToolMap, ipc: IpcClient): void {
  tools.set("get_units", {
    description: [
      "List all own units with their type, actor ID, cell position, health (current/max/percent),",
      "current status (idle/moving/attacking), activity description, combat and movement capabilities,",
      "and veterancy level. Includes a total count and a breakdown by unit type.",
      "Use filter_type to narrow to a specific unit (e.g., '2tnk' for Heavy Tanks).",
      "Use filter_status to find idle units for new orders or attacking units to manage.",
    ].join(" "),
    inputSchema: zodToJsonSchema(GetUnitsInputSchema),
    async handler(args: Record<string, unknown>): Promise<UnitsResponse> {
      const parsed = GetUnitsInputSchema.parse(args);
      const params: Record<string, unknown> = {};
      if (parsed.filter_type) params.filter_type = parsed.filter_type;
      if (parsed.filter_status) params.filter_status = parsed.filter_status;
      if (parsed.area) params.area = parsed.area;
      return ipc.request<UnitsResponse>("get_units", params);
    },
  });

  tools.set("get_buildings", {
    description: [
      "List all own buildings with type, actor ID, cell position, health, production queue",
      "(what's being built and progress), rally point, power generated/consumed,",
      "repair status, and whether it's the primary production building.",
      "Also returns a power summary (total generated, total consumed, surplus/deficit).",
      "Essential for managing your base economy and production.",
    ].join(" "),
    inputSchema: zodToJsonSchema(GetBuildingsInputSchema),
    async handler(args: Record<string, unknown>): Promise<BuildingsResponse> {
      const parsed = GetBuildingsInputSchema.parse(args);
      const params: Record<string, unknown> = {};
      if (parsed.include_production_info !== undefined) {
        params.include_production_info = parsed.include_production_info;
      }
      return ipc.request<BuildingsResponse>("get_buildings", params);
    },
  });

  tools.set("get_resources", {
    description: [
      "Get current economic status: total credits, estimated income per minute,",
      "all harvesters (position, status, load, assigned refinery),",
      "known ore fields (location, type, estimated value, distance, threat level),",
      "refineries (position, harvester count), and silo capacity (count, used/total).",
      "Critical for making production decisions — don't spend what you don't have.",
    ].join(" "),
    inputSchema: zodToJsonSchema(GetResourcesInputSchema),
    async handler(_args: Record<string, unknown>): Promise<ResourcesResponse> {
      return ipc.request<ResourcesResponse>("get_resources");
    },
  });

  tools.set("get_enemy_intel", {
    description: [
      "Get intelligence on enemy forces. ONLY returns what is currently visible",
      "or last-known from fog of war — no cheating. Includes visible enemy units",
      "(type, position, health), visible enemy buildings, known enemy base locations,",
      "and an overall threat assessment (army value, building value, estimated strength).",
      "Set include_frozen=true to include last-seen positions from fog (default).",
      "You MUST scout to gain intel. Unexplored areas return nothing.",
    ].join(" "),
    inputSchema: zodToJsonSchema(GetEnemyIntelInputSchema),
    async handler(args: Record<string, unknown>): Promise<EnemyIntelResponse> {
      const parsed = GetEnemyIntelInputSchema.parse(args);
      const params: Record<string, unknown> = {};
      if (parsed.include_frozen !== undefined) {
        params.include_frozen = parsed.include_frozen;
      }
      return ipc.request<EnemyIntelResponse>("get_enemy_intel", params);
    },
  });

  tools.set("get_map", {
    description: [
      "Get map information: name, dimensions, tileset, spawn points,",
      "percentage explored, terrain summary (water/buildable/cliff cell counts),",
      "and known ore field locations. Use detail='full' for the terrain grid",
      "(much larger response). Use region to request only a specific area.",
    ].join(" "),
    inputSchema: zodToJsonSchema(GetMapInputSchema),
    async handler(args: Record<string, unknown>): Promise<MapInfo> {
      const parsed = GetMapInputSchema.parse(args);
      const params: Record<string, unknown> = {};
      if (parsed.detail) params.detail = parsed.detail;
      if (parsed.region) params.region = parsed.region;
      return ipc.request<MapInfo>("get_map_info", params);
    },
  });

  tools.set("get_tech_tree", {
    description: [
      "Get all buildings and units that can currently be produced based on",
      "your tech tree state, completed prerequisites, and available funds.",
      "Each item includes: type ID, display name, cost, build time, whether",
      "prerequisites are met, whether you can afford it, prerequisite list,",
      "and which building produces it. Filter by category to narrow results.",
      "Use this to plan your tech path and production strategy.",
    ].join(" "),
    inputSchema: zodToJsonSchema(GetTechTreeInputSchema),
    async handler(args: Record<string, unknown>): Promise<BuildOptionsResponse> {
      const parsed = GetTechTreeInputSchema.parse(args);
      const params: Record<string, unknown> = {};
      if (parsed.category) params.category = parsed.category;
      return ipc.request<BuildOptionsResponse>("get_tech_tree", params);
    },
  });
}
