#!/usr/bin/env node

/**
 * IronCurtain Broadcaster — Live AI Commentary System
 *
 * Watches live matches via the Arena's spectator WebSocket and generates
 * real-time esports-style commentary with TTS voice output.
 *
 * The Broadcaster is a SPECTATOR — it sees everything (both players' views)
 * and narrates the action for entertainment.
 *
 * Connection modes:
 *   1. Arena WebSocket (--arena ws://host:port) — connect to a live arena match
 *   2. Local IPC socket (--socket /tmp/openra-mcp.sock) — connect to local game
 *   3. Demo mode (--demo) — generate synthetic events for testing
 *
 * Usage:
 *   npx tsx src/index.ts --style esports --arena ws://localhost:8081 --match abc123
 *   npx tsx src/index.ts --style skippy_trash_talk --socket /tmp/openra-mcp.sock
 *   npx tsx src/index.ts --style documentary --demo
 */

import WebSocket from "ws";
import * as net from "net";
import * as readline from "readline";

import { EventDetector } from "./event-detector.js";
import { CommentaryGenerator } from "./commentary-gen.js";
import { TTSPipeline } from "./tts-pipeline.js";
import { OverlayServer } from "./overlay-server.js";
import { CommentaryStyle, GameState, CommentaryChunk } from "./types.js";

// ── CLI Argument Parsing ────────────────────────────

function getArg(name: string, fallback: string): string;
function getArg(name: string, fallback?: undefined): string | undefined;
function getArg(name: string, fallback?: string): string | undefined {
  const flag = `--${name}=`;
  const found = process.argv.find(a => a.startsWith(flag));
  if (found) return found.slice(flag.length);

  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];

  return fallback;
}

const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const style = (getArg("style", "esports")) as CommentaryStyle;
const arenaUrl = getArg("arena");
const matchId = getArg("match");
const socketPath = getArg("socket", "/tmp/openra-mcp.sock");
const overlayPort = parseInt(getArg("overlay-port", "8080")!);
const demoMode = hasFlag("demo");
const noTts = hasFlag("no-tts");

// Validate style
const VALID_STYLES: CommentaryStyle[] = ["esports", "war_correspondent", "skippy_trash_talk", "documentary"];
if (!VALID_STYLES.includes(style)) {
  console.error(`❌ Invalid style "${style}". Valid styles: ${VALID_STYLES.join(", ")}`);
  process.exit(1);
}

// ── Component Initialization ────────────────────────

console.error(`🎙️  IronCurtain Broadcaster starting...`);
console.error(`   Style: ${style}`);
console.error(`   Mode:  ${arenaUrl ? "Arena WebSocket" : demoMode ? "Demo" : "Local IPC"}`);
console.error(`   TTS:   ${noTts ? "DISABLED" : "enabled"}`);
console.error(`   Overlay: http://localhost:${overlayPort}`);

const eventDetector = new EventDetector();
const commentaryGen = new CommentaryGenerator(style);
const ttsPipeline = noTts ? null : new TTSPipeline(style);
const overlayServer = new OverlayServer(overlayPort);

// Wire TTS speak events to subtitle overlay
ttsPipeline?.onSpeakStart((text) => {
  overlayServer.broadcastSubtitle(text);
});

// Start overlay server
overlayServer.start();

// Track whether we've done intro/outro
let matchStarted = false;
let matchEnded = false;
let isSpeaking = false;

// ── Main Event Handler ──────────────────────────────

async function handleGameState(state: GameState): Promise<void> {
  // Don't queue up if we're still speaking (pacing control)
  if (isSpeaking) return;

  // Match intro
  if (!matchStarted && state.tick > 0 && Object.keys(state.players).length >= 2) {
    matchStarted = true;
    const intro = await commentaryGen.generateMatchIntro(state);
    if (intro) await speakChunk(intro, state);
  }

  // Detect events
  const events = eventDetector.detect(state);

  // Forward state to overlay
  overlayServer.broadcastState(state);

  // Forward kill events to overlay kill feed
  if (state.events) {
    for (const raw of state.events) {
      if (raw.type === "unit_destroyed" && raw.attackerPlayer && raw.player) {
        overlayServer.broadcastKill(
          raw.attackerPlayer,
          raw.attackerType ?? "?",
          raw.player,
          raw.actorType ?? "?",
        );
      }
    }
  }

  // Forward notable events to overlay event banner
  for (const event of events) {
    if (event.severity === "exciting" || event.severity === "critical" || event.severity === "legendary") {
      overlayServer.broadcastEvent(event.type, event.severity, event.description);
    }
  }

  // Generate commentary
  if (events.length > 0 || eventDetector.shouldGenerateFiller()) {
    const chunks = await commentaryGen.generate(events, state);

    for (const chunk of chunks) {
      await speakChunk(chunk, state);
    }
  }

  // Match outro
  if (state.isGameOver && !matchEnded) {
    matchEnded = true;
    const outro = await commentaryGen.generateMatchOutro(state);
    if (outro) await speakChunk(outro, state);
  }
}

