/**
 * Event Detector — watches game state diffs and identifies key moments.
 *
 * This is the "eyes" of the broadcaster. It doesn't generate commentary —
 * it identifies WHAT happened and HOW important it is.
 *
 * Tracks game narrative arc and adapts detection thresholds accordingly.
 */

import {
  EventType,
  Severity,
  GamePhase,
  GameEvent,
  GameState,
  PlayerState,
  RawGameEvent,
} from "./types.js";

// ── Constants ───────────────────────────────────────

const TICKS_PER_SECOND = 25;

const HERO_UNITS = new Set(["4tnk", "mcv", "msub", "ca", "ttnk", "ctnk"]);
const SUPERWEAPON_BUILDINGS = new Set(["mslo", "iron", "pdox"]);
const TECH_BUILDINGS = new Set(["atek", "stek", "dome"]);
const RADAR_BUILDINGS = new Set(["dome", "hq"]);
const NAVAL_BUILDINGS = new Set(["syrd", "spen"]);
const EXPENSIVE_BUILDINGS = new Set(["weap", "afld", "fact", "tent", "hpad", "atek", "stek"]);

/** Game phase thresholds in ticks */
const PHASE_THRESHOLDS = {
  early: 0,
  mid: 5 * 60 * TICKS_PER_SECOND,      // 5 minutes
  late: 12 * 60 * TICKS_PER_SECOND,     // 12 minutes
  climax: 20 * 60 * TICKS_PER_SECOND,   // 20 minutes (or triggered by events)
};

// ── Per-player tracking ─────────────────────────────

interface PlayerTracker {
  name: string;
  peakUnits: number;
  peakBuildings: number;
  peakCredits: number;
  hasProducedUnit: boolean;
  hasTechCenter: boolean;
  hasRadar: boolean;
  hasNavalYard: boolean;
  hasSuperweapon: boolean;
  superweaponReady: boolean;
  lastCreditAmount: number;
  consecutiveBrokeChecks: number;
  isAlive: boolean;
}

// ── Main Class ──────────────────────────────────────

export class EventDetector {
  private previousState: GameState | null = null;
  private playerTrackers: Map<string, PlayerTracker> = new Map();
  private gameStartAnnounced = false;
  private gameEndAnnounced = false;
  private firstContactOccurred = false;
  private lastEventTick = 0;
  private silenceTicks = 0;
  private phase: GamePhase = "early";
  private killLog: Array<{ tick: number; killer: string; victim: string }> = [];
  private climaxTriggered = false;

  /** Process a new game state and return detected events. */
  detect(state: GameState): GameEvent[] {
    const events: GameEvent[] = [];

    // Update game phase
    this.updatePhase(state);

    // Initialize player trackers
    this.ensureTrackers(state);

    // ── Meta events ─────────────────────────────────

    if (!this.gameStartAnnounced && state.tick > 0) {
      this.gameStartAnnounced = true;
      events.push(this.makeEvent(EventType.GAME_START, "legendary", state.tick,
        "The game has begun!", Object.keys(state.players), {
          mapName: state.mapName,
          playerCount: Object.keys(state.players).length,
          players: Object.entries(state.players).map(([n, p]) => ({
            name: n, faction: p.faction,
          })),
        }));
    }

    if (state.isGameOver && !this.gameEndAnnounced) {
      this.gameEndAnnounced = true;
      events.push(this.makeEvent(EventType.GAME_END, "legendary", state.tick,
        `GAME OVER! ${state.winner ? `${state.winner} wins!` : ""}`,
        Object.keys(state.players), {
          winner: state.winner,
          duration: this.ticksToTime(state.tick),
        }));
    }

    // ── Raw event classification ────────────────────

    if (state.events) {
      for (const raw of state.events) {
        const detected = this.classifyRawEvent(raw, state);
        if (detected) events.push(detected);
      }
    }

    // ── State diff detection ────────────────────────

    if (this.previousState) {
      events.push(...this.detectStateChanges(this.previousState, state));
    }

    // ── Narrative arc events ────────────────────────

    events.push(...this.detectNarrativeEvents(state));

    // ── Silence tracking ────────────────────────────

    if (events.length > 0) {
      this.lastEventTick = state.tick;
      this.silenceTicks = 0;
    } else {
      this.silenceTicks = state.tick - this.lastEventTick;
    }

    this.previousState = state;
    return events;
  }

  /** Whether the broadcaster should generate filler commentary. */
  shouldGenerateFiller(): boolean {
    return this.silenceTicks > 250;
  }

  /** Current game phase for context. */
  getPhase(): GamePhase {
    return this.phase;
  }

