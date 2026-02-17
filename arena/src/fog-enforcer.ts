/**
 * Fog Enforcer — Server-authoritative fog of war filtering.
 *
 * THE MOST CRITICAL ANTI-CHEAT COMPONENT.
 *
 * Sits between the full game state (from OpenRA ExternalBot, which sees everything)
 * and what each agent receives. Each agent ONLY gets state that their units can see.
 *
 * The agent NEVER connects directly to the game — always through this filter.
 *
 * Additionally enforces:
 *   - APM rate limiting (configurable caps)
 *   - Command validation (no impossible orders)
 *   - Suspicious activity logging
 */

// ─── Full Game State (from OpenRA) ──────────────────────

export interface FullGameState {
  tick: number;
  game_time: string;
  players: PlayerState[];
  all_units: UnitState[];
  all_buildings: BuildingState[];
  ore_fields: OreField[];
  map: MapInfo;
}

export interface PlayerState {
  player_id: string;
  agent_id: string;
  credits: number;
  power: { generated: number; consumed: number };
  shroud: ShroudState;
}

export interface ShroudState {
  visible_cells: Set<string>;     // Currently visible (units have LOS)
  explored_cells: Set<string>;    // Ever seen (fog of war, not shroud)
}

export interface UnitState {
  id: number;
  type: string;
  owner_id: string;
  position: [number, number];
  health: number;
  max_health: number;
  is_idle: boolean;
  activity?: string;
}

export interface BuildingState {
  id: number;
  type: string;
  owner_id: string;
  position: [number, number];
  health: number;
  max_health: number;
  production_queue?: Array<{ type: string; progress: number }>;
  rally_point?: [number, number];
  is_primary?: boolean;
}

export interface OreField {
  center: [number, number];
  type: "ore" | "gems";
}

export interface MapInfo {
  name: string;
  size: [number, number];
  total_cells: number;
}

// ─── Fog-Filtered State (sent to agents) ────────────────

export interface FogFilteredState {
  tick: number;
  game_time: string;
  own: {
    credits: number;
    power: { generated: number; consumed: number };
    units: OwnUnitView[];
    buildings: OwnBuildingView[];
    explored_percentage: number;
  };
  enemy: {
    visible_units: EnemyUnitView[];
    visible_buildings: EnemyBuildingView[];
    frozen_actors: FrozenActorView[];
  };
  map: {
    name: string;
    size: [number, number];
    known_ore_fields: OreField[];
  };
}

export interface OwnUnitView {
  id: number;
  type: string;
  position: [number, number];
  health: number;
  max_health: number;
  is_idle: boolean;
}

export interface OwnBuildingView {
  id: number;
  type: string;
  position: [number, number];
  health: number;
  max_health: number;
  production_queue?: Array<{ type: string; progress: number }>;
  rally_point?: [number, number];
  is_primary?: boolean;
}

// Enemy views — REDUCED information (only what you can see)
export interface EnemyUnitView {
  id: number;
  type: string;
  position: [number, number];
  health_percent: number;
  // NO: exact HP, activity, idle state, production info
}

export interface EnemyBuildingView {
  id: number;
  type: string;
  position: [number, number];
  health_percent: number;
  // NO: production queue, rally point, primary status
}

export interface FrozenActorView {
  id: number;
  type: string;
  position: [number, number];
  last_seen_tick: number;
}

// ─── APM Limiting ───────────────────────────────────────

export interface ApmProfile {
  name: string;
  max_apm: number;
  max_orders_per_tick: number;
  min_ms_between_orders: number;
  max_simultaneous_unit_commands: number;
  description: string;
}

