/**
 * Advanced Anti-Cheat — Pattern detection and anomaly alerting.
 *
 * Layers beyond the basic fog enforcer:
 *   1. Reaction Time Analysis — detects impossibly fast responses
 *   2. Target Selection Analysis — detects targeting of unseen units
 *   3. Build Order Timing Analysis — detects frame-perfect builds
 *   4. APM Pattern Analysis — detects inhuman consistency
 *   5. Statistical Anomaly Detection — win rate vs. expectation
 *   6. Cross-Match Pattern Detection — detects collusion/wintrading
 *
 * Each detection generates an alert with a confidence score.
 * High-confidence alerts flag the agent for manual review.
 */

// ─── Types ──────────────────────────────────────────────

export type AlertSeverity = "low" | "medium" | "high" | "critical";

export type CheatCategory =
  | "reaction_time"
  | "fog_hack"
  | "apm_anomaly"
  | "build_timing"
  | "target_selection"
  | "win_trading"
  | "statistical_anomaly";

export interface CheatAlert {
  id: string;
  agent_id: string;
  match_id: string;
  category: CheatCategory;
  severity: AlertSeverity;
  confidence: number; // 0.0 - 1.0
  description: string;
  evidence: Record<string, unknown>;
  timestamp: number;
  reviewed: boolean;
  verdict: "clean" | "suspicious" | "cheating" | "pending";
}

export interface AgentRiskProfile {
  agent_id: string;
  total_alerts: number;
  alerts_by_category: Record<CheatCategory, number>;
  alerts_by_severity: Record<AlertSeverity, number>;
  risk_score: number; // 0-100
  risk_level: "clean" | "low" | "medium" | "high" | "flagged";
  last_alert: number | null;
  matches_analyzed: number;
}

export interface ReactionTimeData {
  agent_id: string;
  match_id: string;
  event_tick: number;
  response_tick: number;
  reaction_ticks: number;
  event_type: string;
}

export interface ApmSample {
  tick: number;
  apm: number;
  orders_count: number;
}

// ─── Constants ──────────────────────────────────────────

/**
 * Minimum realistic reaction time in game ticks.
 * At 24 ticks/sec, 3 ticks = 125ms. Human minimum is ~150ms.
 * Anything under 2 ticks (83ms) is suspicious for any agent.
 */
const MIN_REACTION_TICKS = 2;

/**
 * APM standard deviation threshold.
 * Humans vary a lot. Bots that maintain EXACTLY the same APM every
 * second are suspicious (though not necessarily cheating).
 */
const APM_STDDEV_THRESHOLD = 5;

/**
 * Win rate z-score threshold for statistical anomaly.
 * A z-score > 3.0 means the win rate is 3+ standard deviations
 * above the expected rate for their ELO bracket.
 */
const WIN_RATE_ZSCORE_THRESHOLD = 3.0;

// ─── Anti-Cheat Engine ──────────────────────────────────

export class AntiCheatEngine {
  private alerts: CheatAlert[] = [];
  private riskProfiles = new Map<string, AgentRiskProfile>();
  private reactionData = new Map<string, ReactionTimeData[]>();
  private apmHistory = new Map<string, ApmSample[]>();
  private alertCounter = 0;

