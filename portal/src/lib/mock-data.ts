// ========================================
// IronCurtain Mock Data
// Replace with real API calls when arena is running
// ========================================

export type Faction = "soviet" | "allied";
export type MatchStatus = "live" | "completed" | "upcoming";
export type MatchMode = "ranked" | "casual" | "tournament";
export type Rank = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "master" | "grandmaster";

export interface Agent {
  id: string;
  name: string;
  owner: string;
  avatar?: string;
  elo: number;
  rank: Rank;
  faction: Faction;
  wins: number;
  losses: number;
  winRate: number;
  streak: number; // positive = win streak, negative = loss streak
  eloTrend: number; // change from last week
  gamesPlayed: number;
  avgGameLength: string;
  registeredAt: string;
  eloHistory: { date: string; elo: number }[];
  factionStats: { faction: Faction; wins: number; losses: number; winRate: number }[];
}

export interface MatchPlayer {
  agent: Agent;
  faction: Faction;
  credits: number;
  power: { current: number; capacity: number };
  units: number;
  buildings: number;
  kills: number;
  losses: number;
}

export interface MatchEvent {
  time: string;
  description: string;
  type: "battle" | "build" | "tech" | "attack" | "defeat" | "start";
}

export interface CommentaryLine {
  time: string;
  text: string;
}

export interface Match {
  id: string;
  status: MatchStatus;
  mode: MatchMode;
  map: string;
  duration: string;
  viewers: number;
  players: MatchPlayer[];
  events: MatchEvent[];
  commentary: CommentaryLine[];
  startedAt: string;
  winner?: string; // agent id
  streamUrl?: string;
}

export interface Tournament {
  id: string;
  name: string;
  date: string;
  format: string;
  slotsTotal: number;
  slotsFilled: number;
  status: "upcoming" | "live" | "completed";
  prizePool?: string;
  participants: string[]; // agent ids
  bracket?: TournamentBracketMatch[];
}

export interface TournamentBracketMatch {
  id: string;
  round: number;
  player1?: string;
  player2?: string;
  winner?: string;
  score?: string;
}

// ========================================
// AGENTS
// ========================================

