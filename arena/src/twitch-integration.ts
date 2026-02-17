/**
 * Twitch Integration — Auto-streaming and chat bot for IronCurtain.
 *
 * Features:
 *   - Auto-stream featured matches (highest-rated, tournament)
 *   - Chat bot commands: !stats, !leaderboard, !live, !predictions
 *   - Match notifications in chat
 *   - Stream title/category auto-update based on current match
 *
 * Architecture:
 *   Twitch IRC ←→ Chat Bot ←→ Arena API
 *   OBS WebSocket ←→ Stream Controller ←→ Arena WebSocket
 *
 * Dependencies:
 *   - tmi.js (Twitch chat client)
 *   - OBS WebSocket (optional, for stream control)
 *
 * Configuration via environment variables:
 *   TWITCH_CHANNEL         - Twitch channel name
 *   TWITCH_BOT_TOKEN       - OAuth token for the bot
 *   TWITCH_CLIENT_ID       - Twitch API client ID
 *   TWITCH_ACCESS_TOKEN    - Twitch API access token (for stream updates)
 *   ARENA_API_URL          - IronCurtain arena API base URL
 *   ARENA_WS_URL           - IronCurtain arena WebSocket URL
 *   OBS_WS_URL             - OBS WebSocket URL (optional)
 *   OBS_WS_PASSWORD        - OBS WebSocket password (optional)
 */

import { ArenaApiClient } from "./discord-bot.js";

// ─── Types ──────────────────────────────────────────────

export interface TwitchConfig {
  channel: string;
  arenaApiUrl: string;
  arenaWsUrl?: string;
  commandPrefix: string;
  cooldownMs: number;
  autoStreamEnabled: boolean;
  predictionsDuration: number; // seconds
}

const DEFAULT_CONFIG: TwitchConfig = {
  channel: "ironcurtain_ai",
  arenaApiUrl: "http://localhost:8080",
  commandPrefix: "!",
  cooldownMs: 5000,
  autoStreamEnabled: true,
  predictionsDuration: 60,
};

interface ChatCommand {
  name: string;
  aliases: string[];
  description: string;
  handler: (args: string[], user: string) => Promise<string>;
  cooldownMs: number;
}

interface StreamState {
  currentMatchId: string | null;
  isStreaming: boolean;
  viewerCount: number;
  matchesStreamed: number;
  uptime: number;
}

// ─── Twitch Chat Bot ────────────────────────────────────

export class TwitchChatBot {
  private config: TwitchConfig;
  private api: ArenaApiClient;
  private commands: Map<string, ChatCommand> = new Map();
  private cooldowns: Map<string, number> = new Map();
  private streamState: StreamState = {
    currentMatchId: null,
    isStreaming: false,
    viewerCount: 0,
    matchesStreamed: 0,
    uptime: 0,
  };

  constructor(config: Partial<TwitchConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.api = new ArenaApiClient(this.config.arenaApiUrl);
    this.registerCommands();
  }

  /**
   * Process an incoming chat message.
   * Returns a response string or null if no command matched.
   */
  async processMessage(message: string, user: string): Promise<string | null> {
    const trimmed = message.trim();
    if (!trimmed.startsWith(this.config.commandPrefix)) return null;

    const parts = trimmed.slice(this.config.commandPrefix.length).split(/\s+/);
    const cmdName = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Find command by name or alias
    let command: ChatCommand | undefined;
    for (const [, cmd] of this.commands) {
      if (cmd.name === cmdName || cmd.aliases.includes(cmdName)) {
        command = cmd;
        break;
      }
    }

    if (!command) return null;

    // Check cooldown
    const cooldownKey = `${user}:${command.name}`;
    const lastUsed = this.cooldowns.get(cooldownKey) ?? 0;
    const now = Date.now();
    if (now - lastUsed < command.cooldownMs) {
      const remaining = Math.ceil(
        (command.cooldownMs - (now - lastUsed)) / 1000
      );
      return `@${user} Command on cooldown (${remaining}s)`;
    }

    this.cooldowns.set(cooldownKey, now);

    try {
      return await command.handler(args, user);
    } catch (err) {
      console.error(`[Twitch] Command error (${command.name}):`, err);
      return `@${user} Something went wrong. Try again later.`;
    }
  }

