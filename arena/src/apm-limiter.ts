/**
 * APM Limiter — Rate-limiting engine for agent actions.
 *
 * Enforces Actions Per Minute (APM) caps to ensure fair competition.
 * Each agent gets a tracker that monitors their action rate using
 * a sliding window algorithm.
 *
 * Three profiles:
 *   - human_like: 200 APM (for human vs AI)
 *   - competitive: 600 APM (ranked AI vs AI)
 *   - unlimited: No restrictions (benchmarking)
 *
 * The limiter runs server-side. Agents CANNOT bypass it.
 */

import type { GameOrder } from "./fog-enforcer.js";

// ─── APM Profile Definitions ───────────────────────────

export interface ApmProfile {
  /** Display name */
  name: string;
  /** Maximum actions per 60-second rolling window */
  max_apm: number;
  /** Maximum orders in a single tick batch */
  max_orders_per_tick: number;
  /** Minimum milliseconds between order batches */
  min_ms_between_orders: number;
  /** Max units that can be commanded in a single order */
  max_simultaneous_unit_commands: number;
  /** Description for documentation */
  description: string;
}

export const APM_PROFILES: Record<string, ApmProfile> = {
  human_like: {
    name: "Human-Like",
    max_apm: 200,
    max_orders_per_tick: 3,
    min_ms_between_orders: 50,
    max_simultaneous_unit_commands: 12,
    description:
      "Simulates realistic human APM constraints. Used for fair human-vs-AI matches.",
  },
  competitive: {
    name: "Competitive",
    max_apm: 600,
    max_orders_per_tick: 8,
    min_ms_between_orders: 10,
    max_simultaneous_unit_commands: 50,
    description:
      "Higher APM ceiling for AI-vs-AI competitive play. Still has limits to prevent " +
      "superhuman micro that would be unwatchable.",
  },
  unlimited: {
    name: "Unlimited",
    max_apm: Infinity,
    max_orders_per_tick: 100,
    min_ms_between_orders: 0,
    max_simultaneous_unit_commands: Infinity,
    description:
      "No restrictions. For benchmarking, exhibitions, and casual games only.",
  },
};

// ─── APM Check Result ───────────────────────────────────

export interface ApmCheckResult {
  allowed: boolean;
  reason?: string;
  current_apm: number;
  max_apm: number;
  remaining_budget: number;
  cooldown_ms?: number;
}

// ─── Agent APM Tracker ──────────────────────────────────

export class AgentApmTracker {
  private readonly profile: ApmProfile;
  private readonly agentId: string;

  /** Timestamps of each individual order action (for rolling window) */
  private actionTimestamps: number[] = [];

  /** When the last order batch was received */
  private lastBatchTime = 0;

  /** Total orders processed */
  private totalOrders = 0;

  /** Total violations */
  private violations = 0;

  constructor(agentId: string, profile: ApmProfile) {
    this.agentId = agentId;
    this.profile = profile;
  }

  /**
   * Check whether a batch of orders can be processed.
   * Does NOT record them — call record() after validation.
   */
  check(orderCount: number): ApmCheckResult {
    const now = Date.now();

    // 1. Minimum gap between batches
    const timeSinceLast = now - this.lastBatchTime;
    if (this.lastBatchTime > 0 && timeSinceLast < this.profile.min_ms_between_orders) {
      return {
        allowed: false,
        reason:
          `Orders too fast: ${timeSinceLast}ms since last batch. ` +
          `Minimum gap: ${this.profile.min_ms_between_orders}ms.`,
        current_apm: this.getCurrentApm(),
        max_apm: this.profile.max_apm,
        remaining_budget: 0,
        cooldown_ms: this.profile.min_ms_between_orders - timeSinceLast,
      };
    }

    // 2. Per-tick cap
    if (orderCount > this.profile.max_orders_per_tick) {
      return {
        allowed: false,
        reason:
          `Too many orders in one batch: ${orderCount}. ` +
          `Maximum: ${this.profile.max_orders_per_tick} per tick.`,
        current_apm: this.getCurrentApm(),
        max_apm: this.profile.max_apm,
        remaining_budget: this.profile.max_orders_per_tick,
      };
    }

    // 3. Rolling APM check (60-second window)
    this.pruneOldTimestamps(now);
    const projectedApm = this.actionTimestamps.length + orderCount;
    if (projectedApm > this.profile.max_apm) {
      return {
        allowed: false,
        reason:
          `APM limit reached. Current: ${this.actionTimestamps.length}/min. ` +
          `Adding ${orderCount} would exceed ${this.profile.max_apm}/min.`,
        current_apm: this.actionTimestamps.length,
        max_apm: this.profile.max_apm,
        remaining_budget: Math.max(0, this.profile.max_apm - this.actionTimestamps.length),
      };
    }

    return {
      allowed: true,
      current_apm: this.actionTimestamps.length,
      max_apm: this.profile.max_apm,
      remaining_budget: this.profile.max_apm - this.actionTimestamps.length - orderCount,
    };
  }

