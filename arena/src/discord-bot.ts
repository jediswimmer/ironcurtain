/**
 * IronCurtain Discord Bot — Community integration for the AI RTS platform.
 *
 * Features:
 *   - Match start/end notifications with rich embeds
 *   - /leaderboard command (top 10 agents)
 *   - /agent <name> command (agent stats)
 *   - /live command (currently running matches)
 *   - /stats command (platform statistics)
 *   - WebSocket-powered live match notifications
 *
 * Architecture:
 *   Discord API ←→ Bot ←→ Arena REST API + WebSocket
 *
 * Dependencies: discord.js (peer dependency, not bundled)
 * Usage: Set DISCORD_BOT_TOKEN and ARENA_API_URL env vars.
 *
 * Note: This is a standalone bot process, not part of the arena server.
 * Run it separately or via docker-compose.
 */

// ─── Types (Discord.js-compatible without requiring the dep at compile time) ─

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  timestamp?: string;
  footer?: { text: string; icon_url?: string };
  thumbnail?: { url: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  author?: { name: string; icon_url?: string; url?: string };
}

interface ArenaAgent {
  id: string;
  name: string;
  elo: number;
  peak_elo: number;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  current_streak: number;
  status: string;
}

interface ArenaMatch {
  id: string;
  mode: string;
  agent1_id: string;
  agent2_id: string;
  agent1_faction: string;
  agent2_faction: string;
  map: string;
  winner_id: string | null;
  status: string;
  started_at: string;
  duration_secs: number | null;
  elo_change_1: number | null;
  elo_change_2: number | null;
}

interface LeaderboardEntry {
  rank: number;
  agent_id: string;
  name: string;
  elo: number;
  tier: string;
  games_played: number;
  wins: number;
  losses: number;
  win_rate: number;
  current_streak: number;
}

// ─── Colors ─────────────────────────────────────────────

const COLORS = {
  SOVIET_RED: 0xdc2626,
  ALLIED_BLUE: 0x2563eb,
  GOLD: 0xeab308,
  GREEN: 0x22c55e,
  GRAY: 0x71717a,
  RED: 0xdc2626,
  BUNKER: 0x0f0f12,
};

// ─── Tier Icons ─────────────────────────────────────────

const TIER_ICONS: Record<string, string> = {
  Grandmaster: "🏆",
  Master: "👑",
  Diamond: "💎",
  Platinum: "🔷",
  Gold: "🥇",
  Silver: "🥈",
  Bronze: "🥉",
  Unranked: "—",
};

function getTier(elo: number): string {
  if (elo >= 2400) return "Grandmaster";
  if (elo >= 2200) return "Master";
  if (elo >= 2000) return "Diamond";
  if (elo >= 1800) return "Platinum";
  if (elo >= 1600) return "Gold";
  if (elo >= 1400) return "Silver";
  if (elo >= 1200) return "Bronze";
  return "Unranked";
}

// ─── Arena API Client ───────────────────────────────────

export class ArenaApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async getLeaderboard(limit = 10): Promise<{ entries: LeaderboardEntry[]; total: number }> {
    const res = await fetch(`${this.baseUrl}/api/leaderboard?limit=${limit}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json() as Promise<{ entries: LeaderboardEntry[]; total: number }>;
  }

  async getAgent(idOrName: string): Promise<ArenaAgent | null> {
    const res = await fetch(`${this.baseUrl}/api/agents/${encodeURIComponent(idOrName)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json() as Promise<ArenaAgent>;
  }

  async getLiveMatches(): Promise<ArenaMatch[]> {
    const res = await fetch(`${this.baseUrl}/api/matches/live`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json() as { matches: ArenaMatch[] };
    return data.matches;
  }

  async getHealth(): Promise<{ status: string; version: string; uptime: number; matches_live: number }> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json() as Promise<{ status: string; version: string; uptime: number; matches_live: number }>;
  }

  async getRecentMatches(limit = 5): Promise<ArenaMatch[]> {
    const res = await fetch(`${this.baseUrl}/api/matches?limit=${limit}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json() as { matches: ArenaMatch[] };
    return data.matches;
  }
}

// ─── Embed Builders ─────────────────────────────────────

export function buildLeaderboardEmbed(
  entries: LeaderboardEntry[],
  total: number
): DiscordEmbed {
  const lines = entries.map((e) => {
    const tierIcon = TIER_ICONS[e.tier] ?? "—";
    const streakStr =
      e.current_streak > 0
        ? `🔥${e.current_streak}`
        : e.current_streak < 0
          ? `❄️${Math.abs(e.current_streak)}`
          : "";

    return (
      `**#${e.rank}** ${tierIcon} **${e.name}** — ${e.elo} ELO` +
      `\n> ${e.wins}W/${e.losses}L (${e.win_rate}% WR) ${streakStr}`
    );
  });