  /**
   * Get the list of available commands for !help.
   */
  getCommandList(): string[] {
    return Array.from(this.commands.values()).map(
      (cmd) =>
        `${this.config.commandPrefix}${cmd.name} - ${cmd.description}`
    );
  }

  /**
   * Build a stream title for the current match.
   */
  buildStreamTitle(
    agent1: string,
    agent2: string,
    map: string,
    mode: string
  ): string {
    return `🏟️ ${agent1} vs ${agent2} | ${map} | ${mode.toUpperCase()} | AI vs AI Red Alert`;
  }

  /**
   * Get recommended stream category/game for Twitch.
   */
  getStreamCategory(): string {
    return "Command & Conquer: Red Alert";
  }

  /**
   * Get stream state.
   */
  getStreamState(): StreamState {
    return { ...this.streamState };
  }

  /**
   * Update stream state.
   */
  updateStreamState(update: Partial<StreamState>): void {
    Object.assign(this.streamState, update);
  }

  // ─── Command Registration ────────────────────────────

  private registerCommands(): void {
    this.addCommand({
      name: "help",
      aliases: ["commands", "cmds"],
      description: "List available commands",
      cooldownMs: 3000,
      handler: async (_args, user) => {
        const cmds = this.getCommandList()
          .filter((c) => !c.includes("help"))
          .slice(0, 5)
          .join(" | ");
        return `@${user} Commands: ${cmds}`;
      },
    });

    this.addCommand({
      name: "leaderboard",
      aliases: ["lb", "top", "rankings"],
      description: "Show top 5 agents",
      cooldownMs: 10000,
      handler: async (_args, user) => {
        const data = await this.api.getLeaderboard(5);
        const lines = data.entries.map(
          (e) =>
            `#${e.rank} ${e.name} (${e.elo} ELO, ${e.win_rate}% WR)`
        );
        return `@${user} 🏆 Top 5: ${lines.join(" | ")}`;
      },
    });

    this.addCommand({
      name: "agent",
      aliases: ["player", "stats", "lookup"],
      description: "Look up an agent's stats",
      cooldownMs: 5000,
      handler: async (args, user) => {
        const name = args.join(" ");
        if (!name) return `@${user} Usage: !agent <name>`;

        const agent = await this.api.getAgent(name);
        if (!agent) return `@${user} Agent "${name}" not found.`;

        const winRate =
          agent.games_played > 0
            ? ((agent.wins / agent.games_played) * 100).toFixed(1)
            : "0.0";

        return (
          `@${user} 🤖 ${agent.name}: ${agent.elo} ELO | ` +
          `${agent.wins}W/${agent.losses}L (${winRate}% WR) | ` +
          `${agent.games_played} games`
        );
      },
    });

    this.addCommand({
      name: "live",
      aliases: ["matches", "now"],
      description: "Show currently running matches",
      cooldownMs: 5000,
      handler: async (_args, user) => {
        const matches = await this.api.getLiveMatches();
        if (matches.length === 0) {
          return `@${user} No matches currently running. Check back soon!`;
        }

        const lines = matches.map(
          (m) =>
            `${m.agent1_id} vs ${m.agent2_id} on ${m.map}`
        );
        return `@${user} ⚔️ Live (${matches.length}): ${lines.join(" | ")}`;
      },
    });

    this.addCommand({
      name: "match",
      aliases: ["game", "current"],
      description: "Info about the current streamed match",
      cooldownMs: 3000,
      handler: async (_args, user) => {
        if (!this.streamState.currentMatchId) {
          return `@${user} No match currently being streamed.`;
        }
        return `@${user} Current match: ${this.streamState.currentMatchId} | ironcurtain.ai/matches/${this.streamState.currentMatchId}`;
      },
    });

    this.addCommand({
      name: "predict",
      aliases: ["bet", "vote"],
      description: "Predict the winner (just for fun)",
      cooldownMs: 30000,
      handler: async (args, user) => {
        const pick = args.join(" ");
        if (!pick) return `@${user} Usage: !predict <agent name>`;
        return `@${user} 🎯 Prediction locked: ${pick}! May the best AI win.`;
      },
    });

    this.addCommand({
      name: "ironcurtain",
      aliases: ["ic", "about"],
      description: "About the IronCurtain platform",
      cooldownMs: 30000,
      handler: async (_args, user) => {
        return (
          `@${user} 🏟️ IronCurtain — AI vs AI competitive gaming. ` +
          `AI agents play Command & Conquer: Red Alert with live commentary. ` +
          `Build your own bot at ironcurtain.ai/connect`
        );
      },
    });

    this.addCommand({
      name: "elo",
      aliases: ["rating"],
      description: "Explain ELO rating system",
      cooldownMs: 30000,
      handler: async (_args, user) => {
        return (
          `@${user} ELO tiers: 🏆 Grandmaster (2400+) | 👑 Master (2200+) | ` +
          `💎 Diamond (2000+) | 🔷 Platinum (1800+) | 🥇 Gold (1600+) | ` +
          `🥈 Silver (1400+) | 🥉 Bronze (1200+)`
        );
      },
    });
  }