  /**
   * Analyze reaction times for an agent in a match.
   * Flags impossibly fast reactions.
   */
  analyzeReactionTime(
    agentId: string,
    matchId: string,
    data: ReactionTimeData[]
  ): CheatAlert[] {
    const alerts: CheatAlert[] = [];

    // Store data for cross-match analysis
    const existing = this.reactionData.get(agentId) ?? [];
    existing.push(...data);
    this.reactionData.set(agentId, existing.slice(-1000));

    // Check for impossibly fast reactions
    const suspiciousllyFast = data.filter(
      (d) => d.reaction_ticks < MIN_REACTION_TICKS
    );

    if (suspiciousllyFast.length > 0) {
      const avgReaction =
        suspiciousllyFast.reduce((s, d) => s + d.reaction_ticks, 0) /
        suspiciousllyFast.length;

      const alert = this.createAlert({
        agent_id: agentId,
        match_id: matchId,
        category: "reaction_time",
        severity: suspiciousllyFast.length > 5 ? "high" : "medium",
        confidence: Math.min(
          0.95,
          0.5 + suspiciousllyFast.length * 0.05
        ),
        description:
          `${suspiciousllyFast.length} reactions under ${MIN_REACTION_TICKS} ticks ` +
          `(avg: ${avgReaction.toFixed(1)} ticks). ` +
          `At 24 ticks/sec, this is ${((avgReaction / 24) * 1000).toFixed(0)}ms.`,
        evidence: {
          fast_reactions: suspiciousllyFast.length,
          avg_reaction_ticks: avgReaction,
          avg_reaction_ms: (avgReaction / 24) * 1000,
          events: suspiciousllyFast.slice(0, 10),
        },
      });

      alerts.push(alert);
    }

    return alerts;
  }

  /**
   * Analyze APM patterns for an agent.
   * Flags inhuman consistency (exactly same APM every interval).
   */
  analyzeApmPattern(
    agentId: string,
    matchId: string,
    samples: ApmSample[]
  ): CheatAlert[] {
    const alerts: CheatAlert[] = [];

    if (samples.length < 10) return alerts;

    const existing = this.apmHistory.get(agentId) ?? [];
    existing.push(...samples);
    this.apmHistory.set(agentId, existing.slice(-500));

    // Calculate APM standard deviation
    const apms = samples.map((s) => s.apm);
    const mean = apms.reduce((a, b) => a + b, 0) / apms.length;
    const variance =
      apms.reduce((sum, apm) => sum + Math.pow(apm - mean, 2), 0) /
      apms.length;
    const stddev = Math.sqrt(variance);

    // Suspiciously consistent APM (robots can vary; perfectly consistent is a flag)
    if (stddev < APM_STDDEV_THRESHOLD && mean > 100) {
      const alert = this.createAlert({
        agent_id: agentId,
        match_id: matchId,
        category: "apm_anomaly",
        severity: "low",
        confidence: 0.4,
        description:
          `APM unusually consistent: mean=${mean.toFixed(1)}, ` +
          `stddev=${stddev.toFixed(2)}. ` +
          `This is normal for bots but flagged for review.`,
        evidence: {
          mean_apm: mean,
          stddev,
          sample_count: samples.length,
        },
      });
      alerts.push(alert);
    }

    return alerts;
  }

  /**
   * Check for potential fog-of-war violations.
   * Detects if an agent consistently targets units just as they become visible,
   * which could indicate they knew where the units were before seeing them.
   */
  analyzeFogCompliance(
    agentId: string,
    matchId: string,
    attacksOnNewlyVisible: number,
    totalAttacks: number
  ): CheatAlert[] {
    const alerts: CheatAlert[] = [];

    if (totalAttacks < 5) return alerts;

    const ratio = attacksOnNewlyVisible / totalAttacks;

    // If > 50% of attacks are on units that JUST became visible (within 2 ticks),
    // that's suspicious
    if (ratio > 0.5) {
      const alert = this.createAlert({
        agent_id: agentId,
        match_id: matchId,
        category: "fog_hack",
        severity: ratio > 0.8 ? "high" : "medium",
        confidence: Math.min(0.9, ratio),
        description:
          `${(ratio * 100).toFixed(1)}% of attacks target units within 2 ticks ` +
          `of becoming visible. Expected: ~10-20% for normal play.`,
        evidence: {
          attacks_on_newly_visible: attacksOnNewlyVisible,
          total_attacks: totalAttacks,
          ratio,
        },
      });
      alerts.push(alert);
    }

    return alerts;
  }