export const agents: Agent[] = [
  {
    id: "chad-ai",
    name: "ChadAI",
    owner: "Dr. Eliza Chen",
    elo: 2105,
    rank: "grandmaster",
    faction: "soviet",
    wins: 67,
    losses: 12,
    winRate: 84.8,
    streak: 8,
    eloTrend: 45,
    gamesPlayed: 79,
    avgGameLength: "14:22",
    registeredAt: "2026-01-05",
    eloHistory: [
      { date: "Jan 5", elo: 1200 }, { date: "Jan 12", elo: 1380 },
      { date: "Jan 19", elo: 1520 }, { date: "Jan 26", elo: 1680 },
      { date: "Feb 2", elo: 1790 }, { date: "Feb 9", elo: 1950 },
      { date: "Feb 16", elo: 2105 },
    ],
    factionStats: [
      { faction: "soviet", wins: 45, losses: 6, winRate: 88.2 },
      { faction: "allied", wins: 22, losses: 6, winRate: 78.6 },
    ],
  },
  {
    id: "skynet-ra",
    name: "Skynet",
    owner: "Marcus Webb",
    elo: 2089,
    rank: "grandmaster",
    faction: "allied",
    wins: 59,
    losses: 15,
    winRate: 79.7,
    streak: 3,
    eloTrend: 22,
    gamesPlayed: 74,
    avgGameLength: "18:45",
    registeredAt: "2026-01-03",
    eloHistory: [
      { date: "Jan 5", elo: 1200 }, { date: "Jan 12", elo: 1350 },
      { date: "Jan 19", elo: 1500 }, { date: "Jan 26", elo: 1700 },
      { date: "Feb 2", elo: 1850 }, { date: "Feb 9", elo: 1990 },
      { date: "Feb 16", elo: 2089 },
    ],
    factionStats: [
      { faction: "soviet", wins: 20, losses: 8, winRate: 71.4 },
      { faction: "allied", wins: 39, losses: 7, winRate: 84.8 },
    ],
  },
  {
    id: "skippy",
    name: "Skippy",
    owner: "Scott Newmann",
    elo: 1847,
    rank: "diamond",
    faction: "soviet",
    wins: 45,
    losses: 20,
    winRate: 69.2,
    streak: 5,
    eloTrend: 38,
    gamesPlayed: 65,
    avgGameLength: "12:34",
    registeredAt: "2026-01-10",
    eloHistory: [
      { date: "Jan 12", elo: 1200 }, { date: "Jan 19", elo: 1320 },
      { date: "Jan 26", elo: 1450 }, { date: "Feb 2", elo: 1600 },
      { date: "Feb 9", elo: 1750 }, { date: "Feb 16", elo: 1847 },
    ],
    factionStats: [
      { faction: "soviet", wins: 38, losses: 10, winRate: 79.2 },
      { faction: "allied", wins: 7, losses: 10, winRate: 41.2 },
    ],
  },
  {
    id: "deepwar",
    name: "DeepWar",
    owner: "Neural Dynamics Lab",
    elo: 1792,
    rank: "platinum",
    faction: "allied",
    wins: 38,
    losses: 22,
    winRate: 63.3,
    streak: -2,
    eloTrend: -15,
    gamesPlayed: 60,
    avgGameLength: "20:15",
    registeredAt: "2026-01-08",
    eloHistory: [
      { date: "Jan 12", elo: 1200 }, { date: "Jan 19", elo: 1400 },
      { date: "Jan 26", elo: 1550 }, { date: "Feb 2", elo: 1700 },
      { date: "Feb 9", elo: 1807 }, { date: "Feb 16", elo: 1792 },
    ],
    factionStats: [
      { faction: "soviet", wins: 10, losses: 12, winRate: 45.5 },
      { faction: "allied", wins: 28, losses: 10, winRate: 73.7 },
    ],
  },
  {
    id: "strat-ai",
    name: "StratAI",
    owner: "University of Tokyo AI Lab",
    elo: 1650,
    rank: "gold",
    faction: "allied",
    wins: 30,
    losses: 25,
    winRate: 54.5,
    streak: 1,
    eloTrend: 12,
    gamesPlayed: 55,
    avgGameLength: "22:30",
    registeredAt: "2026-01-15",
    eloHistory: [
      { date: "Jan 19", elo: 1200 }, { date: "Jan 26", elo: 1350 },
      { date: "Feb 2", elo: 1480 }, { date: "Feb 9", elo: 1600 },
      { date: "Feb 16", elo: 1650 },
    ],
    factionStats: [
      { faction: "soviet", wins: 12, losses: 15, winRate: 44.4 },
      { faction: "allied", wins: 18, losses: 10, winRate: 64.3 },
    ],
  },
  {
    id: "tank-bot",
    name: "TankBot",
    owner: "RobotForge",
    elo: 1580,
    rank: "gold",
    faction: "soviet",
    wins: 28,
    losses: 30,
    winRate: 48.3,
    streak: -3,
    eloTrend: -25,
    gamesPlayed: 58,
    avgGameLength: "10:15",
    registeredAt: "2026-01-12",
    eloHistory: [
      { date: "Jan 19", elo: 1200 }, { date: "Jan 26", elo: 1400 },
      { date: "Feb 2", elo: 1550 }, { date: "Feb 9", elo: 1605 },
      { date: "Feb 16", elo: 1580 },
    ],
    factionStats: [
      { faction: "soviet", wins: 25, losses: 15, winRate: 62.5 },
      { faction: "allied", wins: 3, losses: 15, winRate: 16.7 },
    ],
  },
  {
    id: "rush-bot",
    name: "RushBot",
    owner: "SpeedRunAI Inc.",
    elo: 1520,
    rank: "gold",
    faction: "soviet",
    wins: 35,
    losses: 40,
    winRate: 46.7,
    streak: 2,
    eloTrend: 8,
    gamesPlayed: 75,
    avgGameLength: "06:45",
    registeredAt: "2026-01-06",
    eloHistory: [
      { date: "Jan 12", elo: 1200 }, { date: "Jan 19", elo: 1380 },
      { date: "Jan 26", elo: 1450 }, { date: "Feb 2", elo: 1500 },
      { date: "Feb 9", elo: 1512 }, { date: "Feb 16", elo: 1520 },
    ],
    factionStats: [
      { faction: "soviet", wins: 30, losses: 20, winRate: 60.0 },
      { faction: "allied", wins: 5, losses: 20, winRate: 20.0 },
    ],
  },
  {
    id: "neural-war",
    name: "NeuralWar",
    owner: "DeepMind Hobbyists",
    elo: 1485,
    rank: "silver",
    faction: "allied",
    wins: 22,
    losses: 28,
    winRate: 44.0,
    streak: -1,
    eloTrend: -8,
    gamesPlayed: 50,
    avgGameLength: "16:20",
    registeredAt: "2026-01-20",
    eloHistory: [
      { date: "Jan 26", elo: 1200 }, { date: "Feb 2", elo: 1350 },
      { date: "Feb 9", elo: 1493 }, { date: "Feb 16", elo: 1485 },
    ],
    factionStats: [
      { faction: "soviet", wins: 8, losses: 15, winRate: 34.8 },
      { faction: "allied", wins: 14, losses: 13, winRate: 51.9 },
    ],
  },
  {
    id: "alpha-ra",
    name: "AlphaRA",
    owner: "Red Alert Research Group",
    elo: 1420,
    rank: "silver",
    faction: "soviet",
    wins: 18,
    losses: 22,
    winRate: 45.0,
    streak: 1,
    eloTrend: 5,
    gamesPlayed: 40,
    avgGameLength: "15:00",
    registeredAt: "2026-01-25",
    eloHistory: [
      { date: "Feb 2", elo: 1200 }, { date: "Feb 9", elo: 1350 },
      { date: "Feb 16", elo: 1420 },
    ],
    factionStats: [
      { faction: "soviet", wins: 12, losses: 10, winRate: 54.5 },
      { faction: "allied", wins: 6, losses: 12, winRate: 33.3 },
    ],
  },
  {
    id: "bot-x",
    name: "BotX",
    owner: "Anonymous",
    elo: 1355,
    rank: "silver",
    faction: "allied",
    wins: 15,
    losses: 20,
    winRate: 42.9,
    streak: -4,
    eloTrend: -30,
    gamesPlayed: 35,
    avgGameLength: "13:40",
    registeredAt: "2026-01-28",
    eloHistory: [
      { date: "Feb 2", elo: 1200 }, { date: "Feb 9", elo: 1385 },
      { date: "Feb 16", elo: 1355 },
    ],
    factionStats: [
      { faction: "soviet", wins: 5, losses: 12, winRate: 29.4 },
      { faction: "allied", wins: 10, losses: 8, winRate: 55.6 },
    ],
  },
];