async function speakChunk(chunk: CommentaryChunk, state: GameState): Promise<void> {
  // Always send to overlay
  overlayServer.broadcastSubtitle(chunk.text, chunk.emotion, chunk.priority);

  // Send to TTS
  if (ttsPipeline) {
    isSpeaking = true;
    try {
      await ttsPipeline.speak(chunk);
    } finally {
      isSpeaking = false;
    }
  }
}

// ── Connection Mode: Arena WebSocket ────────────────

function connectToArena(url: string, matchIdToWatch?: string): void {
  const wsUrl = matchIdToWatch
    ? `${url}/match/${matchIdToWatch}/spectate`
    : url;

  console.error(`🌐 Connecting to Arena: ${wsUrl}`);

  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.error(`🎮 Connected to Arena match!`);
    console.error(`🎙️  BROADCASTING LIVE — Style: ${style.toUpperCase()}`);
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "state_update" || msg.type === "state") {
        await handleGameState(msg.data ?? msg);
      }
    } catch (e) {
      // Ignore malformed messages
    }
  });

  ws.on("error", (err) => {
    console.error(`⚠️  Arena connection error:`, err.message);
  });

  ws.on("close", (code, reason) => {
    console.error(`🔌 Arena disconnected (${code}). Reconnecting in 3s...`);
    setTimeout(() => connectToArena(url, matchIdToWatch), 3000);
  });
}

// ── Connection Mode: Local IPC Socket ───────────────

function connectToLocalGame(path: string): void {
  const socket = new net.Socket();

  const tryConnect = () => {
    socket.connect(path, () => {
      console.error(`🎮 Connected to local OpenRA game!`);
      console.error(`🎙️  BROADCASTING LIVE — Style: ${style.toUpperCase()}`);

      // Subscribe to events
      socket.write(JSON.stringify({
        id: 0,
        method: "subscribe",
        params: { events: ["state_update", "unit_destroyed", "building_complete", "under_attack"] },
      }) + "\n");
    });
  };

  socket.on("error", () => {
    console.error("⏳ Waiting for game to start...");
    setTimeout(tryConnect, 3000);
  });

  socket.on("close", () => {
    console.error("🔌 Game disconnected. Reconnecting in 3s...");
    setTimeout(tryConnect, 3000);
  });

  const rl = readline.createInterface({ input: socket });
  rl.on("line", async (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.event === "state_update") {
        await handleGameState(msg.data);
      }
    } catch {
      // Ignore malformed
    }
  });

  tryConnect();
}

// ── Connection Mode: Demo ───────────────────────────

