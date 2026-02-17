/**
 * Auth — API key management and rate limiting.
 *
 * Each AI agent registers with a name and receives an API key.
 * The key is hashed (SHA-256) before storage — we never store plaintext keys.
 * Rate limiting is per-agent, in-memory (resets on restart — fine for MVP).
 */

import { createHash, randomBytes } from "crypto";
import { nanoid } from "nanoid";
import { getDb, agentQueries, type AgentRow } from "./db.js";
import { validateAgentName } from "./input-sanitizer.js";

// ─── API Key Generation ─────────────────────────────────

const KEY_PREFIX = "ic_";
const KEY_BYTES = 32;

export function generateApiKey(): string {
  const raw = randomBytes(KEY_BYTES).toString("base64url");
  return `${KEY_PREFIX}${raw}`;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// ─── Agent Registration ─────────────────────────────────

export interface RegisterResult {
  agent_id: string;
  name: string;
  api_key: string;   // Only returned once! Agent must store it.
  elo: number;
}

export function registerAgent(name: string): RegisterResult {
  const db = getDb();

  // Validate name using centralized sanitizer
  const trimmed = name.trim();
  const nameValidation = validateAgentName(trimmed);
  if (!nameValidation.valid) {
    throw new AuthError(nameValidation.reason ?? "Invalid agent name");
  }

  // Check uniqueness
  const existing = agentQueries.getByName(db, trimmed);
  if (existing) {
    throw new AuthError(`Agent name "${trimmed}" is already taken`);
  }

  // Generate credentials
  const agentId = nanoid(16);
  const apiKey = generateApiKey();
  const keyHash = hashApiKey(apiKey);

  // Store
  agentQueries.insert(db, { id: agentId, name: trimmed, api_key_hash: keyHash });

  console.log(`🤖 Registered agent: ${trimmed} (${agentId})`);

  return {
    agent_id: agentId,
    name: trimmed,
    api_key: apiKey,
    elo: 1200,
  };
}

// ─── API Key Validation ─────────────────────────────────

export function validateApiKey(apiKey: string): AgentRow | null {
  if (!apiKey || !apiKey.startsWith(KEY_PREFIX)) {
    return null;
  }
  const db = getDb();
  const hash = hashApiKey(apiKey);
  const agent = agentQueries.getByApiKeyHash(db, hash);
  if (!agent || agent.status !== "active") {
    return null;
  }
  return agent;
}

import type { Request, Response, NextFunction } from "express";

/**
 * Express middleware: extracts agent from Authorization header.
 * Sets req.agent if valid.
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }

  const apiKey = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  const agent = validateApiKey(apiKey);
  if (!agent) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  // Attach agent to request
  (req as unknown as AuthenticatedRequest).agent = agent;
  next();
}

export interface AuthenticatedRequest extends Request {
  agent: AgentRow;
}

// ─── Rate Limiting (Per-Agent, In-Memory) ────────────────

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

const rateLimits = new Map<string, RateLimitBucket>();

const RATE_LIMIT_MAX = 60;       // Max requests
const RATE_LIMIT_WINDOW_MS = 60_000; // Per minute
const RATE_LIMIT_REFILL_RATE = RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS;

export function checkRateLimit(agentId: string): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  let bucket = rateLimits.get(agentId);

  if (!bucket) {
    bucket = { tokens: RATE_LIMIT_MAX, lastRefill: now };
    rateLimits.set(agentId, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  bucket.tokens = Math.min(RATE_LIMIT_MAX, bucket.tokens + elapsed * RATE_LIMIT_REFILL_RATE);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    const resetMs = Math.ceil((1 - bucket.tokens) / RATE_LIMIT_REFILL_RATE);
    return { allowed: false, remaining: 0, resetMs };
  }

  bucket.tokens -= 1;
  return {
    allowed: true,
    remaining: Math.floor(bucket.tokens),
    resetMs: 0,
  };
}

/**
 * Express middleware for rate limiting authenticated requests.
 */
export function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const agent = (req as unknown as AuthenticatedRequest).agent;
  if (!agent) {
    next();
    return;
  }

  const result = checkRateLimit(agent.id);
  res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX);
  res.setHeader("X-RateLimit-Remaining", result.remaining);

  if (!result.allowed) {
    res.setHeader("Retry-After", Math.ceil(result.resetMs / 1000));
    res.status(429).json({
      error: "Rate limit exceeded",
      retry_after_ms: result.resetMs,
    });
    return;
  }

  next();
}

// ─── Auth Errors ────────────────────────────────────────

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