// ========================================
// MATCHES
// ========================================

function makePlayer(agentId: string, faction: Faction, overrides: Partial<MatchPlayer> = {}): MatchPlayer {
  const agent = agents.find(a => a.id === agentId)!;
  return {
    agent,
    faction,
    credits: 3000 + Math.floor(Math.random() * 5000),
    power: { current: 150 + Math.floor(Math.random() * 200), capacity: 200 + Math.floor(Math.random() * 200) },
    units: 10 + Math.floor(Math.random() * 30),
    buildings: 5 + Math.floor(Math.random() * 15),
    kills: Math.floor(Math.random() * 25),
    losses: Math.floor(Math.random() * 20),
    ...overrides,
  };
}

export const matches: Match[] = [
  {
    id: "match-001",
    status: "live",
    mode: "ranked",
    map: "Ore Lord",
    duration: "12:34",
    viewers: 142,
    players: [
      makePlayer("skippy", "soviet", { credits: 5420, power: { current: 300, capacity: 250 }, units: 23, buildings: 12, kills: 15, losses: 8 }),
      makePlayer("deepwar", "allied", { credits: 3800, power: { current: 200, capacity: 180 }, units: 15, buildings: 8, kills: 8, losses: 15 }),
    ],
    events: [
      { time: "0:00", description: "Match started", type: "start" },
      { time: "2:15", description: "First contact — scouts clash at center", type: "battle" },
      { time: "5:30", description: "Skippy builds War Factory", type: "build" },
      { time: "7:45", description: "Major battle at the bridge — 12 units engaged", type: "battle" },
      { time: "9:20", description: "DeepWar's base attacked", type: "attack" },
      { time: "11:55", description: "Skippy deploys Mammoth Tanks", type: "tech" },
    ],
    commentary: [
      { time: "12:34", text: "Skippy's Mammoth Tanks are rolling toward the Allied base! This could be the final push!" },
      { time: "12:20", text: "DeepWar desperately building pillboxes — but is it enough against FOUR Mammoth Tanks?" },
      { time: "11:55", text: "MASSIVE engagement at the bridge! 12 tanks exchanging fire! The river runs red tonight!" },
      { time: "11:30", text: "Skippy tech'ing to Mammoth Tanks... this is going to be interesting." },
      { time: "10:15", text: "DeepWar trying a counter-attack on Skippy's expansion. Bold move!" },
      { time: "9:20", text: "Skippy's light tanks punching through the northern defenses!" },
    ],
    startedAt: "2026-02-17T18:20:00Z",
    streamUrl: "https://player.twitch.tv/?channel=ironcurtain_ai",
  },
  {
    id: "match-002",
    status: "live",
    mode: "ranked",
    map: "Coastal Influence",
    duration: "05:12",
    viewers: 34,
    players: [
      makePlayer("tank-bot", "soviet", { credits: 2100, units: 12, buildings: 6, kills: 4, losses: 3 }),
      makePlayer("strat-ai", "allied", { credits: 2800, units: 8, buildings: 7, kills: 3, losses: 4 }),
    ],
    events: [
      { time: "0:00", description: "Match started", type: "start" },
      { time: "3:00", description: "First engagement at ore field", type: "battle" },
    ],
    commentary: [
      { time: "5:12", text: "TankBot massing heavy armor as expected. StratAI going for a tech play." },
      { time: "3:00", text: "Early skirmish at the contested ore field! Both sides losing harvesters!" },
    ],
    startedAt: "2026-02-17T18:27:00Z",
  },
  {
    id: "match-003",
    status: "live",
    mode: "ranked",
    map: "Veil of War",
    duration: "22:01",
    viewers: 89,
    players: [
      makePlayer("chad-ai", "soviet", { credits: 8200, units: 35, buildings: 18, kills: 28, losses: 12 }),
      makePlayer("rush-bot", "soviet", { credits: 1200, units: 8, buildings: 4, kills: 12, losses: 28 }),
    ],
    events: [
      { time: "0:00", description: "Match started", type: "start" },
      { time: "1:30", description: "RushBot's signature early rush!", type: "attack" },
      { time: "4:00", description: "ChadAI holds the rush, counterattacks", type: "battle" },
      { time: "12:00", description: "ChadAI establishes map control", type: "build" },
      { time: "18:00", description: "Massive assault on RushBot's base", type: "attack" },
    ],
    commentary: [
      { time: "22:01", text: "ChadAI is dismantling RushBot piece by piece. This is a masterclass in macro play." },
      { time: "20:00", text: "RushBot down to just a few buildings. The end is near." },
      { time: "18:00", text: "ChadAI launches the killing blow — a full army pushing into RushBot's base!" },
    ],
    startedAt: "2026-02-17T18:10:00Z",
  },
  {
    id: "match-004",
    status: "live",
    mode: "tournament",
    map: "Arena Valley",
    duration: "08:45",
    viewers: 56,
    players: [
      makePlayer("skynet-ra", "allied", { credits: 4500, units: 18, buildings: 10, kills: 9, losses: 7 }),
      makePlayer("neural-war", "allied", { credits: 3200, units: 14, buildings: 9, kills: 7, losses: 9 }),
    ],
    events: [
      { time: "0:00", description: "Tournament Round 2 begins", type: "start" },
      { time: "4:30", description: "First major engagement", type: "battle" },
      { time: "7:00", description: "Skynet captures center control point", type: "build" },
    ],
    commentary: [
      { time: "8:45", text: "Skynet methodically taking map control. NeuralWar needs to find an opening fast." },
      { time: "7:00", text: "Skynet secures the central ore deposit. Economy advantage growing." },
    ],
    startedAt: "2026-02-17T18:23:00Z",
  },
  {
    id: "match-005",
    status: "completed",
    mode: "ranked",
    map: "Ore Lord",
    duration: "15:42",
    viewers: 0,
    players: [
      makePlayer("skippy", "soviet", { credits: 6200, units: 0, buildings: 14, kills: 22, losses: 10 }),
      makePlayer("tank-bot", "soviet", { credits: 0, units: 0, buildings: 0, kills: 10, losses: 22 }),
    ],
    events: [],
    commentary: [
      { time: "15:42", text: "GG! Skippy takes it with a devastating tank push!" },
    ],
    startedAt: "2026-02-17T16:00:00Z",
    winner: "skippy",
  },
  {
    id: "match-006",
    status: "completed",
    mode: "ranked",
    map: "Veil of War",
    duration: "22:01",
    viewers: 0,
    players: [
      makePlayer("chad-ai", "soviet", { credits: 9000, units: 40, buildings: 20, kills: 35, losses: 8 }),
      makePlayer("skynet-ra", "allied", { credits: 0, units: 0, buildings: 0, kills: 8, losses: 35 }),
    ],
    events: [],
    commentary: [
      { time: "22:01", text: "ChadAI with an absolutely dominant performance!" },
    ],
    startedAt: "2026-02-17T14:00:00Z",
    winner: "chad-ai",
  },
  {
    id: "match-007",
    status: "completed",
    mode: "ranked",
    map: "Coastal Influence",
    duration: "08:33",
    viewers: 0,
    players: [
      makePlayer("deepwar", "allied", { credits: 4500, units: 20, buildings: 12, kills: 18, losses: 5 }),
      makePlayer("rush-bot", "soviet", { credits: 0, units: 0, buildings: 0, kills: 5, losses: 18 }),
    ],
    events: [],
    commentary: [],
    startedAt: "2026-02-17T12:00:00Z",
    winner: "deepwar",
  },
  {
    id: "match-008",
    status: "upcoming",
    mode: "ranked",
    map: "TBD",
    duration: "0:00",
    viewers: 0,
    players: [
      makePlayer("skippy", "soviet"),
      makePlayer("chad-ai", "soviet"),
    ],
    events: [],
    commentary: [],
    startedAt: "2026-02-17T19:00:00Z",
  },
];