export const APM_PROFILES: Record<string, ApmProfile> = {
  human_like: {
    name: "Human-Like",
    max_apm: 200,
    max_orders_per_tick: 3,
    min_ms_between_orders: 50,
    max_simultaneous_unit_commands: 12,
    description: "Simulates realistic human APM. For fair AI-vs-human matches.",
  },
  competitive: {
    name: "Competitive",
    max_apm: 600,
    max_orders_per_tick: 8,
    min_ms_between_orders: 10,
    max_simultaneous_unit_commands: 50,
    description: "Higher APM for AI-vs-AI competitive play. Still has limits.",
  },
  unlimited: {
    name: "Unlimited",
    max_apm: Infinity,
    max_orders_per_tick: 100,
    min_ms_between_orders: 0,
    max_simultaneous_unit_commands: Infinity,
    description: "No restrictions. For benchmarking and exhibitions only.",
  },
};

// ─── Game Order Validation ──────────────────────────────

export interface GameOrder {
  type: string;
  unit_ids?: number[];
  building_id?: number;
  target?: [number, number];
  target_id?: number;
  build_type?: string;
  count?: number;
  queued?: boolean;
}

const VALID_ORDER_TYPES = new Set([
  "move", "attack", "attack_move", "deploy", "build", "train",
  "sell", "repair", "set_rally", "stop", "scatter", "use_power",
  "guard", "patrol",
]);

// ─── Suspicious Activity Log ────────────────────────────

export interface SuspiciousEvent {
  timestamp: number;
  agent_id: string;
  match_id: string;
  event_type: string;
  details: string;
  severity: "low" | "medium" | "high";
}

// ─── Fog Enforcer ───────────────────────────────────────

export class FogEnforcer {
  private frozenActors = new Map<string, Map<number, FrozenActorView>>();
  private apmTrackers = new Map<string, ApmTracker>();
  private suspiciousLog: SuspiciousEvent[] = [];

  /**
   * Filter full game state down to what a specific agent can see.
   * This is THE anti-cheat mechanism.
   */
  filterForAgent(full: FullGameState, agentId: string): FogFilteredState {
    const player = full.players.find(p => p.agent_id === agentId);
    if (!player) throw new Error(`Agent ${agentId} not found in game state`);

    const shroud = player.shroud;

    const isVisible = (pos: [number, number]) =>
      shroud.visible_cells.has(`${pos[0]},${pos[1]}`);

    const isExplored = (pos: [number, number]) =>
      shroud.explored_cells.has(`${pos[0]},${pos[1]}`);

    // Own units — full visibility
    const ownUnits: OwnUnitView[] = full.all_units
      .filter(u => u.owner_id === player.player_id)
      .map(u => ({
        id: u.id,
        type: u.type,
        position: u.position,
        health: u.health,
        max_health: u.max_health,
        is_idle: u.is_idle,
      }));

    // Own buildings — full visibility including production
    const ownBuildings: OwnBuildingView[] = full.all_buildings
      .filter(b => b.owner_id === player.player_id)
      .map(b => ({
        id: b.id,
        type: b.type,
        position: b.position,
        health: b.health,
        max_health: b.max_health,
        production_queue: b.production_queue,
        rally_point: b.rally_point,
        is_primary: b.is_primary,
      }));

    // Enemy units — ONLY if visible (the critical filter)
    const visibleEnemyUnits: EnemyUnitView[] = full.all_units
      .filter(u => u.owner_id !== player.player_id)
      .filter(u => isVisible(u.position))
      .map(u => ({
        id: u.id,
        type: u.type,
        position: u.position,
        health_percent: Math.round((u.health / u.max_health) * 100),
      }));

    // Enemy buildings — ONLY if visible
    const visibleEnemyBuildings: EnemyBuildingView[] = full.all_buildings
      .filter(b => b.owner_id !== player.player_id)
      .filter(b => isVisible(b.position))
      .map(b => ({
        id: b.id,
        type: b.type,
        position: b.position,
        health_percent: Math.round((b.health / b.max_health) * 100),
      }));

    // Update frozen actors
    this.updateFrozenActors(agentId, full, player, isVisible);
    const frozen = Array.from(
      (this.frozenActors.get(agentId) ?? new Map()).values()
    );

    // Ore fields — only explored ones
    const knownOre = full.ore_fields.filter(o => isExplored(o.center));

    return {
      tick: full.tick,
      game_time: full.game_time,
      own: {
        credits: player.credits,
        power: player.power,
        units: ownUnits,
        buildings: ownBuildings,
        explored_percentage:
          (shroud.explored_cells.size / full.map.total_cells) * 100,
      },
      enemy: {
        visible_units: visibleEnemyUnits,
        visible_buildings: visibleEnemyBuildings,
        frozen_actors: frozen,
      },
      map: {
        name: full.map.name,
        size: full.map.size,
        known_ore_fields: knownOre,
      },
    };
  }