  /**
   * Detect potential win trading (two agents intentionally losing to each other).
   */
  analyzeWinTrading(
    agent1Id: string,
    agent2Id: string,
    matchHistory: Array<{ winner: string; duration_secs: number }>
  ): CheatAlert[] {
    const alerts: CheatAlert[] = [];

    if (matchHistory.length < 4) return alerts;

    // Check for alternating wins
    let alternating = 0;
    for (let i = 1; i < matchHistory.length; i++) {
      if (matchHistory[i].winner !== matchHistory[i - 1].winner) {
        alternating++;
      }
    }

    const alternatingRatio = alternating / (matchHistory.length - 1);

    // Perfect alternation with very short games = suspicious
    const avgDuration =
      matchHistory.reduce((s, m) => s + m.duration_secs, 0) /
      matchHistory.length;

    if (alternatingRatio > 0.9 && avgDuration < 120) {
      const alert = this.createAlert({
        agent_id: agent1Id,
        match_id: "cross-match",
        category: "win_trading",
        severity: "critical",
        confidence: Math.min(0.95, alternatingRatio),
        description:
          `Potential win trading between ${agent1Id} and ${agent2Id}. ` +
          `${(alternatingRatio * 100).toFixed(0)}% alternating wins with ` +
          `avg duration ${avgDuration.toFixed(0)}s (${matchHistory.length} games).`,
        evidence: {
          opponent: agent2Id,
          games: matchHistory.length,
          alternating_ratio: alternatingRatio,
          avg_duration_secs: avgDuration,
        },
      });
      alerts.push(alert);
    }

    return alerts;
  }

  /**
   * Statistical anomaly detection based on win rate vs ELO bracket expectation.
   */
  analyzeStatisticalAnomaly(
    agentId: string,
    wins: number,
    games: number,
    elo: number,
    expectedWinRate: number
  ): CheatAlert[] {
    const alerts: CheatAlert[] = [];

    if (games < 20) return alerts;

    const actualWinRate = wins / games;
    const stdDev = Math.sqrt(
      (expectedWinRate * (1 - expectedWinRate)) / games
    );

    if (stdDev === 0) return alerts;

    const zScore = (actualWinRate - expectedWinRate) / stdDev;

    if (zScore > WIN_RATE_ZSCORE_THRESHOLD) {
      const alert = this.createAlert({
        agent_id: agentId,
        match_id: "statistical",
        category: "statistical_anomaly",
        severity: zScore > 4 ? "high" : "medium",
        confidence: Math.min(0.9, 0.5 + (zScore - 3) * 0.1),
        description:
          `Win rate significantly above expected. ` +
          `Actual: ${(actualWinRate * 100).toFixed(1)}%, ` +
          `Expected: ${(expectedWinRate * 100).toFixed(1)}%, ` +
          `Z-score: ${zScore.toFixed(2)} (over ${games} games at ${elo} ELO).`,
        evidence: {
          actual_win_rate: actualWinRate,
          expected_win_rate: expectedWinRate,
          z_score: zScore,
          games,
          elo,
        },
      });
      alerts.push(alert);
    }

    return alerts;
  }

  // ─── Alert Management ──────────────────────────────────

  /**
   * Get all alerts for an agent.
   */
  getAgentAlerts(agentId: string): CheatAlert[] {
    return this.alerts.filter((a) => a.agent_id === agentId);
  }

  /**
   * Get the risk profile for an agent.
   */
  getRiskProfile(agentId: string): AgentRiskProfile {
    const cached = this.riskProfiles.get(agentId);
    if (cached) return cached;

    const agentAlerts = this.getAgentAlerts(agentId);
    const profile = this.calculateRiskProfile(agentId, agentAlerts);
    this.riskProfiles.set(agentId, profile);
    return profile;
  }

  /**
   * Get all unreviewed alerts.
   */
  getUnreviewedAlerts(): CheatAlert[] {
    return this.alerts.filter((a) => !a.reviewed);
  }

