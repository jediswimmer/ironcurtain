/**
 * IronCurtain MCP Server — Core Type Definitions
 *
 * All types for game state, IPC protocol messages, and tool return values.
 * No `any` — everything is properly typed.
 */

// ─── Geometry ────────────────────────────────────────────────────────────────

/** Cell position on the map grid */
export interface CellPosition {
  readonly x: number;
  readonly y: number;
}

/** Tuple representation for JSON transport */
export type CellTuple = readonly [x: number, y: number];

// ─── Game Phase & Metadata ───────────────────────────────────────────────────

export type GamePhase =
  | "lobby"
  | "starting"
  | "playing"
  | "won"
  | "lost"
  | "draw"
  | "disconnected";

export type Faction = "allies" | "soviet";
export type GameSpeed =
  | "slowest"
  | "slower"
  | "slow"
  | "normal"
  | "fast"
  | "faster"
  | "fastest";
export type TechLevel = "low" | "medium" | "high" | "unrestricted";

export interface PlayerInfo {
  readonly name: string;
  readonly faction: Faction;
  readonly is_us: boolean;
  readonly is_bot: boolean;
  readonly color: string;
}

// ─── Game Status ─────────────────────────────────────────────────────────────

export interface PowerSummary {
  readonly current: number;
  readonly drain: number;
  readonly surplus: number;
}

export interface GameStatus {
  readonly phase: GamePhase;
  readonly tick: number;
  readonly elapsed_time: string;
  readonly game_speed: GameSpeed;
  readonly our_faction: Faction;
  readonly our_credits: number;
  readonly unit_count: number;
  readonly building_count: number;
  readonly power: PowerSummary;
  readonly kill_count: number;
  readonly loss_count: number;
  readonly players: readonly PlayerInfo[];
}

export interface GameSettings {
  readonly game_id: string;
  readonly map_name: string;
  readonly map_size: CellTuple;
  readonly game_speed: GameSpeed;
  readonly fog_of_war: boolean;
  readonly shroud: boolean;
  readonly starting_cash: number;
  readonly tech_level: TechLevel;
  readonly players: readonly PlayerInfo[];
}

// ─── Units ───────────────────────────────────────────────────────────────────

export type UnitStatus = "idle" | "moving" | "attacking" | "harvesting" | "returning" | "guarding";

export interface UnitInfo {
  readonly id: number;
  readonly type: string;
  readonly display_name: string;
  readonly position: CellTuple;
  readonly health: number;
  readonly max_health: number;
  readonly health_percent: number;
  readonly status: UnitStatus;
  readonly activity: string | null;
  readonly can_attack: boolean;
  readonly can_move: boolean;
  readonly veterancy: number;
}

export interface UnitsResponse {
  readonly units: readonly UnitInfo[];
  readonly total_count: number;
  readonly by_type: Record<string, number>;
}

// ─── Buildings ───────────────────────────────────────────────────────────────

export interface ProductionItem {
  readonly type: string;
  readonly display_name: string;
  readonly progress_percent: number;
  readonly cost: number;
  readonly paused: boolean;
}

export interface BuildingInfo {
  readonly id: number;
  readonly type: string;
  readonly display_name: string;
  readonly position: CellTuple;
  readonly health: number;
  readonly max_health: number;
  readonly health_percent: number;
  readonly is_producing: boolean;
  readonly production_queue: readonly ProductionItem[];
  readonly rally_point: CellTuple | null;
  readonly power_generated: number;
  readonly power_consumed: number;
  readonly is_being_repaired: boolean;
  readonly is_primary: boolean;
}

export interface BuildingsResponse {
  readonly buildings: readonly BuildingInfo[];
  readonly power_summary: PowerSummary;
}

// ─── Resources ───────────────────────────────────────────────────────────────

export type HarvesterStatus = "harvesting" | "returning" | "idle" | "moving";
export type OreType = "ore" | "gems";
export type ThreatLevel = "safe" | "contested" | "enemy_controlled";
export type OreEstimate = "high" | "medium" | "low" | "depleted";