function runDemoMode(): void {
  console.error(`🎭 Running in DEMO mode — generating synthetic match events`);

  let tick = 0;
  const TICK_RATE = 25; // ticks per second
  const UPDATE_INTERVAL = 200; // ms between updates

  const makeState = (): GameState => {
    const minutes = tick / TICK_RATE / 60;

    const state: GameState = {
      tick,
      isGameOver: minutes > 8,
      winner: minutes > 8 ? "Skippy" : undefined,
      mapName: "Tournament Arena A",
      players: {
        "Skippy": {
          name: "Skippy",
          faction: "soviet",
          credits: Math.max(0, 5000 + Math.floor(Math.random() * 3000) - tick * 2),
          unitCount: Math.min(40, Math.floor(tick / 200) + Math.floor(Math.random() * 5)),
          buildingCount: Math.min(15, 1 + Math.floor(tick / 400)),
          kills: Math.floor(tick / 600),
          losses: Math.floor(tick / 800),
          powerState: "normal",
          productionQueue: [],
          isAlive: true,
        },
        "HumanPlayer": {
          name: "HumanPlayer",
          faction: "allied",
          credits: Math.max(0, 5000 + Math.floor(Math.random() * 2000) - tick * 3),
          unitCount: Math.min(30, Math.floor(tick / 250) + Math.floor(Math.random() * 4)),
          buildingCount: Math.min(12, 1 + Math.floor(tick / 500)),
          kills: Math.floor(tick / 750),
          losses: Math.floor(tick / 500),
          powerState: minutes > 6 ? "low" : "normal",
          productionQueue: [],
          isAlive: minutes < 8,
        },
      },
      events: [],
    };

    // Inject synthetic events at key moments
    if (tick === 100) {
      state.events = [{ type: "building_complete", player: "Skippy", actorType: "barr" }];
    }
    if (tick === 500) {
      state.events = [{ type: "building_complete", player: "Skippy", actorType: "dome" }];
    }
    if (tick === 1500) {
      state.events = [
        { type: "unit_destroyed", player: "HumanPlayer", actorType: "1tnk", attackerPlayer: "Skippy", attackerType: "2tnk" },
        { type: "unit_destroyed", player: "HumanPlayer", actorType: "1tnk", attackerPlayer: "Skippy", attackerType: "2tnk" },
      ];
    }
    if (tick === 4000) {
      state.events = [{ type: "building_complete", player: "Skippy", actorType: "iron" }];
    }
    if (tick === 7000) {
      state.events = [{ type: "superweapon_launched", player: "Skippy", actorType: "iron", targetPlayer: "HumanPlayer" }];
    }
    if (tick === 10000) {
      state.events = [{ type: "building_destroyed", player: "HumanPlayer", actorType: "fact", attackerPlayer: "Skippy" }];
    }

    return state;
  };

  const interval = setInterval(async () => {
    tick += TICK_RATE * (UPDATE_INTERVAL / 1000); // Advance ticks based on real time

    const state = makeState();
    await handleGameState(state);

    // Stop after game over + some extra for outro
    if (state.isGameOver && tick > 13000) {
      clearInterval(interval);
      console.error("\n🏁 Demo complete!");
      setTimeout(() => process.exit(0), 5000);
    }
  }, UPDATE_INTERVAL);
}

// ── Start ───────────────────────────────────────────

if (arenaUrl) {
  connectToArena(arenaUrl, matchId);
} else if (demoMode) {
  runDemoMode();
} else {
  connectToLocalGame(socketPath ?? "/tmp/openra-mcp.sock");
}

// ── Graceful Shutdown ───────────────────────────────

process.on("SIGINT", () => {
  console.error("\n🛑 Broadcaster shutting down...");
  ttsPipeline?.shutdown();
  overlayServer.shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  ttsPipeline?.shutdown();
  overlayServer.shutdown();
  process.exit(0);
});

// ── Banner ──────────────────────────────────────────

const modeStr = arenaUrl ? `Arena: ${arenaUrl}` : demoMode ? "Demo Mode" : `Socket: ${socketPath}`;

console.error(`
╔════════════════════════════════════════════════════════════╗
║          🎙️  IRONCURTAIN BROADCAST SYSTEM  🎙️             ║
║                                                            ║
║  Status: ${demoMode ? "DEMO MODE" : "AWAITING GAME"}                                    ║
║  Style:  ${style.padEnd(48)}║
║  Mode:   ${modeStr.padEnd(48)}║
║                                                            ║
║  Overlay URLs (add as OBS Browser Sources):                ║
║    Stats:      http://localhost:${String(overlayPort).padEnd(5)}/overlay              ║
║    Subtitles:  http://localhost:${String(overlayPort).padEnd(5)}/subtitles            ║
║    Kill Feed:  http://localhost:${String(overlayPort).padEnd(5)}/killfeed             ║
║    Dashboard:  http://localhost:${String(overlayPort).padEnd(5)}/dashboard            ║
║                                                            ║
║  Audio: Routes to system audio or virtual device           ║
║         (BlackHole / PulseAudio)                           ║
╚════════════════════════════════════════════════════════════╝
`);