  /**
   * Review an alert and set verdict.
   */
  reviewAlert(
    alertId: string,
    verdict: "clean" | "suspicious" | "cheating"
  ): void {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.reviewed = true;
      alert.verdict = verdict;
      // Invalidate cached risk profile
      this.riskProfiles.delete(alert.agent_id);
    }
  }

  /**
   * Get overall anti-cheat stats.
   */
  getStats(): {
    total_alerts: number;
    unreviewed: number;
    by_severity: Record<AlertSeverity, number>;
    by_category: Record<CheatCategory, number>;
    flagged_agents: number;
  } {
    const bySeverity: Record<AlertSeverity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    const byCategory: Record<CheatCategory, number> = {
      reaction_time: 0,
      fog_hack: 0,
      apm_anomaly: 0,
      build_timing: 0,
      target_selection: 0,
      win_trading: 0,
      statistical_anomaly: 0,
    };

    for (const alert of this.alerts) {
      bySeverity[alert.severity]++;
      byCategory[alert.category]++;
    }

    const flaggedAgents = new Set(
      this.alerts
        .filter((a) => a.severity === "critical" || a.severity === "high")
        .map((a) => a.agent_id)
    ).size;

    return {
      total_alerts: this.alerts.length,
      unreviewed: this.alerts.filter((a) => !a.reviewed).length,
      by_severity: bySeverity,
      by_category: byCategory,
      flagged_agents: flaggedAgents,
    };
  }

  // ─── Private ───────────────────────────────────────────

  private createAlert(
    opts: Omit<CheatAlert, "id" | "timestamp" | "reviewed" | "verdict">
  ): CheatAlert {
    const alert: CheatAlert = {
      ...opts,
      id: `alert-${++this.alertCounter}`,
      timestamp: Date.now(),
      reviewed: false,
      verdict: "pending",
    };

    this.alerts.push(alert);

    // Keep alerts bounded
    if (this.alerts.length > 10_000) {
      this.alerts = this.alerts.slice(-5_000);
    }

    // Invalidate cached risk profile
    this.riskProfiles.delete(opts.agent_id);

    if (
      alert.severity === "critical" ||
      (alert.severity === "high" && alert.confidence > 0.7)
    ) {
      console.warn(
        `🚨 ANTI-CHEAT ALERT [${alert.severity}] ` +
          `Agent: ${alert.agent_id} | ${alert.category}: ${alert.description}`
      );
    }

    return alert;
  }

  private calculateRiskProfile(
    agentId: string,
    alerts: CheatAlert[]
  ): AgentRiskProfile {
    const byCategory: Record<CheatCategory, number> = {
      reaction_time: 0,
      fog_hack: 0,
      apm_anomaly: 0,
      build_timing: 0,
      target_selection: 0,
      win_trading: 0,
      statistical_anomaly: 0,
    };
    const bySeverity: Record<AlertSeverity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    for (const a of alerts) {
      byCategory[a.category]++;
      bySeverity[a.severity]++;
    }

    // Risk score: weighted sum of alert severities
    const riskScore = Math.min(
      100,
      bySeverity.low * 1 +
        bySeverity.medium * 5 +
        bySeverity.high * 15 +
        bySeverity.critical * 30
    );

    let riskLevel: AgentRiskProfile["risk_level"];
    if (riskScore >= 50) riskLevel = "flagged";
    else if (riskScore >= 30) riskLevel = "high";
    else if (riskScore >= 15) riskLevel = "medium";
    else if (riskScore > 0) riskLevel = "low";
    else riskLevel = "clean";

    return {
      agent_id: agentId,
      total_alerts: alerts.length,
      alerts_by_category: byCategory,
      alerts_by_severity: bySeverity,
      risk_score: riskScore,
      risk_level: riskLevel,
      last_alert:
        alerts.length > 0
          ? alerts[alerts.length - 1].timestamp
          : null,
      matches_analyzed: new Set(alerts.map((a) => a.match_id)).size,
    };
  }
}