  /** Get current game phase and narrative state for commentary context. */
  getNarrativeContext(): {
    phase: GamePhase;
    leadingPlayer: string | null;
    killCount: number;
    minutesElapsed: number;
  } {
    const prev = this.previousState;
    if (!prev) return { phase: this.phase, leadingPlayer: null, killCount: 0, minutesElapsed: 0 };

    let leadingPlayer: string | null = null;
    let maxScore = -1;
    for (const [name, p] of Object.entries(prev.players)) {
      const score = p.unitCount + p.buildingCount * 2 + p.kills * 3;
      if (score > maxScore) {
        maxScore = score;
        leadingPlayer = name;
      }
    }

    return {
      phase: this.phase,
      leadingPlayer,
      killCount: this.killLog.length,
      minutesElapsed: Math.floor((prev.tick / TICKS_PER_SECOND) / 60),
    };
  }

  // ── Private methods ─────────────────────────────────

  private updatePhase(state: GameState): void {
    if (this.climaxTriggered) {
      this.phase = "climax";
      return;
    }
    if (state.tick >= PHASE_THRESHOLDS.climax) this.phase = "climax";
    else if (state.tick >= PHASE_THRESHOLDS.late) this.phase = "late";
    else if (state.tick >= PHASE_THRESHOLDS.mid) this.phase = "mid";
    else this.phase = "early";
  }

  private ensureTrackers(state: GameState): void {
    for (const [name, player] of Object.entries(state.players)) {
      if (!this.playerTrackers.has(name)) {
        this.playerTrackers.set(name, {
          name,
          peakUnits: 0,
          peakBuildings: 0,
          peakCredits: 0,
          hasProducedUnit: false,
          hasTechCenter: false,
          hasRadar: false,
          hasNavalYard: false,
          hasSuperweapon: false,
          superweaponReady: false,
          lastCreditAmount: player.credits,
          consecutiveBrokeChecks: 0,
          isAlive: true,
        });
      }
      const tracker = this.playerTrackers.get(name)!;
      tracker.peakUnits = Math.max(tracker.peakUnits, player.unitCount);
      tracker.peakBuildings = Math.max(tracker.peakBuildings, player.buildingCount);
      tracker.peakCredits = Math.max(tracker.peakCredits, player.credits);
      tracker.isAlive = player.isAlive;
    }
  }