export interface HarvesterInfo {
  readonly id: number;
  readonly status: HarvesterStatus;
  readonly position: CellTuple;
  readonly load_percent: number;
  readonly assigned_refinery: number | null;
}

export interface OreFieldInfo {
  readonly center: CellTuple;
  readonly type: OreType;
  readonly estimated_value: OreEstimate;
  readonly distance_from_base: number;
  readonly threat_level: ThreatLevel;
}

export interface RefineryInfo {
  readonly id: number;
  readonly position: CellTuple;
  readonly harvesters_assigned: number;
}

export interface SiloInfo {
  readonly count: number;
  readonly storage_capacity: number;
  readonly storage_used: number;
}

export interface ResourcesResponse {
  readonly credits: number;
  readonly income_per_minute: number;
  readonly harvesters: readonly HarvesterInfo[];
  readonly known_ore_fields: readonly OreFieldInfo[];
  readonly refineries: readonly RefineryInfo[];
  readonly silos: SiloInfo;
}

// ─── Enemy Intel ─────────────────────────────────────────────────────────────

export interface EnemyUnitInfo {
  readonly id: number;
  readonly type: string;
  readonly display_name: string;
  readonly owner: string;
  readonly position: CellTuple;
  readonly health_percent: number;
  readonly is_frozen: boolean;
  readonly last_seen_tick: number | null;
}

export interface EnemyBuildingInfo {
  readonly id: number;
  readonly type: string;
  readonly display_name: string;
  readonly owner: string;
  readonly position: CellTuple;
  readonly health_percent: number;
  readonly is_frozen: boolean;
  readonly last_seen_tick: number | null;
}

export interface ThreatAssessment {
  readonly known_army_value: number;
  readonly known_building_value: number;
  readonly estimated_strength: "weak" | "moderate" | "strong" | "overwhelming" | "unknown";
}

export interface EnemyIntelResponse {
  readonly visible_units: readonly EnemyUnitInfo[];
  readonly visible_buildings: readonly EnemyBuildingInfo[];
  readonly enemy_base_locations: readonly CellTuple[];
  readonly threat_assessment: ThreatAssessment;
}

// ─── Map ─────────────────────────────────────────────────────────────────────

export interface TerrainSummary {
  readonly water_cells: number;
  readonly buildable_cells: number;
  readonly cliff_cells: number;
}

export interface MapInfo {
  readonly name: string;
  readonly size: CellTuple;
  readonly tileset: string;
  readonly spawn_points: readonly CellTuple[];
  readonly explored_percentage: number;
  readonly terrain_summary: TerrainSummary;
  readonly ore_fields: readonly OreFieldInfo[];
}

// ─── Tech Tree / Build Options ───────────────────────────────────────────────

export type ProductionCategory =
  | "building"
  | "vehicle"
  | "infantry"
  | "aircraft"
  | "naval"
  | "all";

export interface BuildOption {
  readonly type: string;
  readonly display_name: string;
  readonly cost: number;
  readonly build_time_ticks: number;
  readonly prerequisites_met: boolean;
  readonly can_afford: boolean;
  readonly prerequisites: readonly string[];
  readonly produced_at: string;
  readonly power?: number;
}

export interface BuildOptionsResponse {
  readonly buildings: readonly BuildOption[];
  readonly units: readonly BuildOption[];
}

// ─── Production Queue ────────────────────────────────────────────────────────

export interface QueuedItem {
  readonly type: string;
  readonly display_name: string;
  readonly progress_percent: number;
  readonly paused: boolean;
  readonly remaining_ticks: number;
  readonly cost: number;
  readonly cost_remaining: number;
}

export interface ProducerQueue {
  readonly producer: { readonly id: number; readonly type: string };
  readonly queue: readonly QueuedItem[];
}

export interface ProductionQueueResponse {
  readonly building_queue: readonly QueuedItem[];
  readonly unit_queues: readonly ProducerQueue[];
}

// ─── Order Results ───────────────────────────────────────────────────────────

export interface OrderResult {
  readonly success: boolean;
  readonly message?: string;
  readonly error?: string;
}

export interface MoveResult extends OrderResult {
  readonly units_moved: number;
  readonly target: CellTuple;
  readonly estimated_arrival_ticks: number;
}

