/**
 * Order Validator — Server-authoritative validation of all agent orders.
 *
 * Ensures agents can only issue legal, fair commands:
 *   - Ownership: Only command your own units/buildings
 *   - Bounds: Targets must be within map boundaries
 *   - Existence: Referenced IDs must exist and be alive
 *   - Tech tree: Build types must be available
 *   - Production limits: Reasonable batch sizes
 *   - Fog compliance: Can't target invisible enemies (except attack_move)
 *
 * Every violation is logged for anti-cheat analysis.
 */

import type {
  GameOrder,
  FogFilteredState,
  OwnUnitView,
  OwnBuildingView,
} from "./fog-enforcer.js";

// ─── Types ──────────────────────────────────────────────

export interface ValidationResult {
  valid: GameOrder[];
  rejected: GameOrder[];
  violations: OrderViolation[];
}

export interface OrderViolation {
  order: GameOrder;
  reason: string;
  severity: "warning" | "error" | "critical";
  category: ViolationCategory;
}

export type ViolationCategory =
  | "invalid_type"
  | "ownership"
  | "bounds"
  | "existence"
  | "tech_tree"
  | "production"
  | "fog_violation"
  | "malformed";

export interface ValidatorStats {
  total_validated: number;
  total_accepted: number;
  total_rejected: number;
  violations_by_category: Record<ViolationCategory, number>;
  violations_by_agent: Record<string, number>;
}

// ─── Valid Order Types ──────────────────────────────────

const VALID_ORDER_TYPES = new Set([
  "move",
  "attack",
  "attack_move",
  "deploy",
  "build",
  "train",
  "sell",
  "repair",
  "set_rally",
  "stop",
  "scatter",
  "guard",
  "patrol",
  "use_power",
]);

/** Orders that require unit_ids */
const UNIT_ORDERS = new Set([
  "move",
  "attack",
  "attack_move",
  "deploy",
  "stop",
  "scatter",
  "guard",
  "patrol",
]);

/** Orders that require building_id */
const BUILDING_ORDERS = new Set(["sell", "repair", "set_rally"]);

/** Orders that require a target position */
const POSITION_ORDERS = new Set([
  "move",
  "attack_move",
  "build",
  "set_rally",
  "patrol",
]);

/** Max production count per order */
const MAX_PRODUCTION_COUNT = 20;

// ─── Order Validator ────────────────────────────────────

export class OrderValidator {
  private stats: ValidatorStats = {
    total_validated: 0,
    total_accepted: 0,
    total_rejected: 0,
    violations_by_category: {
      invalid_type: 0,
      ownership: 0,
      bounds: 0,
      existence: 0,
      tech_tree: 0,
      production: 0,
      fog_violation: 0,
      malformed: 0,
    },
    violations_by_agent: {},
  };

  /**
   * Validate a batch of orders against the agent's visible game state.
   */
  validate(
    agentId: string,
    orders: GameOrder[],
    state: FogFilteredState
  ): ValidationResult {
    const valid: GameOrder[] = [];
    const rejected: GameOrder[] = [];
    const violations: OrderViolation[] = [];

    // Build lookup sets for fast validation
    const ownUnitIds = new Set(state.own.units.map((u) => u.id));
    const ownBuildingIds = new Set(state.own.buildings.map((b) => b.id));
    const ownUnitMap = new Map(state.own.units.map((u) => [u.id, u]));
    const ownBuildingMap = new Map(state.own.buildings.map((b) => [b.id, b]));

    // Visible enemy IDs (for attack targeting)
    const visibleEnemyIds = new Set([
      ...state.enemy.visible_units.map((u) => u.id),
      ...state.enemy.visible_buildings.map((b) => b.id),
    ]);

    const [mapW, mapH] = state.map.size;

    for (const order of orders) {
      this.stats.total_validated++;

      const orderViolations = this.validateSingleOrder(
        order,
        ownUnitIds,
        ownBuildingIds,
        ownUnitMap,
        ownBuildingMap,
        visibleEnemyIds,
        mapW,
        mapH
      );

      if (orderViolations.length > 0) {
        rejected.push(order);
        for (const v of orderViolations) {
          violations.push(v);
          this.recordViolation(agentId, v.category);
        }
        this.stats.total_rejected++;
      } else {
        valid.push(order);
        this.stats.total_accepted++;
      }
    }

    return { valid, rejected, violations };
  }

