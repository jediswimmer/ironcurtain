/**
 * Overlay Server — serves HTML overlays for OBS browser sources.
 *
 * Provides:
 *   /overlay      — Full stats bar: both players' resources, armies, kills, power
 *   /subtitles    — Live commentary text with animated appearance
 *   /killfeed     — Scrolling kill/destruction feed
 *   /dashboard    — Combined view with all elements (for testing)
 *
 * WebSocket pushes real-time updates to all connected browsers.
 */

import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import * as http from "http";
import { OverlayMessage, GameState, Severity, Emotion, EventType } from "./types.js";

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

    // ── Route: Stats overlay ──────────────────────

    app.get("/overlay", (_req, res) => {
      res.type("html").send(OVERLAY_HTML);
    });

    // ── Route: Subtitles ──────────────────────────

    app.get("/subtitles", (_req, res) => {
      res.type("html").send(SUBTITLES_HTML);
    });

    // ── Route: Kill feed ──────────────────────────

    app.get("/killfeed", (_req, res) => {
      res.type("html").send(KILLFEED_HTML);
    });

    // ── Route: Full dashboard (testing) ───────────

    app.get("/dashboard", (_req, res) => {
      res.type("html").send(DASHBOARD_HTML);
    });

    // ── Route: Health check ───────────────────────

    app.get("/health", (_req, res) => {
      res.json({ status: "broadcasting", clients: this.wss?.clients.size ?? 0 });
    });

    this.server.listen(this.port, () => {
      console.error(`📊 Overlay server running:`);
      console.error(`   Stats:     http://localhost:${this.port}/overlay`);
      console.error(`   Subtitles: http://localhost:${this.port}/subtitles`);
      console.error(`   Kill Feed: http://localhost:${this.port}/killfeed`);
      console.error(`   Dashboard: http://localhost:${this.port}/dashboard`);
    });
  }

  /** Push game state to all overlay clients. */
  broadcastState(data: GameState): void {
    this.broadcast({ type: "state", data });
  }

  /** Push subtitle text to overlay. */
  broadcastSubtitle(text: string, emotion: Emotion = "neutral", priority: Severity = "routine"): void {
    this.broadcast({ type: "subtitle", text, emotion, priority });
  }

  /** Push kill feed entry. */
  broadcastKill(killer: string, killerUnit: string, victim: string, victimUnit: string): void {
    this.broadcast({
      type: "killfeed",
      killer,
      killerUnit,
      victim,
      victimUnit,
      timestamp: Date.now(),
    });
  }

  /** Push notable event to overlay. */
  broadcastEvent(eventType: EventType, severity: Severity, text: string): void {
    this.broadcast({ type: "event", eventType, severity, text });
  }

  shutdown(): void {
    this.wss?.close();
    this.server?.close();
  }

  private broadcast(msg: OverlayMessage): void {
    if (!this.wss) return;
    const json = JSON.stringify(msg);
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    });
  }
}

// ══════════════════════════════════════════════════════
//  HTML Templates
// ══════════════════════════════════════════════════════