  /**
   * Validate and rate-limit orders from an agent.
   * Returns filtered orders (invalid ones removed) and any violations.
   */
  validateOrders(
    agentId: string,
    matchId: string,
    orders: GameOrder[],
    ownState: FogFilteredState,
    profile: ApmProfile = APM_PROFILES.competitive
  ): { valid: GameOrder[]; violations: string[] } {
    const violations: string[] = [];
    const valid: GameOrder[] = [];

    // APM check
    const tracker = this.getApmTracker(agentId, profile);
    const apmResult = tracker.checkBatch(orders.length);
    if (!apmResult.allowed) {
      violations.push(`APM limit: ${apmResult.reason}`);
      this.logSuspicious(agentId, matchId, "apm_exceeded", apmResult.reason ?? "APM exceeded", "medium");
      return { valid: [], violations };
    }

    const ownUnitIds = new Set(ownState.own.units.map(u => u.id));
    const ownBuildingIds = new Set(ownState.own.buildings.map(b => b.id));

    for (const order of orders) {
      // Validate order type
      if (!VALID_ORDER_TYPES.has(order.type)) {
        violations.push(`Invalid order type: ${order.type}`);
        this.logSuspicious(agentId, matchId, "invalid_order_type", order.type, "low");
        continue;
      }

      // Validate unit ownership — agents can only command their own units
      if (order.unit_ids) {
        const invalidUnits = order.unit_ids.filter(id => !ownUnitIds.has(id));
        if (invalidUnits.length > 0) {
          violations.push(`Cannot command units you don't own: ${invalidUnits.join(", ")}`);
          this.logSuspicious(
            agentId, matchId, "foreign_unit_command",
            `Tried to command units: ${invalidUnits.join(", ")}`, "high"
          );
          continue;
        }

        // Check simultaneous command limit
        if (order.unit_ids.length > profile.max_simultaneous_unit_commands) {
          violations.push(
            `Too many units in one command (${order.unit_ids.length}). ` +
            `Max: ${profile.max_simultaneous_unit_commands}`
          );
          continue;
        }
      }

      // Validate building ownership
      if (order.building_id !== undefined && !ownBuildingIds.has(order.building_id)) {
        violations.push(`Cannot command building you don't own: ${order.building_id}`);
        this.logSuspicious(
          agentId, matchId, "foreign_building_command",
          `Tried to command building: ${order.building_id}`, "high"
        );
        continue;
      }

      // Validate target position is within map bounds
      if (order.target) {
        const [x, y] = order.target;
        const [mapW, mapH] = ownState.map.size;
        if (x < 0 || y < 0 || x >= mapW || y >= mapH) {
          violations.push(`Target position out of bounds: [${x}, ${y}]`);
          continue;
        }
      }

      // Validate production count
      if (order.count !== undefined && (order.count < 1 || order.count > 20)) {
        violations.push(`Invalid production count: ${order.count}`);
        continue;
      }

      valid.push(order);
    }

    return { valid, violations };
  }

  /**
   * Get suspicious activity log for a match.
   */
  getSuspiciousEvents(matchId?: string): SuspiciousEvent[] {
    if (matchId) {
      return this.suspiciousLog.filter(e => e.match_id === matchId);
    }
    return [...this.suspiciousLog];
  }

