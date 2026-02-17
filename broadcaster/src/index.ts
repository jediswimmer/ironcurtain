#!/usr/bin/env node

/**
 * CnC Red Alert Broadcaster Agent
 * 
 * Watches game state and generates live esports-style commentary via TTS.
 * Connects to the same IPC socket as the MCP server to receive game events.
 * 
 * The Broadcaster is a SPECTATOR — it sees everything (both players' perspectives)
 * and narrates the action for entertainment.
 * 
 * Usage:
 *   npx tsx src/index.ts --style esports
 *   npx tsx src/index.ts --style war_correspondent
 *   npx tsx src/index.ts --style skippy_trash_talk
 *   npx tsx src/index.ts --style documentary
 */

import { EventDetector } from "./event-detector.js";
import { CommentaryGenerator, CommentaryStyle } from "./commentary-gen.js";
import { TTSPipeline } from "./tts-pipeline.js";
import { OverlayServer } from "./overlay-server.js";
import * as net from "net";
import * as readline from "readline";

// Parse CLI args
const style = (process.argv.find(a => a.startsWith("--style="))?.split("=")[1] 
  ?? process.argv[process.argv.indexOf("--style") + 1]
  ?? "esports") as CommentaryStyle;

const socketPath = process.argv.find(a => a.startsWith("--socket="))?.split("=")[1] 
  ?? "/tmp/openra-mcp.sock";

const overlayPort = parseInt(
  process.argv.find(a => a.startsWith("--overlay-port="))?.split("=")[1] ?? "8080"
);

console.error(`🎙️  CnC Red Alert Broadcaster starting...`);
console.error(`   Style: ${style}`);
console.error(`   Socket: ${socketPath}`);
console.error(`   Overlay: http://localhost:${overlayPort}`);

// Initialize components
const eventDetector = new EventDetector();
const commentaryGen = new CommentaryGenerator(style);
const ttsPipeline = new TTSPipeline(style);
const overlayServer = new OverlayServer(overlayPort);

// Start overlay web server
overlayServer.start();

// Connect to ExternalBot's IPC socket
function connectToGame() {
  const socket = new net.Socket();
  
  const tryConnect = () => {
    socket.connect(socketPath, () => {
      console.error(`🎮 Connected to OpenRA game!`);
      console.error(`🎙️  BROADCASTING LIVE — Style: ${style.toUpperCase()}`);
      
      // Send a subscribe request
      socket.write(JSON.stringify({
        id: 0,
        method: "subscribe",
        params: { events: ["state_update", "unit_destroyed", "building_complete", "under_attack"] }
      }) + "\n");
    });
  };
  
  socket.on("error", () => {
    console.error("⏳ Waiting for game to start...");
    setTimeout(tryConnect, 3000);
  });
  
  socket.on("close", () => {
    console.error("🔌 Game disconnected. Waiting for reconnect...");
    setTimeout(tryConnect, 3000);
  });
  
  const rl = readline.createInterface({ input: socket });
  
  rl.on("line", async (line) => {
    try {
      const msg = JSON.parse(line);
      
      if (msg.event === "state_update") {
        await handleStateUpdate(msg.data);
      } else if (msg.result) {
        // Response to our subscribe request — ignore
      }
    } catch (e) {
      // Ignore malformed messages
    }
  });
  
  tryConnect();
}

async function handleStateUpdate(data: any) {
  // 1. Detect events from state changes
  const events = eventDetector.detect(data);
  
  // 2. Forward state to overlay
  overlayServer.broadcastState(data);
  
  // 3. Generate commentary for detected events
  if (events.length > 0 || eventDetector.shouldGenerateFiller()) {
    const chunks = await commentaryGen.generate(events, data);
    
    for (const chunk of chunks) {
      // 4. Send to overlay as subtitles
      overlayServer.broadcastSubtitle(chunk.text);
      
      // 5. Send to TTS pipeline
      await ttsPipeline.speak(chunk);
    }
  }
}

// Fire it up
connectToGame();

console.error(`
╔══════════════════════════════════════════════════╗
║       🎙️  RED ALERT BROADCAST SYSTEM  🎙️        ║
║                                                  ║
║  Status: AWAITING GAME                           ║
║  Style:  ${style.padEnd(40)}║
║                                                  ║
║  Overlay URLs (add as OBS Browser Sources):      ║
║    Stats:     http://localhost:${overlayPort}/overlay     ║
║    Subtitles: http://localhost:${overlayPort}/subtitles   ║
║                                                  ║
║  Audio: Routes to virtual audio device           ║
║         (BlackHole / PulseAudio)                 ║
╚══════════════════════════════════════════════════╝
`);