  private classifyRawEvent(raw: RawGameEvent, state: GameState): GameEvent | null {
    const player = raw.player ?? "Unknown";

    switch (raw.type) {
      case "unit_destroyed": {
        // Track kills
        if (raw.attackerPlayer && raw.player) {
          this.killLog.push({
            tick: state.tick,
            killer: raw.attackerPlayer,
            victim: raw.player,
          });
        }

        if (raw.actorType && HERO_UNITS.has(raw.actorType)) {
          return this.makeEvent(EventType.HERO_UNIT_KILLED, "critical", state.tick,
            `${player}'s ${raw.actorType} destroyed by ${raw.attackerType ?? "enemy fire"}!`,
            [player, raw.attackerPlayer ?? ""].filter(Boolean),
            { unitType: raw.actorType, attackerType: raw.attackerType });
        }

        if (raw.actorType === "harv") {
          return this.makeEvent(EventType.HARVESTER_KILLED, "notable", state.tick,
            `${player}'s harvester destroyed!`,
            [player, raw.attackerPlayer ?? ""].filter(Boolean),
            { attackerType: raw.attackerType });
        }

        return null; // Individual unit kills handled by batch detection
      }

      case "building_destroyed": {
        const severity: Severity = EXPENSIVE_BUILDINGS.has(raw.actorType ?? "")
          ? "exciting" : "notable";

        // Construction yard loss is critical
        if (raw.actorType === "fact" || raw.actorType === "tent") {
          this.climaxTriggered = true;
          return this.makeEvent(EventType.CONSTRUCTION_YARD_LOST, "critical", state.tick,
            `${player}'s Construction Yard DESTROYED!`,
            [player, raw.attackerPlayer ?? ""].filter(Boolean),
            { buildingType: raw.actorType });
        }

        return this.makeEvent(EventType.BUILDING_DESTROYED, severity, state.tick,
          `${player}'s ${raw.actorType} destroyed!`,
          [player, raw.attackerPlayer ?? ""].filter(Boolean),
          { buildingType: raw.actorType, attackerType: raw.attackerType });
      }

      case "building_complete": {
        if (raw.actorType && SUPERWEAPON_BUILDINGS.has(raw.actorType)) {
          const tracker = this.playerTrackers.get(player);
          if (tracker) tracker.hasSuperweapon = true;
          return this.makeEvent(EventType.SUPERWEAPON_BUILDING, "critical", state.tick,
            `${player} has built a superweapon: ${raw.actorType}!`,
            [player], { buildingType: raw.actorType });
        }

        if (raw.actorType && TECH_BUILDINGS.has(raw.actorType)) {
          const tracker = this.playerTrackers.get(player);
          if (tracker) tracker.hasTechCenter = true;
          return this.makeEvent(EventType.TECH_CENTER_BUILT, "exciting", state.tick,
            `${player} has a Tech Center — high-tier units incoming!`,
            [player], { buildingType: raw.actorType });
        }

        if (raw.actorType && RADAR_BUILDINGS.has(raw.actorType)) {
          const tracker = this.playerTrackers.get(player);
          if (tracker) tracker.hasRadar = true;
          return this.makeEvent(EventType.RADAR_ONLINE, "notable", state.tick,
            `${player}'s radar is now online.`,
            [player], { buildingType: raw.actorType });
        }

        if (raw.actorType && NAVAL_BUILDINGS.has(raw.actorType)) {
          const tracker = this.playerTrackers.get(player);
          if (tracker) tracker.hasNavalYard = true;
          return this.makeEvent(EventType.NAVAL_YARD_BUILT, "notable", state.tick,
            `${player} goes naval — shipyard operational!`,
            [player], { buildingType: raw.actorType });
        }

        return this.makeEvent(EventType.BUILDING_PLACED, "routine", state.tick,
          `${player} builds ${raw.actorType}.`,
          [player], { buildingType: raw.actorType });
      }

      case "under_attack": {
        if (raw.actorType && HERO_UNITS.has(raw.actorType)) {
          return this.makeEvent(EventType.BASE_UNDER_ATTACK, "exciting", state.tick,
            `${player}'s ${raw.actorType} under attack by ${raw.attackerType}!`,
            [player, raw.attackerPlayer ?? ""].filter(Boolean),
            { actorType: raw.actorType, attackerType: raw.attackerType });
        }
        return this.makeEvent(EventType.BASE_UNDER_ATTACK, "notable", state.tick,
          `${player}'s base is under attack!`,
          [player, raw.attackerPlayer ?? ""].filter(Boolean),
          { actorType: raw.actorType, attackerType: raw.attackerType });
      }

      case "superweapon_ready": {
        const tracker = this.playerTrackers.get(player);
        if (tracker) tracker.superweaponReady = true;
        return this.makeEvent(EventType.SUPERWEAPON_READY, "critical", state.tick,
          `${player}'s superweapon is CHARGED and ready to fire!`,
          [player], { weaponType: raw.actorType });
      }

      case "superweapon_launched": {
        return this.makeEvent(EventType.SUPERWEAPON_LAUNCHED, "legendary", state.tick,
          `${player} has LAUNCHED their superweapon at ${raw.targetPlayer ?? "the enemy"}!`,
          [player, raw.targetPlayer ?? ""].filter(Boolean),
          { weaponType: raw.actorType, target: raw.position });
      }

      default:
        return null;
    }
  }