export interface AttackMoveResult extends OrderResult {
  readonly units_ordered: number;
  readonly target: CellTuple;
}

export interface AttackTargetResult extends OrderResult {
  readonly attackers: number;
  readonly target: { readonly id: number; readonly type: string; readonly position: CellTuple };
}

export interface BuildStructureResult extends OrderResult {
  readonly building_type: string;
  readonly position: CellTuple | null;
  readonly estimated_completion_ticks: number;
  readonly cost: number;
}

export interface TrainUnitResult extends OrderResult {
  readonly queued: number;
  readonly type: string;
  readonly display_name: string;
  readonly cost_each: number;
  readonly total_cost: number;
  readonly estimated_completion_ticks: number;
  readonly queue_length: number;
}

export interface DeployResult extends OrderResult {
  readonly deployed_as: string;
  readonly position: CellTuple;
}

export interface RallyPointResult extends OrderResult {
  readonly building: string;
  readonly rally_point: CellTuple;
}

export interface SellResult extends OrderResult {
  readonly sold: string;
  readonly refund_estimate: number;
}

export interface RepairResult extends OrderResult {
  readonly building: string;
  readonly repairing: boolean;
  readonly estimated_cost: number;
}

export interface ScoutResult extends OrderResult {
  readonly scout: { readonly id: number; readonly type: string; readonly speed: string } | null;
  readonly target: CellTuple;
  readonly estimated_arrival: number;
}

// ─── IPC Protocol ────────────────────────────────────────────────────────────

export interface IpcRequest {
  readonly id: number;
  readonly method: string;
  readonly params: Record<string, unknown>;
}

export interface IpcResponse {
  readonly id: number;
  readonly result?: unknown;
  readonly error?: string;
}

export interface IpcEvent {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

export type IpcMessage = IpcResponse | IpcEvent;

// ─── IPC Order Types ─────────────────────────────────────────────────────────

export interface IpcMoveOrder {
  readonly order: "Move";
  readonly subject_id: number;
  readonly target_cell: CellTuple;
  readonly queued: boolean;
}

export interface IpcAttackMoveOrder {
  readonly order: "AttackMove";
  readonly subject_id: number;
  readonly target_cell: CellTuple;
  readonly queued: boolean;
}

export interface IpcAttackOrder {
  readonly order: "Attack";
  readonly subject_id: number;
  readonly target_id: number;
}

export interface IpcDeployOrder {
  readonly order: "DeployTransform";
  readonly subject_id: number;
}

export interface IpcProductionOrder {
  readonly order: "StartProduction";
  readonly type: string;
  readonly count: number;
  readonly building_id?: number;
}

export interface IpcPlaceBuildingOrder {
  readonly order: "PlaceBuilding";
  readonly type: string;
  readonly position: CellTuple;
}

export interface IpcRallyPointOrder {
  readonly order: "SetRallyPoint";
  readonly subject_id: number;
  readonly position: CellTuple;
}

export interface IpcSellOrder {
  readonly order: "Sell";
  readonly subject_id: number;
}

export interface IpcRepairOrder {
  readonly order: "RepairBuilding";
  readonly subject_id: number;
}

export type IpcOrder =
  | IpcMoveOrder
  | IpcAttackMoveOrder
  | IpcAttackOrder
  | IpcDeployOrder
  | IpcProductionOrder
  | IpcPlaceBuildingOrder
  | IpcRallyPointOrder
  | IpcSellOrder
  | IpcRepairOrder;

// ─── Tool Registry ───────────────────────────────────────────────────────────

export interface ToolDefinition {
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  handler(args: Record<string, unknown>): Promise<unknown>;
}

export type ToolMap = Map<string, ToolDefinition>;

// ─── Event Types ─────────────────────────────────────────────────────────────

export type GameEventType =
  | "unit_destroyed"
  | "building_complete"
  | "under_attack"
  | "production_complete"
  | "game_started"
  | "game_ended"
  | "player_defeated"
  | "credits_changed";

export interface GameEvent {
  readonly event: GameEventType;
  readonly data: Record<string, unknown>;
  readonly tick: number;
}
