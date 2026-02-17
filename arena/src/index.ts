#!/usr/bin/env node

/**
 * IronCurtain Arena Server
 *
 * The central matchmaking and game management server for the AI RTS platform.
 * Handles agent registration, ELO-based matchmaking, game server lifecycle,
 * anti-cheat enforcement, and spectator streaming.
 *
 * Think chess.com, but for AI agents playing Red Alert.
 *
 * Architecture:
 *   Agents ──WebSocket──→ Arena Server ──IPC──→ OpenRA Dedicated Servers
 *   Spectators ──WebSocket──→ Arena Server (god-view, with commentary)
 *
 * See ARCHITECTURE.md for full design.
 */

import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import helmet from "helmet";
import { mkdirSync } from "fs";
import { resolve } from "path";

import { getDb, closeDb } from "./db.js";
import { Matchmaker } from "./matchmaker.js";
import { GameServerManager } from "./game-server-mgr.js";
import { Leaderboard } from "./leaderboard.js";
import { registerAgentRoutes } from "./api/agents.js";
import { registerQueueRoutes } from "./api/queue.js";
import { registerMatchRoutes } from "./api/matches.js";
import { registerLeaderboardRoutes } from "./api/leaderboard.js";
import { registerTournamentRoutes } from "./api/tournaments.js";

// ─── Config ─────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "8080");
const HOST = process.env.HOST ?? "0.0.0.0";

// Ensure data directory exists for SQLite
const dataDir = resolve(process.env.ARENA_DATA_DIR ?? "data");
mkdirSync(dataDir, { recursive: true });

// ─── Initialize Core Services ───────────────────────────

// Initialize DB (creates tables on first run)
const db = getDb();
console.log("💾 Database initialized");

const matchmaker = new Matchmaker();
const leaderboard = new Leaderboard();
const gameServerMgr = new GameServerManager(leaderboard, matchmaker);

// ─── Express REST API ───────────────────────────────────

const app = express();

// Security & parsing
app.use(cors());
app.use(helmet());
app.use(express.json({ limit: "1mb" }));

// Request logging (minimal)
app.use((req, _res, next) => {
  if (req.path !== "/health") {
    console.log(`${req.method} ${req.path}`);
  }
  next();
});

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "0.1.0",
    uptime: process.uptime(),
    matches_live: gameServerMgr.getLiveMatches().length,
  });
});

// API routes
registerAgentRoutes(app);
registerQueueRoutes(app, matchmaker);
registerMatchRoutes(app, gameServerMgr);
registerLeaderboardRoutes(app, leaderboard);
registerTournamentRoutes(app);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ─── HTTP + WebSocket Server ────────────────────────────

const httpServer = createServer(app);

// WebSocket server shares the HTTP server (upgrade handling)
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  // Route based on path
  if (path.startsWith("/ws/match/") && path.endsWith("/agent")) {
    // Agent connecting to a match: /ws/match/{matchId}/agent
    const parts = path.split("/");
    const matchId = parts[3];
    gameServerMgr.handleAgentConnection(matchId, ws);
  } else if (path.startsWith("/ws/spectate/")) {
    // Spectator connecting: /ws/spectate/{matchId}
    const matchId = path.split("/")[3];
    gameServerMgr.handleSpectatorConnection(matchId, ws);
  } else if (path === "/ws/queue") {
    // Agent queue connection (real-time match notifications)
    matchmaker.handleQueueConnection(ws);
  } else {
    ws.close(4004, `Unknown WebSocket path: ${path}`);
  }
});

// ─── Matchmaker Tick ────────────────────────────────────

const MATCHMAKER_INTERVAL_MS = 5_000;

const matchmakerTimer = setInterval(async () => {
  try {
    const pairings = await matchmaker.tick();
    for (const pairing of pairings) {
      try {
        await gameServerMgr.createMatch(pairing);
      } catch (err) {
        console.error("Failed to create match:", err);
      }
    }
  } catch (err) {
    console.error("Matchmaker tick error:", err);
  }
}, MATCHMAKER_INTERVAL_MS);

// ─── Game Server Events ────────────────────────────────

gameServerMgr.on("match_started", ({ matchId, players }) => {
  console.log(`📡 Event: match_started ${matchId}`);
  // TODO(#4): Discord webhook notification
  // TODO(#5): Twitch stream start
});

gameServerMgr.on("match_ended", (result) => {
  console.log(`📡 Event: match_ended ${result.match_id}`);
  // TODO(#6): Discord webhook result
});

// ─── Start Server ───────────────────────────────────────

httpServer.listen(PORT, HOST, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║           🏟️  IRONCURTAIN ARENA — AI RTS Platform  🏟️    ║
║                                                          ║
║  Server:    http://${HOST}:${PORT}                            ║
║  WebSocket: ws://${HOST}:${PORT}                              ║
║                                                          ║
║  REST Endpoints:                                         ║
║    POST /api/agents/register    Register an AI agent     ║
║    GET  /api/agents/:id         Agent profile + stats    ║
║    GET  /api/leaderboard        View rankings            ║
║    POST /api/queue/join         Join match queue          ║
║    GET  /api/queue/status       Queue depth & wait times ║
║    GET  /api/matches            Match history            ║
║    GET  /api/matches/live       Currently running        ║
║    GET  /api/matches/:id        Match details            ║
║                                                          ║
║  WebSocket Endpoints:                                    ║
║    /ws/queue                    Join match queue (RT)     ║
║    /ws/match/:id/agent          Connect to match          ║
║    /ws/spectate/:id             Spectate a live match     ║
║                                                          ║
║  Status: ONLINE — Waiting for challengers...             ║
╚══════════════════════════════════════════════════════════╝
`);
});

// ─── Graceful Shutdown ──────────────────────────────────

function shutdown(signal: string) {
  console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);

  clearInterval(matchmakerTimer);

  // Close WebSocket connections
  wss.clients.forEach(ws => ws.close(1001, "Server shutting down"));
  wss.close();

  // Close HTTP server
  httpServer.close(() => {
    console.log("HTTP server closed");
  });

  // Close database
  closeDb();
  console.log("Database closed");

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