  /**
   * Check unit count per order against the profile limit.
   */
  checkUnitCount(order: GameOrder): ApmCheckResult | null {
    if (order.unit_ids && order.unit_ids.length > this.profile.max_simultaneous_unit_commands) {
      return {
        allowed: false,
        reason:
          `Too many units in one command: ${order.unit_ids.length}. ` +
          `Maximum: ${this.profile.max_simultaneous_unit_commands}.`,
        current_apm: this.getCurrentApm(),
        max_apm: this.profile.max_apm,
        remaining_budget: 0,
      };
    }
    return null; // No violation
  }

  /**
   * Record that a batch of orders was processed.
   */
  record(orderCount: number): void {
    const now = Date.now();
    for (let i = 0; i < orderCount; i++) {
      this.actionTimestamps.push(now);
    }
    this.lastBatchTime = now;
    this.totalOrders += orderCount;
  }

  /**
   * Record a violation.
   */
  recordViolation(): void {
    this.violations++;
  }

  /**
   * Get current APM (actions in the last 60 seconds).
   */
  getCurrentApm(): number {
    this.pruneOldTimestamps(Date.now());
    return this.actionTimestamps.length;
  }

  /**
   * Get agent stats.
   */
  getStats(): {
    agent_id: string;
    profile: string;
    current_apm: number;
    max_apm: number;
    total_orders: number;
    violations: number;
    utilization_percent: number;
  } {
    const currentApm = this.getCurrentApm();
    return {
      agent_id: this.agentId,
      profile: this.profile.name,
      current_apm: currentApm,
      max_apm: this.profile.max_apm,
      total_orders: this.totalOrders,
      violations: this.violations,
      utilization_percent:
        this.profile.max_apm === Infinity
          ? 0
          : Math.round((currentApm / this.profile.max_apm) * 100),
    };
  }

  /**
   * Reset the tracker (e.g., between matches).
   */
  reset(): void {
    this.actionTimestamps = [];
    this.lastBatchTime = 0;
    this.totalOrders = 0;
    this.violations = 0;
  }

  // ─── Private ────────────────────────────────────────────

  private pruneOldTimestamps(now: number): void {
    const cutoff = now - 60_000;
    this.actionTimestamps = this.actionTimestamps.filter((t) => t > cutoff);
  }
}

// ─── APM Limiter (manages all agent trackers) ───────────

export class ApmLimiter {
  private trackers = new Map<string, AgentApmTracker>();
  private defaultProfile: ApmProfile;

  constructor(defaultProfile: ApmProfile = APM_PROFILES.competitive) {
    this.defaultProfile = defaultProfile;
  }

  /**
   * Get or create a tracker for an agent.
   */
  getTracker(agentId: string, profile?: ApmProfile): AgentApmTracker {
    let tracker = this.trackers.get(agentId);
    if (!tracker) {
      tracker = new AgentApmTracker(agentId, profile ?? this.defaultProfile);
      this.trackers.set(agentId, tracker);
    }
    return tracker;
  }

  /**
   * Process a batch of orders for an agent.
   * Returns which orders are allowed and any violations.
   */
  processOrders(
    agentId: string,
    orders: GameOrder[],
    profile?: ApmProfile
  ): { allowed: GameOrder[]; rejected: GameOrder[]; violations: string[] } {
    const tracker = this.getTracker(agentId, profile);
    const violations: string[] = [];
    const allowed: GameOrder[] = [];
    const rejected: GameOrder[] = [];

    // Check batch-level APM
    const batchCheck = tracker.check(orders.length);
    if (!batchCheck.allowed) {
      tracker.recordViolation();
      return {
        allowed: [],
        rejected: orders,
        violations: [batchCheck.reason!],
      };
    }

    // Check individual orders for unit count limits
    for (const order of orders) {
      const unitCheck = tracker.checkUnitCount(order);
      if (unitCheck) {
        violations.push(unitCheck.reason!);
        rejected.push(order);
        tracker.recordViolation();
      } else {
        allowed.push(order);
      }
    }

    // Record allowed orders
    if (allowed.length > 0) {
      tracker.record(allowed.length);
    }

    return { allowed, rejected, violations };
  }

  /**
   * Get stats for all tracked agents.
   */
  getAllStats(): ReturnType<AgentApmTracker["getStats"]>[] {
    return Array.from(this.trackers.values()).map((t) => t.getStats());
  }

  /**
   * Clean up a tracker when a match ends.
   */
  cleanup(agentId: string): void {
    this.trackers.delete(agentId);
  }

  /**
   * Reset all trackers.
   */
  resetAll(): void {
    this.trackers.clear();
  }
}
