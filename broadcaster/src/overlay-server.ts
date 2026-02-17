/**
 * Overlay Server — serves HTML overlays for OBS browser sources.
 * 
 * Provides:
 *   /overlay    — Stats bar showing both players' resources, armies, kills
 *   /subtitles  — Live commentary text (for when audio isn't available)
 * 
 * Uses WebSocket to push real-time updates to all connected browsers.
 */

import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import * as http from "http";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class OverlayServer {
  private port: number;
  private wss: WebSocketServer | null = null;
  private server: http.Server | null = null;
  
  constructor(port: number) {
    this.port = port;
  }
  
  start(): void {
    const app = express();
    this.server = http.createServer(app);
    this.wss = new WebSocketServer({ server: this.server });
    
    // Serve static overlay files
    const overlayDir = path.join(__dirname, "..", "overlay");
    app.use(express.static(overlayDir));
    
    // Fallback: serve inline overlay if files don't exist
    app.get("/overlay", (_req, res) => {
      res.type("html").send(OVERLAY_HTML);
    });
    
    app.get("/subtitles", (_req, res) => {
      res.type("html").send(SUBTITLES_HTML);
    });
    
    this.server.listen(this.port, () => {
      console.error(`📊 Overlay server: http://localhost:${this.port}/overlay`);
      console.error(`💬 Subtitles:      http://localhost:${this.port}/subtitles`);
    });
  }
  
  broadcastState(data: any): void {
    this.broadcast({ type: "state", data });
  }
  
  broadcastSubtitle(text: string): void {
    this.broadcast({ type: "subtitle", text });
  }
  
  private broadcast(msg: object): void {
    if (!this.wss) return;
    const json = JSON.stringify(msg);
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    });
  }
}

// ──────────────────────────────────────────────────────────
// Inline HTML templates (used if overlay/ files don't exist)
// ──────────────────────────────────────────────────────────

const OVERLAY_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { 
    background: transparent; 
    font-family: 'Segoe UI', 'Helvetica Neue', sans-serif;
    overflow: hidden;
  }
  .overlay {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: linear-gradient(180deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.65) 100%);
    border-top: 2px solid rgba(255,255,255,0.2);
    padding: 8px 24px;
    color: white;
    height: 80px;
  }
  .player {
    display: flex;
    align-items: center;
    gap: 16px;
    flex: 1;
  }
  .player.right { justify-content: flex-end; text-align: right; }
  .player-name {
    font-size: 18px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .soviet .player-name { color: #ff4444; }
  .allied .player-name { color: #4488ff; }
  .stats {
    display: flex;
    gap: 14px;
    font-size: 14px;
    opacity: 0.9;
  }
  .stat { display: flex; align-items: center; gap: 4px; }
  .stat-icon { font-size: 16px; }
  .timer {
    text-align: center;
    min-width: 80px;
  }
  .timer-value {
    font-size: 28px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .timer-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 2px;
    opacity: 0.6;
  }
</style>
</head>
<body>
<div class="overlay">
  <div class="player soviet">
    <div>
      <div class="player-name" id="p1-name">SKIPPY</div>
      <div class="stats">
        <div class="stat"><span class="stat-icon">💰</span><span id="p1-credits">0</span></div>
        <div class="stat"><span class="stat-icon">🎖️</span><span id="p1-units">0</span></div>
        <div class="stat"><span class="stat-icon">🏗️</span><span id="p1-buildings">0</span></div>
        <div class="stat"><span class="stat-icon">☠️</span><span id="p1-kills">0</span></div>
      </div>
    </div>
  </div>
  
  <div class="timer">
    <div class="timer-value" id="game-time">0:00</div>
    <div class="timer-label">elapsed</div>
  </div>
  
  <div class="player allied right">
    <div>
      <div class="player-name" id="p2-name">OPPONENT</div>
      <div class="stats">
        <div class="stat"><span class="stat-icon">💰</span><span id="p2-credits">?</span></div>
        <div class="stat"><span class="stat-icon">🎖️</span><span id="p2-units">?</span></div>
        <div class="stat"><span class="stat-icon">🏗️</span><span id="p2-buildings">?</span></div>
        <div class="stat"><span class="stat-icon">☠️</span><span id="p2-kills">?</span></div>
      </div>
    </div>
  </div>
</div>

<script>
const ws = new WebSocket('ws://' + location.host);
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'state' && msg.data) {
    const d = msg.data;
    const s = d.summary || {};
    document.getElementById('p1-credits').textContent = (s.credits || 0).toLocaleString();
    document.getElementById('p1-units').textContent = s.unit_count || 0;
    document.getElementById('p1-buildings').textContent = s.building_count || 0;
    
    const tick = d.tick || 0;
    const mins = Math.floor(tick / 25 / 60);
    const secs = Math.floor((tick / 25) % 60);
    document.getElementById('game-time').textContent = mins + ':' + String(secs).padStart(2, '0');
  }
};
</script>
</body>
</html>`;

const SUBTITLES_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; }
  body { 
    background: transparent; 
    display: flex; 
    justify-content: center; 
    align-items: flex-end;
    min-height: 100px;
    padding: 10px;
  }
  .subtitle {
    background: rgba(0, 0, 0, 0.75);
    border-radius: 8px;
    padding: 12px 28px;
    max-width: 900px;
    text-align: center;
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  .subtitle.visible { opacity: 1; }
  .subtitle-text {
    color: white;
    font-family: 'Segoe UI', 'Helvetica Neue', sans-serif;
    font-size: 22px;
    line-height: 1.4;
    text-shadow: 1px 1px 3px rgba(0,0,0,0.8);
  }
</style>
</head>
<body>
<div class="subtitle" id="subtitle">
  <div class="subtitle-text" id="text"></div>
</div>

<script>
const ws = new WebSocket('ws://' + location.host);
let hideTimeout;

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'subtitle' && msg.text) {
    const el = document.getElementById('subtitle');
    const textEl = document.getElementById('text');
    
    textEl.textContent = msg.text;
    el.classList.add('visible');
    
    clearTimeout(hideTimeout);
    // Auto-hide after roughly matching TTS duration
    const wordCount = msg.text.split(/\\s+/).length;
    const displayMs = Math.max(3000, wordCount * 250);
    hideTimeout = setTimeout(() => el.classList.remove('visible'), displayMs);
  }
};
</script>
</body>
</html>`;
