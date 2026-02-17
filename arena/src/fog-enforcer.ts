/**
 * Fog Enforcer — Server-authoritative fog of war filtering.
 * 
 * THE MOST CRITICAL ANTI-CHEAT COMPONENT.
 * 
 * Sits between the full game state (from OpenRA ExternalBot, which sees everything)
 * and what each agent receives. Each agent ONLY gets state that their units can see.
 * 
 * The agent NEVER connects directly to the game — always through this filter.
 */

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

// Enemy units — REDUCED information (only what you can see)
export interface EnemyUnitView {
  id: number;
  type: string;
  position: [number, number];
  health_percent: number;       // Only approximate (health bar)
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

export class FogEnforcer {
  private frozenActors: Map<string, Map<number, FrozenActorView>> = new Map();
  
  /**
   * Filter full game state down to what a specific agent can see.
   * This is THE anti-cheat mechanism.
   */
  filterForAgent(full: FullGameState, agentId: string): FogFilteredState {
    const player = full.players.find(p => p.agent_id === agentId);
    if (!player) throw new Error(`Agent ${agentId} not found in game state`);
    
    const shroud = player.shroud;
    
    // Helper: is a cell position visible to this player?
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
      .filter(u => isVisible(u.position))     // ← THE FOG CHECK
      .map(u => ({
        id: u.id,
        type: u.type,
        position: u.position,
        health_percent: Math.round((u.health / u.max_health) * 100),
        // Deliberately omitting: exact HP, activity, idle state
      }));
    
    // Enemy buildings — ONLY if visible
    const visibleEnemyBuildings: EnemyBuildingView[] = full.all_buildings
      .filter(b => b.owner_id !== player.player_id)
      .filter(b => isVisible(b.position))     // ← THE FOG CHECK
      .map(b => ({
        id: b.id,
        type: b.type,
        position: b.position,
        health_percent: Math.round((b.health / b.max_health) * 100),
        // Deliberately omitting: production queue, rally point
      }));
    
    // Update frozen actors (last known positions from fog)
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
        explored_percentage: (shroud.explored_cells.size / full.map.total_cells) * 100,
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
    
    // For all currently visible enemy units/buildings, update their frozen record
    const allEnemies = [
      ...full.all_units.filter(u => u.owner_id !== player.player_id),
      ...full.all_buildings.filter(b => b.owner_id !== player.player_id),
    ];
    
    for (const entity of allEnemies) {
      if (isVisible(entity.position)) {
        // Currently visible — update frozen record
        frozen.set(entity.id, {
          id: entity.id,
          type: entity.type,
          position: entity.position,
          last_seen_tick: full.tick,
        });
      }
    }
    
    // Remove frozen actors that have been destroyed
    const aliveIds = new Set(allEnemies.map(e => e.id));
    for (const [id] of frozen) {
      if (!aliveIds.has(id)) {
        // Don't remove immediately — agent might not know it's dead yet
        // Only remove if the cell is currently visible (they'd see it's gone)
        const actor = frozen.get(id)!;
        if (isVisible(actor.position)) {
          frozen.delete(id);
        }
      }
    }
  }
}