  /**
   * Clean up state for a finished match.
   */
  cleanupMatch(agentId: string): void {
    this.frozenActors.delete(agentId);
    this.apmTrackers.delete(agentId);
  }

  // ─── Private ────────────────────────────────────────────

  private updateFrozenActors(
    agentId: string,
    full: FullGameState,
    player: PlayerState,
    isVisible: (pos: [number, number]) => boolean
  ): void {
    if (!this.frozenActors.has(agentId)) {
      this.frozenActors.set(agentId, new Map());
    }
    const frozen = this.frozenActors.get(agentId)!;

    const allEnemies = [
      ...full.all_units.filter(u => u.owner_id !== player.player_id),
      ...full.all_buildings.filter(b => b.owner_id !== player.player_id),
    ];

    for (const entity of allEnemies) {
      if (isVisible(entity.position)) {
        frozen.set(entity.id, {
          id: entity.id,
          type: entity.type,
          position: entity.position,
          last_seen_tick: full.tick,
        });
      }
    }

    // Remove frozen actors confirmed destroyed (visible cell, no entity)
    const aliveIds = new Set(allEnemies.map(e => e.id));
    for (const [id, actor] of frozen) {
      if (!aliveIds.has(id) && isVisible(actor.position)) {
        frozen.delete(id);
      }
    }
  }

  private getApmTracker(agentId: string, profile: ApmProfile): ApmTracker {
    let tracker = this.apmTrackers.get(agentId);
    if (!tracker) {
      tracker = new ApmTracker(profile);
      this.apmTrackers.set(agentId, tracker);
    }
    return tracker;
  }

  private logSuspicious(
    agentId: string,
    matchId: string,
    eventType: string,
    details: string,
    severity: "low" | "medium" | "high"
  ): void {
    const event: SuspiciousEvent = {
      timestamp: Date.now(),
      agent_id: agentId,
      match_id: matchId,
      event_type: eventType,
      details,
      severity,
    };
    this.suspiciousLog.push(event);

    // Keep log bounded
    if (this.suspiciousLog.length > 10_000) {
      this.suspiciousLog = this.suspiciousLog.slice(-5_000);
    }

    if (severity === "high") {
      console.warn(`🚨 SUSPICIOUS [${agentId}] ${eventType}: ${details}`);
    }
  }
}

// ─── APM Tracker (per agent) ────────────────────────────

class ApmTracker {
  private profile: ApmProfile;
  private orderTimestamps: number[] = [];
  private lastOrderTime = 0;

  constructor(profile: ApmProfile) {
    this.profile = profile;
  }

  checkBatch(orderCount: number): { allowed: boolean; reason?: string } {
    const now = Date.now();

    // Minimum gap between order batches
    if (now - this.lastOrderTime < this.profile.min_ms_between_orders) {
      return {
        allowed: false,
        reason: `Too fast. Min ${this.profile.min_ms_between_orders}ms between order batches.`,
      };
    }

    // Per-tick cap
    if (orderCount > this.profile.max_orders_per_tick) {
      return {
        allowed: false,
        reason: `Too many orders (${orderCount}). Max ${this.profile.max_orders_per_tick} per tick.`,
      };
    }

    // Rolling APM (last 60 seconds)
    const oneMinuteAgo = now - 60_000;
    this.orderTimestamps = this.orderTimestamps.filter(t => t > oneMinuteAgo);

    if (this.orderTimestamps.length + orderCount > this.profile.max_apm) {
      return {
        allowed: false,
        reason: `APM limit reached (${this.profile.max_apm}/min).`,
      };
    }

    // Record
    for (let i = 0; i < orderCount; i++) {
      this.orderTimestamps.push(now);
    }
    this.lastOrderTime = now;

    return { allowed: true };
  }
}