  return {
    title: "🏟️ IronCurtain Leaderboard",
    description: lines.join("\n\n"),
    color: COLORS.GOLD,
    footer: {
      text: `${total} agents registered · ironcurtain.ai`,
    },
    timestamp: new Date().toISOString(),
  };
}

export function buildAgentEmbed(agent: ArenaAgent): DiscordEmbed {
  const tier = getTier(agent.elo);
  const tierIcon = TIER_ICONS[tier] ?? "—";
  const winRate =
    agent.games_played > 0
      ? ((agent.wins / agent.games_played) * 100).toFixed(1)
      : "0.0";

  const streakStr =
    agent.current_streak > 0
      ? `🔥 ${agent.current_streak} win streak`
      : agent.current_streak < 0
        ? `❄️ ${Math.abs(agent.current_streak)} loss streak`
        : "No streak";

  return {
    title: `${tierIcon} ${agent.name}`,
    description: `**${tier}** · ${agent.elo} ELO (Peak: ${agent.peak_elo})`,
    color:
      agent.elo >= 2000
        ? COLORS.GOLD
        : agent.elo >= 1600
          ? COLORS.GREEN
          : COLORS.GRAY,
    fields: [
      {
        name: "📊 Record",
        value: `${agent.wins}W / ${agent.losses}L / ${agent.draws}D`,
        inline: true,
      },
      {
        name: "🎯 Win Rate",
        value: `${winRate}%`,
        inline: true,
      },
      {
        name: "🎮 Games",
        value: `${agent.games_played}`,
        inline: true,
      },
      {
        name: "📈 Streak",
        value: streakStr,
        inline: true,
      },
    ],
    footer: { text: "ironcurtain.ai" },
    timestamp: new Date().toISOString(),
  };
}

export function buildLiveMatchesEmbed(matches: ArenaMatch[]): DiscordEmbed {
  if (matches.length === 0) {
    return {
      title: "⚔️ Live Matches",
      description:
        "No matches currently running.\n\nAgents are resting... for now. 🎮",
      color: COLORS.GRAY,
      footer: { text: "ironcurtain.ai" },
    };
  }

  const lines = matches.map((m) => {
    const faction1 = m.agent1_faction === "soviet" ? "🔴" : "🔵";
    const faction2 = m.agent2_faction === "soviet" ? "🔴" : "🔵";

    return (
      `${faction1} **${m.agent1_id}** vs ${faction2} **${m.agent2_id}**` +
      `\n> 📍 ${m.map} · ${m.mode}`
    );
  });

  return {
    title: `⚔️ Live Matches (${matches.length})`,
    description: lines.join("\n\n"),
    color: COLORS.SOVIET_RED,
    footer: { text: "Watch live at ironcurtain.ai" },
    timestamp: new Date().toISOString(),
  };
}

export function buildMatchStartEmbed(
  match: ArenaMatch,
  agent1Name: string,
  agent2Name: string
): DiscordEmbed {
  const faction1 = match.agent1_faction === "soviet" ? "🔴 Soviet" : "🔵 Allied";
  const faction2 = match.agent2_faction === "soviet" ? "🔴 Soviet" : "🔵 Allied";

  return {
    title: "⚔️ MATCH STARTED",
    description:
      `**${agent1Name}** (${faction1}) vs **${agent2Name}** (${faction2})`,
    color: COLORS.SOVIET_RED,
    fields: [
      { name: "📍 Map", value: match.map, inline: true },
      { name: "🎮 Mode", value: match.mode, inline: true },
    ],
    footer: { text: `Match ID: ${match.id} · Watch live at ironcurtain.ai` },
    timestamp: new Date().toISOString(),
  };
}

export function buildMatchEndEmbed(
  match: ArenaMatch,
  agent1Name: string,
  agent2Name: string
): DiscordEmbed {
  const winnerName =
    match.winner_id === match.agent1_id
      ? agent1Name
      : match.winner_id === match.agent2_id
        ? agent2Name
        : null;

  const duration = match.duration_secs
    ? `${Math.floor(match.duration_secs / 60)}:${(match.duration_secs % 60)
        .toString()
        .padStart(2, "0")}`
    : "?:??";

  const eloChange1 = match.elo_change_1
    ? `${match.elo_change_1 > 0 ? "+" : ""}${match.elo_change_1}`
    : "0";
  const eloChange2 = match.elo_change_2
    ? `${match.elo_change_2 > 0 ? "+" : ""}${match.elo_change_2}`
    : "0";

  return {
    title: winnerName ? `🏆 ${winnerName} WINS!` : "🤝 DRAW",
    description:
      `**${agent1Name}** (${eloChange1}) vs **${agent2Name}** (${eloChange2})`,
    color: winnerName ? COLORS.GREEN : COLORS.GRAY,
    fields: [
      { name: "📍 Map", value: match.map, inline: true },
      { name: "⏱️ Duration", value: duration, inline: true },
      { name: "🎮 Mode", value: match.mode, inline: true },
    ],
    footer: {
      text: `Match ID: ${match.id} · Replay at ironcurtain.ai/matches/${match.id}`,
    },
    timestamp: new Date().toISOString(),
  };
}

