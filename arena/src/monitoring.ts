/**
 * Monitoring & Logging — Structured observability for the IronCurtain Arena.
 *
 * Provides:
 *   - Structured JSON logging with severity levels
 *   - Metrics collection (counters, gauges, histograms)
 *   - Health check with detailed subsystem status
 *   - Performance tracking (match durations, queue times, API latency)
 *   - Express middleware for request logging and metrics
 *   - Periodic metrics summary output
 *
 * In production, metrics would feed into Prometheus/Grafana.
 * For now, structured logs + in-memory metrics with API exposure.
 */

import type { Request, Response, NextFunction, Express } from "express";

// ─── Log Levels ─────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

// ─── Structured Log Entry ───────────────────────────────

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
  match_id?: string;
  agent_id?: string;
  duration_ms?: number;
  error?: string;
}

// ─── Metric Types ───────────────────────────────────────

export interface CounterMetric {
  type: "counter";
  name: string;
  value: number;
  labels: Record<string, string>;
}

export interface GaugeMetric {
  type: "gauge";
  name: string;
  value: number;
  labels: Record<string, string>;
}

export interface HistogramMetric {
  type: "histogram";
  name: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  labels: Record<string, string>;
}

// ─── Logger ─────────────────────────────────────────────

export class Logger {
  private minLevel: LogLevel;
  private component: string;
  private recentLogs: LogEntry[] = [];
  private maxRecentLogs = 1000;

  constructor(component: string, minLevel: LogLevel = "info") {
    this.component = component;
    this.minLevel = minLevel;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, error?: Error | string, data?: Record<string, unknown>): void {
    const errorStr = error instanceof Error ? error.message : error;
    this.log("error", message, { ...data, error: errorStr });
  }

  fatal(message: string, error?: Error | string, data?: Record<string, unknown>): void {
    const errorStr = error instanceof Error ? error.message : error;
    this.log("fatal", message, { ...data, error: errorStr });
  }

  /**
   * Create a child logger with a sub-component name.
   */
  child(subComponent: string): Logger {
    return new Logger(`${this.component}.${subComponent}`, this.minLevel);
  }

  /**
   * Get recent log entries (for the monitoring API).
   */
  getRecentLogs(
    opts: { level?: LogLevel; limit?: number; component?: string } = {}
  ): LogEntry[] {
    let logs = this.recentLogs;

    if (opts.level) {
      const minPriority = LOG_LEVEL_PRIORITY[opts.level];
      logs = logs.filter(
        (l) => LOG_LEVEL_PRIORITY[l.level] >= minPriority
      );
    }

    if (opts.component) {
      logs = logs.filter((l) => l.component.startsWith(opts.component!));
    }

    const limit = opts.limit ?? 100;
    return logs.slice(-limit);
  }

  // ─── Private ────────────────────────────────────────────

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      data,
    };

    // Structured output to console
    const emoji = { debug: "🔍", info: "ℹ️", warn: "⚠️", error: "❌", fatal: "💀" }[level];
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    console.log(
      `${emoji} [${entry.timestamp}] [${this.component}] ${message}${dataStr}`
    );

    // Store in recent logs ring buffer
    this.recentLogs.push(entry);
    if (this.recentLogs.length > this.maxRecentLogs) {
      this.recentLogs = this.recentLogs.slice(-this.maxRecentLogs);
    }
  }
}

// ─── Metrics Collector ──────────────────────────────────

export class MetricsCollector {
  private counters = new Map<string, { value: number; labels: Record<string, string> }>();
  private gauges = new Map<string, { value: number; labels: Record<string, string> }>();
  private histograms = new Map<
    string,
    { values: number[]; labels: Record<string, string> }
  >();

  private startTime = Date.now();

  // ─── Counter Operations ─────────────────────────────

