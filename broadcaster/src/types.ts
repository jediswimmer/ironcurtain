/**
 * Shared types for the IronCurtain Broadcaster system.
 */

// ── Event Detection ─────────────────────────────────

export enum EventType {
  // Combat
  FIRST_UNIT_PRODUCED = "first_unit_produced",
  FIRST_CONTACT = "first_contact",
  SKIRMISH = "skirmish",
  BATTLE = "battle",
  MAJOR_BATTLE = "major_battle",
  MASSACRE = "massacre",
  HERO_UNIT_KILLED = "hero_unit_killed",

  // Base
  BUILDING_PLACED = "building_placed",
  BUILDING_DESTROYED = "building_destroyed",
  BASE_UNDER_ATTACK = "base_under_attack",
  BASE_BREACH = "base_breach",
  CONSTRUCTION_YARD_LOST = "conyard_lost",
  BASE_EXPANSION = "base_expansion",

  // Economy
  HARVESTER_KILLED = "harvester_killed",
  ORE_DEPLETED = "ore_depleted",
  BROKE = "broke",
  CASH_ADVANTAGE = "cash_advantage",

  // Tech
  TECH_UNLOCKED = "tech_unlocked",
  RADAR_ONLINE = "radar_online",
  TECH_CENTER_BUILT = "tech_center_built",
  NAVAL_YARD_BUILT = "naval_yard_built",
  SUPERWEAPON_BUILDING = "superweapon_building",
  SUPERWEAPON_READY = "superweapon_ready",
  SUPERWEAPON_LAUNCHED = "superweapon_launched",

  // Strategic
  EXPANSION = "expansion",
  FLANKING = "flanking",
  ALL_IN = "all_in",
  COMEBACK = "comeback",

  // Meta
  GAME_START = "game_start",
  GAME_END = "game_end",
  STALEMATE = "stalemate",
}

export type Severity = "routine" | "notable" | "exciting" | "critical" | "legendary";

export type GamePhase = "early" | "mid" | "late" | "climax";

export interface GameEvent {
  type: EventType;
  severity: Severity;
  tick: number;
  description: string;
  playersInvolved: string[];
  context: Record<string, unknown>;
  phase: GamePhase;
}

// ── Player State ────────────────────────────────────

export interface PlayerState {
  name: string;
  faction: "soviet" | "allied" | "unknown";
  credits: number;
  unitCount: number;
  buildingCount: number;
  kills: number;
  losses: number;
  powerState: "normal" | "low" | "critical";
  productionQueue: string[];
  isAlive: boolean;
}

export interface GameState {
  tick: number;
  isGameOver: boolean;
  winner?: string;
  players: Record<string, PlayerState>;
  events?: RawGameEvent[];
  mapName?: string;
  mapSize?: [number, number];
}

export interface RawGameEvent {
  type: string;
  player?: string;
  actorId?: number;
  actorType?: string;
  attackerType?: string;
  attackerPlayer?: string;
  position?: [number, number];
  targetPlayer?: string;
  amount?: number;
}

// ── Commentary ──────────────────────────────────────

export type CommentaryStyle = "esports" | "war_correspondent" | "skippy_trash_talk" | "documentary";

export type Emotion = "excited" | "tense" | "smug" | "awed" | "neutral" | "panicked" | "somber" | "amused";

export type SpeechSpeed = "slow" | "normal" | "fast" | "frantic";

export interface CommentaryChunk {
  text: string;
  priority: Severity;
  emotion: Emotion;
  speed: SpeechSpeed;
  tick: number;
  eventType?: EventType;
}

// ── TTS ─────────────────────────────────────────────

export type TTSBackend = "elevenlabs" | "openai" | "local";

export interface VoiceConfig {
  backend: TTSBackend;
  voiceId: string;
  voiceName: string;
  stability: number;
  similarityBoost: number;
  style: number;
  baseSpeed: number;
}

// ── Style Definition ────────────────────────────────

export interface PacingRules {
  minGapTicks: Record<Severity, number>;
  maxSilenceTicks: number;
  maxConsecutiveRoutine: number;
  cooldownAfterLegendary: number;
}

export interface StyleDefinition {
  name: CommentaryStyle;
  displayName: string;
  description: string;
  systemPrompt: string;
  voice: VoiceConfig;
  pacing: PacingRules;
  vocabulary: {
    unitTerms: Record<string, string>;
    battleTerms: string[];
    exclamations: string[];
    fillerPhrases: string[];
  };
  emotionMap: Partial<Record<EventType, Emotion>>;
  speedMap: Partial<Record<Severity, SpeechSpeed>>;
}

// ── Overlay ─────────────────────────────────────────

export interface OverlayState {
  type: "state";
  data: GameState;
}

export interface OverlaySubtitle {
  type: "subtitle";
  text: string;
  emotion: Emotion;
  priority: Severity;
}

export interface OverlayKillFeed {
  type: "killfeed";
  killer: string;
  killerUnit: string;
  victim: string;
  victimUnit: string;
  timestamp: number;
}

export interface OverlayEvent {
  type: "event";
  eventType: EventType;
  severity: Severity;
  text: string;
}

export type OverlayMessage = OverlayState | OverlaySubtitle | OverlayKillFeed | OverlayEvent;