  private detectStateChanges(prev: GameState, curr: GameState): GameEvent[] {
    const events: GameEvent[] = [];

    for (const [name, currPlayer] of Object.entries(curr.players)) {
      const prevPlayer = prev.players[name];
      if (!prevPlayer) continue;

      const tracker = this.playerTrackers.get(name);
      if (!tracker) continue;

      // ── First unit produced ───────────────────────

      if (!tracker.hasProducedUnit && currPlayer.unitCount > 0 && prevPlayer.unitCount === 0) {
        tracker.hasProducedUnit = true;
        events.push(this.makeEvent(EventType.FIRST_UNIT_PRODUCED, "notable", curr.tick,
          `${name} produces their first unit!`,
          [name], { unitCount: currPlayer.unitCount }));
      }

      // ── Significant army loss (>30% in one update) ─

      if (prevPlayer.unitCount > 5) {
        const lossPercent = 1 - (currPlayer.unitCount / prevPlayer.unitCount);
        if (lossPercent > 0.5) {
          events.push(this.makeEvent(EventType.MASSACRE, "critical", curr.tick,
            `${name} just lost ${Math.round(lossPercent * 100)}% of their army! Devastating losses!`,
            [name], {
              previousCount: prevPlayer.unitCount,
              currentCount: currPlayer.unitCount,
              lostCount: prevPlayer.unitCount - currPlayer.unitCount,
            }));
        } else if (lossPercent > 0.3) {
          events.push(this.makeEvent(EventType.MAJOR_BATTLE, "exciting", curr.tick,
            `${name} takes heavy casualties — ${prevPlayer.unitCount - currPlayer.unitCount} units lost!`,
            [name], {
              previousCount: prevPlayer.unitCount,
              currentCount: currPlayer.unitCount,
            }));
        }
      }

      // ── Went broke ────────────────────────────────

      if (prevPlayer.credits > 500 && currPlayer.credits === 0) {
        events.push(this.makeEvent(EventType.BROKE, "notable", curr.tick,
          `${name}'s coffers are EMPTY!`,
          [name], { previousCredits: prevPlayer.credits }));
      }

      // ── Buildings lost in bulk ────────────────────

      const buildingDiff = currPlayer.buildingCount - prevPlayer.buildingCount;
      if (buildingDiff <= -3) {
        events.push(this.makeEvent(EventType.BASE_BREACH, "critical", curr.tick,
          `${name}'s base is crumbling — ${Math.abs(buildingDiff)} buildings destroyed!`,
          [name], { lost: Math.abs(buildingDiff) }));
      }

      // ── Player eliminated ─────────────────────────

      if (prevPlayer.isAlive && !currPlayer.isAlive) {
        events.push(this.makeEvent(EventType.GAME_END, "legendary", curr.tick,
          `${name} has been ELIMINATED!`,
          [name], { eliminatedPlayer: name }));
      }

      // ── Track credits for economy events ──────────

      tracker.lastCreditAmount = currPlayer.credits;
    }

    // ── First contact detection ─────────────────────
    // Both players lose units at roughly the same time
    if (!this.firstContactOccurred) {
      const recentKills = this.killLog.filter(k => curr.tick - k.tick < 75);
      const playersInvolved = new Set(recentKills.map(k => k.killer));
      if (playersInvolved.size >= 2) {
        this.firstContactOccurred = true;
        events.push(this.makeEvent(EventType.FIRST_CONTACT, "exciting", curr.tick,
          "FIRST CONTACT! The armies have engaged!",
          [...playersInvolved], { kills: recentKills.length }));
      }
    }

    // ── Cash advantage detection ────────────────────

    const players = Object.entries(curr.players);
    if (players.length === 2) {
      const [p1Name, p1] = players[0];
      const [p2Name, p2] = players[1];

      if (p1.credits > 5000 && p2.credits < 500) {
        events.push(this.makeEvent(EventType.CASH_ADVANTAGE, "notable", curr.tick,
          `${p1Name} has a massive economic advantage — ${p1.credits} credits vs ${p2.credits}!`,
          [p1Name, p2Name], { rich: p1Name, poor: p2Name }));
      } else if (p2.credits > 5000 && p1.credits < 500) {
        events.push(this.makeEvent(EventType.CASH_ADVANTAGE, "notable", curr.tick,
          `${p2Name} has a massive economic advantage — ${p2.credits} credits vs ${p1.credits}!`,
          [p1Name, p2Name], { rich: p2Name, poor: p1Name }));
      }
    }

    return events;
  }

  private detectNarrativeEvents(state: GameState): GameEvent[] {
    const events: GameEvent[] = [];
    const players = Object.entries(state.players);
    if (players.length < 2) return events;

    // ── Comeback detection ──────────────────────────
    // Player who was behind in units now has more
    if (this.previousState) {
      for (const [name, curr] of players) {
        const prev = this.previousState.players[name];
        const tracker = this.playerTrackers.get(name);
        if (!prev || !tracker) continue;

        // Was at <50% of peak army, now growing
        const wasDepleted = prev.unitCount < tracker.peakUnits * 0.5;
        const isRebounding = curr.unitCount > prev.unitCount * 1.3 && curr.unitCount > 5;

        if (wasDepleted && isRebounding && this.phase !== "early") {
          events.push(this.makeEvent(EventType.COMEBACK, "exciting", state.tick,
            `${name} is mounting a COMEBACK! Army rebuilding from the ashes!`,
            [name], {
              currentUnits: curr.unitCount,
              peakUnits: tracker.peakUnits,
            }));
        }
      }
    }

    // ── Stalemate detection ─────────────────────────

    if (this.phase === "late" && this.silenceTicks > 500) {
      events.push(this.makeEvent(EventType.STALEMATE, "notable", state.tick,
        "A standoff... neither side willing to commit. Who blinks first?",
        Object.keys(state.players), { silenceTicks: this.silenceTicks }));
    }

    return events;
  }

  private makeEvent(
    type: EventType,
    severity: Severity,
    tick: number,
    description: string,
    playersInvolved: string[],
    context: Record<string, unknown>,
  ): GameEvent {
    return {
      type,
      severity,
      tick,
      description,
      playersInvolved,
      context,
      phase: this.phase,
    };
  }

  private ticksToTime(ticks: number): string {
    const totalSeconds = Math.floor(ticks / TICKS_PER_SECOND);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
}