  increment(name: string, labels: Record<string, string> = {}, amount: number = 1): void {
    const key = this.makeKey(name, labels);
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += amount;
    } else {
      this.counters.set(key, { value: amount, labels });
    }
  }

  // ─── Gauge Operations ──────────────────────────────

  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.makeKey(name, labels);
    this.gauges.set(key, { value, labels });
  }

  // ─── Histogram Operations ──────────────────────────

  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.makeKey(name, labels);
    const existing = this.histograms.get(key);
    if (existing) {
      existing.values.push(value);
      // Keep last 1000 observations
      if (existing.values.length > 1000) {
        existing.values = existing.values.slice(-1000);
      }
    } else {
      this.histograms.set(key, { values: [value], labels });
    }
  }

  /**
   * Time a function and record its duration.
   */
  async time<T>(
    name: string,
    fn: () => Promise<T>,
    labels: Record<string, string> = {}
  ): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      this.observe(name, Date.now() - start, labels);
    }
  }

  // ─── Snapshot ──────────────────────────────────────

  /**
   * Get all metrics as a structured snapshot.
   */
  getSnapshot(): {
    uptime_secs: number;
    counters: CounterMetric[];
    gauges: GaugeMetric[];
    histograms: HistogramMetric[];
  } {
    const counters: CounterMetric[] = [];
    for (const [, data] of this.counters) {
      counters.push({
        type: "counter",
        name: this.extractName(data.labels),
        value: data.value,
        labels: data.labels,
      });
    }

    const gauges: GaugeMetric[] = [];
    for (const [, data] of this.gauges) {
      gauges.push({
        type: "gauge",
        name: this.extractName(data.labels),
        value: data.value,
        labels: data.labels,
      });
    }

    const histograms: HistogramMetric[] = [];
    for (const [, data] of this.histograms) {
      const sorted = [...data.values].sort((a, b) => a - b);
      const count = sorted.length;
      const sum = sorted.reduce((a, b) => a + b, 0);

      histograms.push({
        type: "histogram",
        name: this.extractName(data.labels),
        count,
        sum,
        min: sorted[0] ?? 0,
        max: sorted[count - 1] ?? 0,
        avg: count > 0 ? Math.round(sum / count) : 0,
        p50: sorted[Math.floor(count * 0.5)] ?? 0,
        p95: sorted[Math.floor(count * 0.95)] ?? 0,
        p99: sorted[Math.floor(count * 0.99)] ?? 0,
        labels: data.labels,
      });
    }

    return {
      uptime_secs: Math.floor((Date.now() - this.startTime) / 1000),
      counters,
      gauges,
      histograms,
    };
  }

  // ─── Private ────────────────────────────────────────

  private makeKey(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return `${name}{${labelStr}}`;
  }

  private extractName(labels: Record<string, string>): string {
    return labels.__name ?? "unknown";
  }
}

// ─── Health Check ───────────────────────────────────────

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  protocol_version: string;
  uptime_secs: number;
  subsystems: {
    database: SubsystemStatus;
    matchmaker: SubsystemStatus;
    websocket: SubsystemStatus;
    game_servers: SubsystemStatus;
  };
  stats: {
    matches_live: number;
    matches_total: number;
    agents_registered: number;
    queue_depth: number;
  };
}

export interface SubsystemStatus {
  status: "up" | "degraded" | "down";
  message?: string;
  latency_ms?: number;
}

// ─── Express Middleware ─────────────────────────────────

/**
 * Create request logging and metrics middleware.
 */
export function createMonitoringMiddleware(
  logger: Logger,
  metrics: MetricsCollector
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip health checks from logging
    if (req.path === "/health" || req.path === "/api/monitoring/metrics") {
      next();
      return;
    }

    const start = Date.now();

    // Log the request when it completes
    res.on("finish", () => {
      const duration = Date.now() - start;
      const statusCode = res.statusCode;

      // Increment request counter
      metrics.increment("http_requests_total", {
        __name: "http_requests_total",
        method: req.method,
        path: req.route?.path ?? req.path,
        status: String(statusCode),
      });

      // Record request duration
      metrics.observe("http_request_duration_ms", duration, {
        __name: "http_request_duration_ms",
        method: req.method,
        path: req.route?.path ?? req.path,
      });

      // Log based on status
      if (statusCode >= 500) {
        logger.error(`${req.method} ${req.path} ${statusCode}`, undefined, {
          duration_ms: duration,
          status: statusCode,
        });
      } else if (statusCode >= 400) {
        logger.warn(`${req.method} ${req.path} ${statusCode}`, {
          duration_ms: duration,
          status: statusCode,
        });
      } else {
        logger.debug(`${req.method} ${req.path} ${statusCode}`, {
          duration_ms: duration,
        });
      }
    });

    next();
  };
}

/**
 * Register monitoring API routes.
 */
export function registerMonitoringRoutes(
  app: Express,
  logger: Logger,
  metrics: MetricsCollector,
  healthFn: () => HealthStatus
): void {
  /**
   * GET /api/monitoring/health — Detailed health check
   */
  app.get("/api/monitoring/health", (_req, res) => {
    const health = healthFn();
    const statusCode = health.status === "healthy" ? 200 : health.status === "degraded" ? 200 : 503;
    res.status(statusCode).json(health);
  });

  /**
   * GET /api/monitoring/metrics — Metrics snapshot
   */
  app.get("/api/monitoring/metrics", (_req, res) => {
    res.json(metrics.getSnapshot());
  });

  /**
   * GET /api/monitoring/logs — Recent structured logs
   */
  app.get("/api/monitoring/logs", (req, res) => {
    const level = (req.query.level as LogLevel) ?? undefined;
    const limit = parseInt(req.query.limit as string) || 100;
    const component = (req.query.component as string) ?? undefined;

    res.json({
      logs: logger.getRecentLogs({ level, limit, component }),
    });
  });
}
