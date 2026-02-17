/**
 * Event Detector — watches game state diffs and identifies key moments.
 * 
 * This is the "eyes" of the broadcaster. It doesn't generate commentary —
 * it identifies WHAT happened and HOW important it is.
 */

export enum EventType {
  // Combat
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
  
  // Economy
  HARVESTER_KILLED = "harvester_killed",
  BROKE = "broke",
  
  // Tech
  TECH_UNLOCKED = "tech_unlocked",
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

export type Severity = "routine" | "notable" | "major" | "critical" | "legendary";

export interface GameEvent {
  type: EventType;
  severity: Severity;
  tick: number;
  description: string;
  players_involved: string[];
  context: Record<string, unknown>;
}

interface GameState {
  tick: number;
  is_game_over: boolean;
  summary: {
    credits: number;
    unit_count: number;
    building_count: number;
  };
  events?: Array<{
    type: string;
    actor_id: number;
    actor_type: string;
    attacker_type?: string;
    position?: number[];
  }>;
}

const HERO_UNITS = new Set(["3tnk", "4tnk", "mcv", "msub", "ca"]);
const SUPERWEAPONS = new Set(["mslo", "iron", "pdox"]);
const TECH_BUILDINGS = new Set(["atek", "stek", "dome"]);

export class EventDetector {
  private previousState: GameState | null = null;
  private hasSeenEnemy = false;
  private gameStartAnnounced = false;
  private lastEventTick = 0;
  private silenceTicks = 0;
  private previousArmyValue = 0;
  private previousEnemyArmyValue = 0;
  
  detect(state: GameState): GameEvent[] {
    const events: GameEvent[] = [];
    
    // Game start
    if (!this.gameStartAnnounced && state.tick > 0) {
      this.gameStartAnnounced = true;
      events.push({
        type: EventType.GAME_START,
        severity: "major",
        tick: state.tick,
        description: "The game has begun!",
        players_involved: [],
        context: {},
      });
    }
    
    // Game end
    if (state.is_game_over && this.previousState && !this.previousState.is_game_over) {
      events.push({
        type: EventType.GAME_END,
        severity: "legendary",
        tick: state.tick,
        description: "GAME OVER!",
        players_involved: [],
        context: {},
      });
    }
    
    // Process raw events from the ExternalBot
    if (state.events) {
      for (const rawEvent of state.events) {
        const detected = this.classifyRawEvent(rawEvent, state);
        if (detected) events.push(detected);
      }
    }
    
    // Detect state-based events (comparing to previous)
    if (this.previousState) {
      const stateEvents = this.detectStateChanges(this.previousState, state);
      events.push(...stateEvents);
    }
    
    // Track silence for filler generation
    if (events.length > 0) {
      this.lastEventTick = state.tick;
      this.silenceTicks = 0;
    } else {
      this.silenceTicks = state.tick - this.lastEventTick;
    }
    
    this.previousState = state;
    return events;
  }
  
  shouldGenerateFiller(): boolean {
    // Generate filler commentary if nothing has happened for ~10 seconds
    return this.silenceTicks > 250;
  }
  
  private classifyRawEvent(raw: any, state: GameState): GameEvent | null {
    switch (raw.type) {
      case "under_attack":
        // Check if it's a hero unit
        if (HERO_UNITS.has(raw.actor_type)) {
          return {
            type: EventType.HERO_UNIT_KILLED,
            severity: "critical",
            tick: state.tick,
            description: `${raw.actor_type} under attack by ${raw.attacker_type}!`,
            players_involved: [],
            context: { actor_type: raw.actor_type, attacker_type: raw.attacker_type },
          };
        }
        return {
          type: EventType.BASE_UNDER_ATTACK,
          severity: "notable",
          tick: state.tick,
          description: `Under attack!`,
          players_involved: [],
          context: raw,
        };
        
      default:
        return null;
    }
  }
  
  private detectStateChanges(prev: GameState, curr: GameState): GameEvent[] {
    const events: GameEvent[] = [];
    
    // Significant army loss (unit count dropped by >30% in a short time)
    if (prev.summary.unit_count > 5) {
      const lossPercent = 1 - (curr.summary.unit_count / prev.summary.unit_count);
      if (lossPercent > 0.3) {
        events.push({
          type: EventType.MAJOR_BATTLE,
          severity: "critical",
          tick: curr.tick,
          description: `Massive casualties! Lost ${Math.round(lossPercent * 100)}% of army!`,
          players_involved: [],
          context: { 
            previous_count: prev.summary.unit_count, 
            current_count: curr.summary.unit_count 
          },
        });
      }
    }
    
    // Went broke
    if (prev.summary.credits > 500 && curr.summary.credits === 0) {
      events.push({
        type: EventType.BROKE,
        severity: "notable",
        tick: curr.tick,
        description: "Credits depleted!",
        players_involved: [],
        context: {},
      });
    }
    
    // Building count change (significant construction or destruction)
    const buildingDiff = curr.summary.building_count - prev.summary.building_count;
    if (buildingDiff >= 2) {
      events.push({
        type: EventType.BUILDING_PLACED,
        severity: "routine",
        tick: curr.tick,
        description: `${buildingDiff} new buildings constructed`,
        players_involved: [],
        context: { count: buildingDiff },
      });
    } else if (buildingDiff <= -2) {
      events.push({
        type: EventType.BUILDING_DESTROYED,
        severity: "major",
        tick: curr.tick,
        description: `${Math.abs(buildingDiff)} buildings lost!`,
        players_involved: [],
        context: { count: Math.abs(buildingDiff) },
      });
    }
    
    return events;
  }
}
