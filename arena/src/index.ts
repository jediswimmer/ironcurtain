#!/usr/bin/env node

/**
 * CnC Arena Server
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
 * See ARCHITECTURE.md Section 9 for full design.
 */

import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import helmet from "helmet";
import { Matchmaker } from "./matchmaker.js";
import { GameServerManager } from "./game-server-mgr.js";
import { Leaderboard } from "./leaderboard.js";
import { registerAgentRoutes } from "./api/agents.js";
import { registerQueueRoutes } from "./api/queue.js";
import { registerMatchRoutes } from "./api/matches.js";
import { registerLeaderboardRoutes } from "./api/leaderboard.js";
import { registerTournamentRoutes } from "./api/tournaments.js";

const PORT = parseInt(process.env.PORT ?? "8080");
const WS_PORT = parseInt(process.env.WS_PORT ?? "8081");

// Initialize core services
const matchmaker = new Matchmaker();
const gameServerMgr = new GameServerManager();
const leaderboard = new Leaderboard();

// ─── REST API ───────────────────────────────────────

const app = express();
app.use(cors());
app.use(helmet());
app.use(express.json());

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok", version: "0.1.0" }));

// API routes
registerAgentRoutes(app);
registerQueueRoutes(app, matchmaker);
registerMatchRoutes(app, gameServerMgr);
registerLeaderboardRoutes(app, leaderboard);
registerTournamentRoutes(app);

const httpServer = createServer(app);
httpServer.listen(PORT, () => {
  console.log(`🏟️  Arena REST API listening on port ${PORT}`);
});

// ─── WebSocket Server ───────────────────────────────

const wss = new WebSocketServer({ port: WS_PORT });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", `http://localhost:${WS_PORT}`);
  const path = url.pathname;
  
  // Route based on path
  if (path.startsWith("/match/") && path.endsWith("/agent")) {
    // Agent connecting to a match
    const matchId = path.split("/")[2];
    gameServerMgr.handleAgentConnection(matchId, ws);
  } else if (path.startsWith("/match/") && path.endsWith("/spectate")) {
    // Spectator connecting to a match
    const matchId = path.split("/")[2];
    gameServerMgr.handleSpectatorConnection(matchId, ws);
  } else if (path === "/queue") {
    // Agent queue connection (for real-time match notifications)
    matchmaker.handleQueueConnection(ws);
  } else {
    ws.close(4004, "Unknown path");
  }
});

console.log(`🏟️  Arena WebSocket server listening on port ${WS_PORT}`);

// ─── Matchmaker Tick ────────────────────────────────

// Run matchmaker every 5 seconds
setInterval(async () => {
  try {
    const matches = await matchmaker.tick();
    for (const match of matches) {
      await gameServerMgr.createMatch(match);
    }
  } catch (e) {
    console.error("Matchmaker error:", e);
  }
}, 5000);

// ─── Startup Banner ─────────────────────────────────

console.log(`
╔══════════════════════════════════════════════════════╗
║            🏟️  THE ARENA — AI RTS Platform  🏟️       ║
║                                                      ║
║  REST API:    http://localhost:${PORT}                   ║
║  WebSocket:   ws://localhost:${WS_PORT}                    ║
║                                                      ║
║  Endpoints:                                          ║
║    POST /api/agents/register    Register an agent    ║
║    POST /api/queue/join         Join match queue     ║
║    GET  /api/matches/live       List live matches    ║
║    GET  /api/leaderboard        View rankings        ║
║                                                      ║
║  Status: ONLINE — Waiting for challengers...         ║
╚══════════════════════════════════════════════════════╝
`);
