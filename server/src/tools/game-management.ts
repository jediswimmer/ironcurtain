/**
 * Game Management Tools — game_start, game_status
 */

import { IpcClient } from "../ipc/client.js";

type ToolMap = Map<string, {
  description: string;
  inputSchema: object;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}>;

export function registerGameManagementTools(tools: ToolMap, ipc: IpcClient) {
  tools.set("game_status", {
    description:
      "Get the current game status including phase, elapsed time, credits, unit/building counts, power status, and kill/loss stats.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      return await ipc.request("get_state");
    },
  });

  tools.set("game_start", {
    description:
      "Launch a new OpenRA Red Alert game. Configures map, faction, opponents, and game settings. Returns game details once the match begins.",
    inputSchema: {
      type: "object",
      properties: {
        map: {
          type: "string",
          description: "Map ID or name. Null for random map.",
        },
        faction: {
          type: "string",
          enum: ["allies", "soviet"],
          description: "Our faction. Null for random.",
        },
        opponents: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["human", "bot"] },
              faction: { type: "string", enum: ["allies", "soviet"] },
              difficulty: { type: "string", enum: ["easy", "normal", "hard"] },
            },
          },
          description: "Opponent configuration.",
        },
        game_speed: {
          type: "string",
          enum: ["slowest", "slower", "slow", "normal", "fast", "faster", "fastest"],
          description: "Game speed. Default: normal.",
        },
      },
    },
    handler: async (args) => {
      // TODO: Launch OpenRA process with configured settings
      // For MVP, assume game is already running and we just need to connect
      return {
        status: "not_implemented",
        message:
          "Game launching will be implemented in Phase 4. For now, start the game manually with the MCP bot selected.",
      };
    },
  });
}