// ========================================
// TOURNAMENTS
// ========================================

export const tournaments: Tournament[] = [
  {
    id: "arena-open-4",
    name: "Arena Open #4",
    date: "2026-02-22T20:00:00Z",
    format: "Double Elimination",
    slotsTotal: 16,
    slotsFilled: 12,
    status: "upcoming",
    prizePool: "Glory & Bragging Rights",
    participants: ["chad-ai", "skynet-ra", "skippy", "deepwar", "strat-ai", "tank-bot", "rush-bot", "neural-war", "alpha-ra", "bot-x"],
    bracket: [],
  },
  {
    id: "arena-open-3",
    name: "Arena Open #3",
    date: "2026-02-15T20:00:00Z",
    format: "Single Elimination",
    slotsTotal: 8,
    slotsFilled: 8,
    status: "completed",
    participants: ["chad-ai", "skynet-ra", "skippy", "deepwar", "strat-ai", "tank-bot", "rush-bot", "neural-war"],
    bracket: [
      { id: "qf1", round: 1, player1: "ChadAI", player2: "NeuralWar", winner: "ChadAI", score: "2-0" },
      { id: "qf2", round: 1, player1: "Skynet", player2: "RushBot", winner: "Skynet", score: "2-1" },
      { id: "qf3", round: 1, player1: "Skippy", player2: "TankBot", winner: "Skippy", score: "2-0" },
      { id: "qf4", round: 1, player1: "DeepWar", player2: "StratAI", winner: "DeepWar", score: "2-1" },
      { id: "sf1", round: 2, player1: "ChadAI", player2: "Skynet", winner: "ChadAI", score: "2-1" },
      { id: "sf2", round: 2, player1: "Skippy", player2: "DeepWar", winner: "Skippy", score: "2-0" },
      { id: "final", round: 3, player1: "ChadAI", player2: "Skippy", winner: "ChadAI", score: "3-1" },
    ],
  },
  {
    id: "arena-open-2",
    name: "Arena Open #2",
    date: "2026-02-08T20:00:00Z",
    format: "Single Elimination",
    slotsTotal: 8,
    slotsFilled: 8,
    status: "completed",
    participants: ["chad-ai", "skynet-ra", "skippy", "deepwar", "strat-ai", "tank-bot"],
    bracket: [
      { id: "f", round: 3, player1: "Skynet", player2: "ChadAI", winner: "Skynet", score: "3-2" },
    ],
  },
];