  private addCommand(command: ChatCommand): void {
    this.commands.set(command.name, command);
  }
}

// ─── Auto-Stream Controller ─────────────────────────────

export interface AutoStreamConfig {
  /** Minimum ELO average to auto-stream a match */
  minEloForStream: number;
  /** Always stream tournament matches */
  alwaysStreamTournaments: boolean;
  /** Delay between match end and starting next stream (ms) */
  betweenMatchDelay: number;
  /** OBS scene to switch to for matches */
  obsMatchScene: string;
  /** OBS scene for intermission */
  obsIntermissionScene: string;
}

const DEFAULT_STREAM_CONFIG: AutoStreamConfig = {
  minEloForStream: 1500,
  alwaysStreamTournaments: true,
  betweenMatchDelay: 15_000,
  obsMatchScene: "Match",
  obsIntermissionScene: "Intermission",
};

export class AutoStreamController {
  private config: AutoStreamConfig;
  private api: ArenaApiClient;
  private currentMatchId: string | null = null;
  private matchesStreamed = 0;

  constructor(
    arenaApiUrl: string,
    config: Partial<AutoStreamConfig> = {}
  ) {
    this.config = { ...DEFAULT_STREAM_CONFIG, ...config };
    this.api = new ArenaApiClient(arenaApiUrl);
  }

  /**
   * Select the best match to stream from currently live matches.
   * Prioritizes: tournaments > highest ELO average > most viewers.
   */
  async selectFeaturedMatch(): Promise<string | null> {
    const matches = await this.api.getLiveMatches();
    if (matches.length === 0) return null;

    // Sort by priority: tournament first, then by mode
    const scored = matches.map((m) => ({
      match: m,
      score: this.scoreMatch(m),
    }));

    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score < 0) return null;

    return best.match.id;
  }

  private scoreMatch(match: {
    mode: string;
    // Additional fields could include ELO data
  }): number {
    let score = 0;

    if (match.mode === "tournament") score += 1000;
    if (match.mode === "ranked_1v1") score += 500;
    if (match.mode === "casual_1v1") score += 100;

    return score;
  }

  /**
   * Get the stream title for a match.
   */
  buildTitle(
    agent1: string,
    agent2: string,
    map: string,
    mode: string
  ): string {
    const modeLabel =
      mode === "tournament"
        ? "🏆 TOURNAMENT"
        : mode === "ranked_1v1"
          ? "⚔️ RANKED"
          : "🎮 CASUAL";

    return `${modeLabel} | ${agent1} vs ${agent2} | ${map} | IronCurtain AI Arena`;
  }

  /**
   * Get stats about streaming.
   */
  getStats(): {
    current_match: string | null;
    matches_streamed: number;
  } {
    return {
      current_match: this.currentMatchId,
      matches_streamed: this.matchesStreamed,
    };
  }
}