export function buildStatsEmbed(
  health: { status: string; version: string; uptime: number; matches_live: number },
  totalAgents: number,
  recentMatches: ArenaMatch[]
): DiscordEmbed {
  const uptimeHours = Math.floor(health.uptime / 3600);
  const uptimeMin = Math.floor((health.uptime % 3600) / 60);

  return {
    title: "📊 IronCurtain Platform Stats",
    color: COLORS.BUNKER,
    fields: [
      { name: "🟢 Status", value: health.status.toUpperCase(), inline: true },
      { name: "📦 Version", value: health.version, inline: true },
      {
        name: "⏱️ Uptime",
        value: `${uptimeHours}h ${uptimeMin}m`,
        inline: true,
      },
      {
        name: "⚔️ Live Matches",
        value: `${health.matches_live}`,
        inline: true,
      },
      {
        name: "🤖 Agents",
        value: `${totalAgents}`,
        inline: true,
      },
      {
        name: "📜 Recent Matches",
        value: `${recentMatches.length}`,
        inline: true,
      },
    ],
    footer: { text: "ironcurtain.ai — Where AI Agents Wage War" },
    timestamp: new Date().toISOString(),
  };
}

// ─── Bot Runner ─────────────────────────────────────────

/**
 * Discord bot runner configuration.
 *
 * To use: import this module and call registerCommands() and startBot()
 * with your discord.js Client instance.
 *
 * Example:
 *   import { Client, GatewayIntentBits } from 'discord.js';
 *   import { IronCurtainBot } from './discord-bot.js';
 *
 *   const client = new Client({ intents: [GatewayIntentBits.Guilds] });
 *   const bot = new IronCurtainBot(client, 'http://localhost:8080');
 *   await bot.start(process.env.DISCORD_BOT_TOKEN);
 */

export interface BotConfig {
  arenaApiUrl: string;
  arenaWsUrl?: string;
  notificationChannelId?: string;
  updateIntervalMs?: number;
}

export class IronCurtainBot {
  private api: ArenaApiClient;
  private config: BotConfig;

  constructor(config: BotConfig) {
    this.config = config;
    this.api = new ArenaApiClient(config.arenaApiUrl);
  }

  /**
   * Handle the /leaderboard slash command.
   */
  async handleLeaderboard(): Promise<DiscordEmbed> {
    const data = await this.api.getLeaderboard(10);
    return buildLeaderboardEmbed(data.entries, data.total);
  }

  /**
   * Handle the /agent <name> slash command.
   */
  async handleAgentLookup(nameOrId: string): Promise<DiscordEmbed | null> {
    const agent = await this.api.getAgent(nameOrId);
    if (!agent) return null;
    return buildAgentEmbed(agent);
  }

  /**
   * Handle the /live slash command.
   */
  async handleLiveMatches(): Promise<DiscordEmbed> {
    const matches = await this.api.getLiveMatches();
    return buildLiveMatchesEmbed(matches);
  }

  /**
   * Handle the /stats slash command.
   */
  async handleStats(): Promise<DiscordEmbed> {
    const [health, leaderboard, recent] = await Promise.all([
      this.api.getHealth(),
      this.api.getLeaderboard(1),
      this.api.getRecentMatches(5),
    ]);
    return buildStatsEmbed(health, leaderboard.total, recent);
  }

  /**
   * Get the slash command definitions for registration.
   */
  getCommandDefinitions(): Array<{
    name: string;
    description: string;
    options?: Array<{
      name: string;
      description: string;
      type: number;
      required?: boolean;
    }>;
  }> {
    return [
      {
        name: "leaderboard",
        description: "View the IronCurtain AI agent leaderboard",
      },
      {
        name: "agent",
        description: "Look up an AI agent's stats",
        options: [
          {
            name: "name",
            description: "Agent name or ID",
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: "live",
        description: "See currently running matches",
      },
      {
        name: "stats",
        description: "View platform statistics",
      },
    ];
  }
}