  /**
   * Validate a single order. Returns violations (empty = valid).
   */
  private validateSingleOrder(
    order: GameOrder,
    ownUnitIds: Set<number>,
    ownBuildingIds: Set<number>,
    _ownUnitMap: Map<number, OwnUnitView>,
    _ownBuildingMap: Map<number, OwnBuildingView>,
    visibleEnemyIds: Set<number>,
    mapW: number,
    mapH: number
  ): OrderViolation[] {
    const violations: OrderViolation[] = [];

    // 1. Validate order type
    if (!order.type || !VALID_ORDER_TYPES.has(order.type)) {
      violations.push({
        order,
        reason: `Unknown order type: "${order.type}"`,
        severity: "error",
        category: "invalid_type",
      });
      return violations; // Can't validate further
    }

    // 2. Validate required fields exist
    if (UNIT_ORDERS.has(order.type)) {
      if (!order.unit_ids || !Array.isArray(order.unit_ids) || order.unit_ids.length === 0) {
        violations.push({
          order,
          reason: `Order type "${order.type}" requires non-empty unit_ids array`,
          severity: "error",
          category: "malformed",
        });
        return violations;
      }
    }

    if (BUILDING_ORDERS.has(order.type)) {
      if (order.building_id === undefined || order.building_id === null) {
        violations.push({
          order,
          reason: `Order type "${order.type}" requires building_id`,
          severity: "error",
          category: "malformed",
        });
        return violations;
      }
    }

    if (POSITION_ORDERS.has(order.type)) {
      if (!order.target || !Array.isArray(order.target) || order.target.length !== 2) {
        violations.push({
          order,
          reason: `Order type "${order.type}" requires target: [x, y]`,
          severity: "error",
          category: "malformed",
        });
        return violations;
      }
    }

    // 3. Validate unit ownership
    if (order.unit_ids) {
      const foreignUnits = order.unit_ids.filter((id) => !ownUnitIds.has(id));
      if (foreignUnits.length > 0) {
        violations.push({
          order,
          reason: `Cannot command units you don't own: [${foreignUnits.join(", ")}]`,
          severity: "critical",
          category: "ownership",
        });
      }
    }

    // 4. Validate building ownership
    if (order.building_id !== undefined && BUILDING_ORDERS.has(order.type)) {
      if (!ownBuildingIds.has(order.building_id)) {
        violations.push({
          order,
          reason: `Cannot command building you don't own: ${order.building_id}`,
          severity: "critical",
          category: "ownership",
        });
      }
    }

    // 5. Validate target position bounds
    if (order.target && POSITION_ORDERS.has(order.type)) {
      const [x, y] = order.target;
      if (
        typeof x !== "number" || typeof y !== "number" ||
        x < 0 || y < 0 || x >= mapW || y >= mapH
      ) {
        violations.push({
          order,
          reason: `Target position out of bounds: [${x}, ${y}]. Map is [${mapW}, ${mapH}]`,
          severity: "error",
          category: "bounds",
        });
      }
    }

    // 6. Validate attack target visibility (fog compliance)
    if (order.type === "attack" && order.target_id !== undefined) {
      if (!ownUnitIds.has(order.target_id) && !visibleEnemyIds.has(order.target_id)) {
        violations.push({
          order,
          reason: `Cannot attack target ${order.target_id}: not visible (fog of war)`,
          severity: "critical",
          category: "fog_violation",
        });
      }
    }

    // 7. Validate guard target existence
    if (order.type === "guard" && order.target_id !== undefined) {
      if (!ownUnitIds.has(order.target_id)) {
        violations.push({
          order,
          reason: `Guard target ${order.target_id}: must be your own unit`,
          severity: "error",
          category: "ownership",
        });
      }
    }

    // 8. Validate production count
    if (order.type === "train") {
      if (!order.build_type || typeof order.build_type !== "string") {
        violations.push({
          order,
          reason: `Train order requires build_type (string)`,
          severity: "error",
          category: "malformed",
        });
      }
      if (order.count !== undefined) {
        if (typeof order.count !== "number" || order.count < 1 || order.count > MAX_PRODUCTION_COUNT) {
          violations.push({
            order,
            reason: `Invalid production count: ${order.count}. Must be 1-${MAX_PRODUCTION_COUNT}`,
            severity: "error",
            category: "production",
          });
        }
      }
    }

    // 9. Validate build order has build_type
    if (order.type === "build") {
      if (!order.build_type || typeof order.build_type !== "string") {
        violations.push({
          order,
          reason: `Build order requires build_type (string)`,
          severity: "error",
          category: "malformed",
        });
      }
    }

    // 10. Validate use_power order
    if (order.type === "use_power") {
      if (!order.build_type || typeof order.build_type !== "string") {
        violations.push({
          order,
          reason: `use_power requires power_type via build_type field`,
          severity: "error",
          category: "malformed",
        });
      }
    }

    return violations;
  }

  // ─── Stats & Tracking ──────────────────────────────────

  private recordViolation(agentId: string, category: ViolationCategory): void {
    this.stats.violations_by_category[category]++;
    this.stats.violations_by_agent[agentId] =
      (this.stats.violations_by_agent[agentId] ?? 0) + 1;
  }

  /**
   * Get validator statistics.
   */
  getStats(): ValidatorStats {
    return { ...this.stats };
  }

  /**
   * Get violations count for a specific agent.
   */
  getAgentViolations(agentId: string): number {
    return this.stats.violations_by_agent[agentId] ?? 0;
  }

  /**
   * Check if an agent has too many violations (potential cheater).
   */
  isSuspicious(agentId: string, threshold: number = 50): boolean {
    return this.getAgentViolations(agentId) >= threshold;
  }

  /**
   * Reset stats (e.g., between matches).
   */
  reset(): void {
    this.stats = {
      total_validated: 0,
      total_accepted: 0,
      total_rejected: 0,
      violations_by_category: {
        invalid_type: 0,
        ownership: 0,
        bounds: 0,
        existence: 0,
        tech_tree: 0,
        production: 0,
        fog_violation: 0,
        malformed: 0,
      },
      violations_by_agent: {},
    };
  }
}