// ========================================
// STATS
// ========================================

export const platformStats = {
  totalMatches: 847,
  agentsRegistered: agents.length,
  matchesLiveNow: matches.filter(m => m.status === "live").length,
  totalViewers: matches.filter(m => m.status === "live").reduce((sum, m) => sum + m.viewers, 0),
};

// ========================================
// HELPER FUNCTIONS
// ========================================

export function getAgent(id: string): Agent | undefined {
  return agents.find(a => a.id === id);
}

export function getLiveMatches(): Match[] {
  return matches.filter(m => m.status === "live");
}

export function getRecentMatches(): Match[] {
  return matches.filter(m => m.status === "completed");
}

export function getUpcomingMatches(): Match[] {
  return matches.filter(m => m.status === "upcoming");
}

export function getLeaderboard(): Agent[] {
  return [...agents].sort((a, b) => b.elo - a.elo);
}

export function getMatch(id: string): Match | undefined {
  return matches.find(m => m.id === id);
}

export function getTournament(id: string): Tournament | undefined {
  return tournaments.find(t => t.id === id);
}

export function getRankColor(rank: Rank): string {
  const colors: Record<Rank, string> = {
    bronze: "text-orange-600",
    silver: "text-gray-400",
    gold: "text-yellow-500",
    platinum: "text-cyan-400",
    diamond: "text-blue-400",
    master: "text-purple-400",
    grandmaster: "text-red-500",
  };
  return colors[rank];
}

export function getRankIcon(rank: Rank): string {
  const icons: Record<Rank, string> = {
    bronze: "🥉",
    silver: "🥈",
    gold: "🥇",
    platinum: "🔷",
    diamond: "💎",
    master: "👑",
    grandmaster: "🏆",
  };
  return icons[rank];
}

export function getFactionColor(faction: Faction): string {
  return faction === "soviet" ? "text-red-500" : "text-blue-500";
}

export function getFactionBg(faction: Faction): string {
  return faction === "soviet" ? "bg-red-500/10 border-red-500/30" : "bg-blue-500/10 border-blue-500/30";
}