const OVERLAY_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: transparent;
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    overflow: hidden;
  }

  .overlay {
    display: flex;
    justify-content: space-between;
    align-items: stretch;
    background: linear-gradient(180deg, rgba(10,10,20,0.92) 0%, rgba(10,10,20,0.78) 100%);
    border-bottom: 2px solid rgba(255,255,255,0.1);
    padding: 0;
    color: white;
    height: 90px;
  }

  .player {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    padding: 10px 20px;
  }

  .player.right {
    justify-content: flex-end;
    text-align: right;
  }

  .player-badge {
    width: 44px;
    height: 44px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    font-weight: 900;
    flex-shrink: 0;
  }

  .soviet .player-badge { background: linear-gradient(135deg, #cc0000, #880000); }
  .allied .player-badge { background: linear-gradient(135deg, #0066cc, #003388); }
  .unknown .player-badge { background: linear-gradient(135deg, #666, #333); }

  .player-info { display: flex; flex-direction: column; gap: 4px; }

  .player-name {
    font-size: 16px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.5px;
  }
  .soviet .player-name { color: #ff5555; }
  .allied .player-name { color: #5599ff; }
  .unknown .player-name { color: #aaa; }

  .stats {
    display: flex;
    gap: 14px;
    font-size: 13px;
    opacity: 0.9;
  }

  .stat {
    display: flex;
    align-items: center;
    gap: 3px;
    transition: all 0.3s ease;
  }

  .stat.flash { color: #ffcc00; transform: scale(1.15); }

  .stat-icon { font-size: 14px; opacity: 0.7; }
  .stat-value { font-variant-numeric: tabular-nums; font-weight: 600; }

  .power-bar {
    height: 3px;
    background: rgba(255,255,255,0.1);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 2px;
  }
  .power-fill {
    height: 100%;
    transition: width 0.5s ease, background 0.5s ease;
    border-radius: 2px;
  }
  .power-normal { background: #44cc44; }
  .power-low { background: #cccc44; }
  .power-critical { background: #cc4444; animation: pulse 1s infinite; }

  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 120px;
    padding: 8px 16px;
    border-left: 1px solid rgba(255,255,255,0.08);
    border-right: 1px solid rgba(255,255,255,0.08);
  }

  .timer-value {
    font-size: 32px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    letter-spacing: 1px;
  }

  .timer-label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 3px;
    opacity: 0.5;
    margin-top: 2px;
  }

  .phase-badge {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 2px;
    padding: 2px 8px;
    border-radius: 4px;
    margin-top: 4px;
    font-weight: 600;
  }
  .phase-early { background: rgba(68,204,68,0.3); color: #88ff88; }
  .phase-mid { background: rgba(204,204,68,0.3); color: #ffff88; }
  .phase-late { background: rgba(204,136,68,0.3); color: #ffcc88; }
  .phase-climax { background: rgba(204,68,68,0.3); color: #ff8888; animation: pulse 2s infinite; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  .event-banner {
    position: fixed;
    top: 90px;
    left: 0;
    right: 0;
    text-align: center;
    pointer-events: none;
    z-index: 100;
  }

  .event-text {
    display: inline-block;
    padding: 6px 24px;
    font-size: 14px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 2px;
    border-radius: 0 0 8px 8px;
    opacity: 0;
    transform: translateY(-20px);
    transition: all 0.4s ease;
  }

  .event-text.show {
    opacity: 1;
    transform: translateY(0);
  }

  .event-exciting { background: rgba(204,170,0,0.9); color: #000; }
  .event-critical { background: rgba(204,0,0,0.9); color: #fff; }
  .event-legendary {
    background: linear-gradient(90deg, #cc0000, #cc8800, #cc0000);
    background-size: 200% 100%;
    animation: shimmer 2s linear infinite;
    color: #fff;
    font-size: 18px;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
</head>
<body>

<div class="overlay">
  <div class="player soviet" id="p1-container">
    <div class="player-badge" id="p1-badge">☭</div>
    <div class="player-info">
      <div class="player-name" id="p1-name">PLAYER 1</div>
      <div class="stats">
        <div class="stat"><span class="stat-icon">💰</span><span class="stat-value" id="p1-credits">0</span></div>
        <div class="stat"><span class="stat-icon">⚔️</span><span class="stat-value" id="p1-units">0</span></div>
        <div class="stat"><span class="stat-icon">🏗️</span><span class="stat-value" id="p1-buildings">0</span></div>
        <div class="stat"><span class="stat-icon">☠️</span><span class="stat-value" id="p1-kills">0</span></div>
      </div>
      <div class="power-bar"><div class="power-fill power-normal" id="p1-power" style="width:100%"></div></div>
    </div>
  </div>

  <div class="center">
    <div class="timer-value" id="game-time">0:00</div>
    <div class="timer-label">elapsed</div>
    <div class="phase-badge phase-early" id="phase-badge">EARLY GAME</div>
  </div>

  <div class="player allied right" id="p2-container">
    <div class="player-info">
      <div class="player-name" id="p2-name">PLAYER 2</div>
      <div class="stats">
        <div class="stat"><span class="stat-icon">💰</span><span class="stat-value" id="p2-credits">0</span></div>
        <div class="stat"><span class="stat-icon">⚔️</span><span class="stat-value" id="p2-units">0</span></div>
        <div class="stat"><span class="stat-icon">🏗️</span><span class="stat-value" id="p2-buildings">0</span></div>
        <div class="stat"><span class="stat-icon">☠️</span><span class="stat-value" id="p2-kills">0</span></div>
      </div>
      <div class="power-bar"><div class="power-fill power-normal" id="p2-power" style="width:100%"></div></div>
    </div>
    <div class="player-badge" id="p2-badge">★</div>
  </div>
</div>

<div class="event-banner">
  <div class="event-text" id="event-banner"></div>
</div>

<script>
const ws = new WebSocket('ws://' + location.host);
let prevState = null;
let eventTimeout;

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);

  if (msg.type === 'state' && msg.data) {
    updateState(msg.data);
  }

  if (msg.type === 'event') {
    showEvent(msg.text, msg.severity);
  }
};

function updateState(d) {
  const players = Object.entries(d.players || {});
  if (players.length >= 1) updatePlayer('p1', players[0][0], players[0][1]);
  if (players.length >= 2) updatePlayer('p2', players[1][0], players[1][1]);

  // Timer
  const tick = d.tick || 0;
  const mins = Math.floor(tick / 25 / 60);
  const secs = Math.floor((tick / 25) % 60);
  document.getElementById('game-time').textContent = mins + ':' + String(secs).padStart(2, '0');

  // Phase
  const totalSec = tick / 25;
  let phase = 'early';
  if (totalSec > 1200) phase = 'climax';
  else if (totalSec > 720) phase = 'late';
  else if (totalSec > 300) phase = 'mid';

  const badge = document.getElementById('phase-badge');
  badge.className = 'phase-badge phase-' + phase;
  badge.textContent = phase.toUpperCase() + ' GAME';

  prevState = d;
}

function updatePlayer(prefix, name, p) {
  document.getElementById(prefix + '-name').textContent = name;

  flashIfChanged(prefix + '-credits', (p.credits || 0).toLocaleString());
  flashIfChanged(prefix + '-units', p.unitCount || 0);
  flashIfChanged(prefix + '-buildings', p.buildingCount || 0);
  flashIfChanged(prefix + '-kills', p.kills || 0);

  // Faction
  const container = document.getElementById(prefix + '-container');
  container.className = 'player' + (prefix === 'p2' ? ' right' : '') + ' ' + (p.faction || 'unknown');

  const badge = document.getElementById(prefix + '-badge');
  badge.textContent = p.faction === 'soviet' ? '☭' : p.faction === 'allied' ? '★' : '?';

  // Power
  const power = document.getElementById(prefix + '-power');
  const powerState = p.powerState || 'normal';
  power.className = 'power-fill power-' + powerState;
  power.style.width = powerState === 'normal' ? '100%' : powerState === 'low' ? '50%' : '20%';
}

function flashIfChanged(id, newValue) {
  const el = document.getElementById(id);
  const strVal = String(newValue);
  if (el.textContent !== strVal) {
    el.textContent = strVal;
    el.parentElement.classList.add('flash');
    setTimeout(() => el.parentElement.classList.remove('flash'), 600);
  }
}

function showEvent(text, severity) {
  if (severity === 'routine' || severity === 'notable') return;
  const banner = document.getElementById('event-banner');
  banner.textContent = text;
  banner.className = 'event-text event-' + severity + ' show';
  clearTimeout(eventTimeout);
  eventTimeout = setTimeout(() => banner.classList.remove('show'), 5000);
}
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
    min-height: 120px;
    padding: 10px 20px;
  }

  .subtitle-container {
    text-align: center;
    max-width: 1000px;
    width: 100%;
  }

  .subtitle {
    display: inline-block;
    background: rgba(0, 0, 0, 0.82);
    border-radius: 10px;
    padding: 14px 32px;
    max-width: 100%;
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 0.35s ease, transform 0.35s ease;
  }

  .subtitle.visible {
    opacity: 1;
    transform: translateY(0);
  }

  .subtitle-text {
    color: white;
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-size: 22px;
    line-height: 1.5;
    text-shadow: 1px 1px 4px rgba(0,0,0,0.9);
  }

  /* Severity-based accent */
  .subtitle.exciting { border-left: 3px solid #ccaa00; }
  .subtitle.critical { border-left: 3px solid #cc0000; }
  .subtitle.legendary {
    border-left: 3px solid #ff4400;
    background: rgba(30, 0, 0, 0.88);
  }

  /* Emotion-based text color tint */
  .emotion-excited .subtitle-text { color: #ffe8a0; }
  .emotion-panicked .subtitle-text { color: #ffaaaa; }
  .emotion-smug .subtitle-text { color: #c0e0ff; }
  .emotion-awed .subtitle-text { color: #e0d0ff; }
  .emotion-somber .subtitle-text { color: #aabbcc; }

  /* Typewriter cursor */
  .cursor {
    display: inline-block;
    width: 2px;
    height: 1em;
    background: rgba(255,255,255,0.7);
    margin-left: 2px;
    animation: blink 0.8s step-end infinite;
    vertical-align: text-bottom;
  }

  @keyframes blink {
    50% { opacity: 0; }
  }
</style>
</head>
<body>

<div class="subtitle-container">
  <div class="subtitle" id="subtitle">
    <span class="subtitle-text" id="text"></span><span class="cursor" id="cursor"></span>
  </div>
</div>

<script>
const ws = new WebSocket('ws://' + location.host);
let hideTimeout, typeTimeout;
let typeIndex = 0;
let fullText = '';

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'subtitle' && msg.text) {
    showSubtitle(msg.text, msg.emotion || 'neutral', msg.priority || 'routine');
  }
};

function showSubtitle(text, emotion, priority) {
  const el = document.getElementById('subtitle');
  const textEl = document.getElementById('text');
  const cursorEl = document.getElementById('cursor');

  // Clear any pending operations
  clearTimeout(hideTimeout);
  clearTimeout(typeTimeout);

  // Set severity class
  el.className = 'subtitle ' + priority;

  // Set emotion class on container
  el.parentElement.className = 'subtitle-container emotion-' + emotion;

  // Typewriter effect
  fullText = text;
  typeIndex = 0;
  textEl.textContent = '';
  cursorEl.style.display = 'inline-block';
  el.classList.add('visible');

  typeNextChar(textEl, cursorEl);
}

function typeNextChar(textEl, cursorEl) {
  if (typeIndex < fullText.length) {
    // Type 2-3 chars at a time for speed
    const chunk = fullText.slice(typeIndex, typeIndex + 2);
    textEl.textContent += chunk;
    typeIndex += chunk.length;
    typeTimeout = setTimeout(() => typeNextChar(textEl, cursorEl), 25);
  } else {
    // Done typing — hide cursor, schedule fade
    cursorEl.style.display = 'none';
    const wordCount = fullText.split(/\\s+/).length;
    const displayMs = Math.max(4000, wordCount * 300);
    hideTimeout = setTimeout(() => {
      document.getElementById('subtitle').classList.remove('visible');
    }, displayMs);
  }
}
</script>
</body>
</html>`;

const KILLFEED_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: transparent;
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    overflow: hidden;
    padding: 8px;
  }

  .killfeed {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    max-height: 300px;
    overflow: hidden;
  }

  .kill-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(0,0,0,0.75);
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 13px;
    color: white;
    opacity: 0;
    transform: translateX(30px);
    transition: opacity 0.3s ease, transform 0.3s ease;
    white-space: nowrap;
  }

  .kill-entry.show {
    opacity: 1;
    transform: translateX(0);
  }

  .kill-entry.fade {
    opacity: 0;
    transform: translateX(-20px);
  }

  .killer-name { color: #ff6666; font-weight: 600; }
  .victim-name { color: #6699ff; font-weight: 600; }
  .unit-name { color: #aaa; font-size: 11px; }
  .kill-icon { font-size: 14px; }
</style>
</head>
<body>

<div class="killfeed" id="killfeed"></div>

<script>
const ws = new WebSocket('ws://' + location.host);
const MAX_ENTRIES = 8;

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'killfeed') {
    addKill(msg);
  }
};

function addKill(data) {
  const feed = document.getElementById('killfeed');

  const entry = document.createElement('div');
  entry.className = 'kill-entry';
  entry.innerHTML =
    '<span class="killer-name">' + esc(data.killer) + '</span>' +
    '<span class="unit-name">' + esc(data.killerUnit) + '</span>' +
    '<span class="kill-icon">💀</span>' +
    '<span class="unit-name">' + esc(data.victimUnit) + '</span>' +
    '<span class="victim-name">' + esc(data.victim) + '</span>';

  feed.insertBefore(entry, feed.firstChild);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => entry.classList.add('show'));
  });

  // Remove old entries
  while (feed.children.length > MAX_ENTRIES) {
    const old = feed.lastChild;
    old.classList.add('fade');
    setTimeout(() => old.remove(), 300);
  }

  // Auto-remove after 10 seconds
  setTimeout(() => {
    entry.classList.remove('show');
    entry.classList.add('fade');
    setTimeout(() => entry.remove(), 300);
  }, 10000);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '?';
  return d.innerHTML;
}
</script>
</body>
</html>`;

const DASHBOARD_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>IronCurtain Broadcast Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #1a1a2e;
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    color: white;
  }

  .dashboard {
    display: grid;
    grid-template-rows: 90px 1fr auto;
    height: 100vh;
    gap: 0;
  }

  .top { border-bottom: 1px solid rgba(255,255,255,0.1); }

  .middle {
    display: grid;
    grid-template-columns: 1fr 250px;
    gap: 0;
  }

  .game-area {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #111122;
    position: relative;
  }

  .game-placeholder {
    text-align: center;
    opacity: 0.3;
    font-size: 18px;
  }

  .sidebar {
    background: rgba(0,0,0,0.4);
    border-left: 1px solid rgba(255,255,255,0.08);
    padding: 12px;
    overflow-y: auto;
  }

  .sidebar h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: rgba(255,255,255,0.4);
    margin-bottom: 8px;
  }

  .bottom {
    min-height: 120px;
    border-top: 1px solid rgba(255,255,255,0.1);
    position: relative;
  }

  iframe {
    width: 100%;
    height: 100%;
    border: none;
  }

  .logo {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 48px;
    font-weight: 900;
    letter-spacing: 4px;
    opacity: 0.08;
    text-transform: uppercase;
  }
</style>
</head>
<body>

<div class="dashboard">
  <div class="top">
    <iframe src="/overlay"></iframe>
  </div>
  <div class="middle">
    <div class="game-area">
      <div class="logo">IRONCURTAIN</div>
      <div class="game-placeholder">
        🎮 Game View<br>
        <small>Add OpenRA window capture in OBS</small>
      </div>
    </div>
    <div class="sidebar">
      <h3>Kill Feed</h3>
      <iframe src="/killfeed" style="height: 100%; min-height: 300px;"></iframe>
    </div>
  </div>
  <div class="bottom">
    <iframe src="/subtitles"></iframe>
  </div>
</div>

</body>
</html>`;
