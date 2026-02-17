/**
 * Game Management Tools
 *
 * Tools for game lifecycle and status monitoring.
 *   - game_status  — Current game state, phase, economy, military summary
 *   - game_settings — Current match configuration and player info
 */

import { z } from "zod";
import type { IpcClient } from "../ipc/client.js";
import type { ToolMap, GameStatus, GameSettings } from "../types.js";
import { zodToJsonSchema } from "../util/schema.js";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const GameStatusInputSchema = z.object({}).strict().describe("No parameters required.");

const GameSettingsInputSchema = z.object({}).strict().describe("No parameters required.");

// ─── Registration ────────────────────────────────────────────────────────────

export function registerGameManagementTools(tools: ToolMap, ipc: IpcClient): void {
  tools.set("game_status", {
    description: [
      "Get the current game status including phase (lobby/playing/won/lost),",
      "elapsed time, our faction, credits, unit and building counts,",
      "power status (generated vs consumed), and kill/loss statistics.",
      "Call this frequently to maintain situational awareness.",
    ].join(" "),
    inputSchema: zodToJsonSchema(GameStatusInputSchema),
    async handler(_args: Record<string, unknown>): Promise<GameStatus> {
      const result = await ipc.request<GameStatus>("get_state");
      return result;
    },
  });

  tools.set("game_settings", {
    description: [
      "Get the current match settings: game ID, map name, map size,",
      "game speed, fog of war/shroud settings, starting cash, tech level,",
      "and full player list with factions.",
    ].join(" "),
    inputSchema: zodToJsonSchema(GameSettingsInputSchema),
    async handler(_args: Record<string, unknown>): Promise<GameSettings> {
      const result = await ipc.request<GameSettings>("get_settings");
      return result;
    },
  });
}
