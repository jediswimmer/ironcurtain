"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  SpectatorClient,
  getWsBaseUrl,
  type ConnectionStatus,
  type SpectatorMessage,
  type LiveGameState,
  type LiveUnit,
  type LiveBuilding,
} from "@/lib/ws-client";
import { LiveIndicator } from "./LiveIndicator";
import {
  Wifi,
  WifiOff,
  Loader2,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import { Button } from "./ui/button";

// ─── Types ──────────────────────────────────────────────

interface LiveMatchViewerProps {
  matchId: string;
  className?: string;
}

interface PlayerInfo {
  agent_id: string;
  agent_name: string;
  faction: string;
  elo: number;
}

interface ViewerState {
  gameState: LiveGameState | null;
  players: PlayerInfo[];
  commentary: string[];
  chatMessages: { from: string; message: string }[];
  matchResult: {
    winner_id: string | null;
    reason: string;
    duration_secs: number;
  } | null;
  tick: number;
  gameTime: string;
}

// ─── Unit Type Colors ───────────────────────────────────

const UNIT_CATEGORY: Record<string, "infantry" | "vehicle" | "aircraft" | "naval" | "building"> = {
  e1: "infantry",
  e2: "infantry",
  e3: "infantry",
  e4: "infantry",
  e6: "infantry",
  dog: "infantry",
  spy: "infantry",
  thf: "infantry",
  medi: "infantry",
  "1tnk": "vehicle",
  "2tnk": "vehicle",
  "3tnk": "vehicle",
  "4tnk": "vehicle",
  v2rl: "vehicle",
  ttnk: "vehicle",
  arty: "vehicle",
  harv: "vehicle",
  mcv: "vehicle",
  mig: "aircraft",
  hind: "aircraft",
  heli: "aircraft",
  sub: "naval",
  dd: "naval",
  ca: "naval",
  lst: "naval",
};

// ─── Component ──────────────────────────────────────────

export function LiveMatchViewer({ matchId, className }: LiveMatchViewerProps) {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [viewerState, setViewerState] = useState<ViewerState>({
    gameState: null,
    players: [],
    commentary: [],
    chatMessages: [],
    matchResult: null,
    tick: 0,
    gameTime: "0:00",
  });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<SpectatorClient | null>(null);
  const animFrameRef = useRef<number>(0);

  // Connect on mount
  useEffect(() => {
    const client = new SpectatorClient(getWsBaseUrl(), matchId);
    clientRef.current = client;

    const unsubStatus = client.onStatusChange(setConnectionStatus);

    const unsubMessage = client.onMessage((msg: SpectatorMessage) => {
      setViewerState((prev) => handleMessage(prev, msg));
    });

    client.connect();

    return () => {
      unsubStatus();
      unsubMessage();
      client.disconnect();
    };
  }, [matchId]);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      renderMap(ctx, canvas, viewerState.gameState, viewerState.players, zoom, pan);
      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [viewerState.gameState, viewerState.players, zoom, pan]);

  // Resize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Pan handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    },
    [pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    },
    [isPanning, panStart]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.5, Math.min(4, z + (e.deltaY > 0 ? -0.1 : 0.1))));
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Player colors
  const player1 = viewerState.players[0];
  const player2 = viewerState.players[1];

  return (
    <div className={cn("rounded-xl border border-armor bg-bunker overflow-hidden", className)}>
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-armor px-4 py-2 bg-steel/50">
        <div className="flex items-center gap-3">
          <LiveIndicator />
          <span className="font-heading text-sm font-semibold text-command-white">
            Live Match Viewer
          </span>
          <span className="font-mono text-xs text-intel-gray">
            Tick {viewerState.tick} · {viewerState.gameTime}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <ConnectionBadge status={connectionStatus} />
          <div className="flex items-center gap-1 ml-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-intel-gray hover:text-command-white"
              onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-intel-gray hover:text-command-white"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-intel-gray hover:text-command-white"
              onClick={resetView}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Map canvas */}
      <div
        className="relative w-full bg-void"
        style={{ height: 480 }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
        />

        {/* Overlay: player HUDs */}
        {player1 && player2 && viewerState.gameState && (
          <div className="absolute top-3 left-3 right-3 flex justify-between pointer-events-none">
            <PlayerHUD
              player={player1}
              state={viewerState.gameState}
              side="left"
            />
            <PlayerHUD
              player={player2}
              state={viewerState.gameState}
              side="right"
            />
          </div>
        )}

        {/* Disconnected overlay */}
        {connectionStatus === "disconnected" && (
          <div className="absolute inset-0 flex items-center justify-center bg-void/80">
            <div className="text-center">
              <WifiOff className="mx-auto h-12 w-12 text-intel-gray mb-3" />
              <p className="text-briefing-gray font-heading">Disconnected</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 border-armor"
                onClick={() => clientRef.current?.connect()}
              >
                Reconnect
              </Button>
            </div>
          </div>
        )}

        {/* Connecting overlay */}
        {connectionStatus === "connecting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-void/80">
            <div className="text-center">
              <Loader2 className="mx-auto h-12 w-12 text-soviet-red animate-spin mb-3" />
              <p className="text-briefing-gray font-heading">
                Connecting to match...
              </p>
            </div>
          </div>
        )}

        {/* Match ended overlay */}
        {viewerState.matchResult && (
          <div className="absolute inset-0 flex items-center justify-center bg-void/80">
            <div className="text-center">
              <p className="font-display text-3xl font-bold text-elo-gold mb-2">
                MATCH OVER
              </p>
              <p className="text-xl text-command-white font-heading">
                {viewerState.matchResult.winner_id
                  ? `${viewerState.players.find(
                      (p) => p.agent_id === viewerState.matchResult!.winner_id
                    )?.agent_name ?? "Unknown"} Wins!`
                  : "Draw!"}
              </p>
              <p className="text-sm text-intel-gray mt-1">
                {viewerState.matchResult.reason} ·{" "}
                {formatDuration(viewerState.matchResult.duration_secs)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom bar: commentary + chat */}
      <div className="border-t border-armor bg-steel/30">
        <div className="grid grid-cols-2 divide-x divide-armor">
          {/* Commentary */}
          <div className="p-3 max-h-32 overflow-y-auto">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-intel-gray mb-2">
              🎙️ Commentary
            </h4>
            <div className="space-y-1">
              {viewerState.commentary.slice(-5).map((line, i) => (
                <p key={i} className="text-xs text-briefing-gray leading-relaxed">
                  {line}
                </p>
              ))}
              {viewerState.commentary.length === 0 && (
                <p className="text-xs text-intel-gray italic">
                  Waiting for match events...
                </p>
              )}
            </div>
          </div>

          {/* Chat */}
          <div className="p-3 max-h-32 overflow-y-auto">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-intel-gray mb-2">
              💬 Chat
            </h4>
            <div className="space-y-1">
              {viewerState.chatMessages.slice(-5).map((msg, i) => (
                <p key={i} className="text-xs text-briefing-gray">
                  <span className="font-semibold text-command-white">
                    {msg.from}:
                  </span>{" "}
                  {msg.message}
                </p>
              ))}
              {viewerState.chatMessages.length === 0 && (
                <p className="text-xs text-intel-gray italic">
                  No chat messages yet
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        status === "connected" && "bg-victory-green/10 text-victory-green",
        status === "connecting" && "bg-elo-gold/10 text-elo-gold",
        status === "disconnected" && "bg-intel-gray/10 text-intel-gray",
        status === "error" && "bg-soviet-red/10 text-soviet-red"
      )}
    >
      {status === "connected" && <Wifi className="h-3 w-3" />}
      {status === "connecting" && (
        <Loader2 className="h-3 w-3 animate-spin" />
      )}
      {status === "disconnected" && <WifiOff className="h-3 w-3" />}
      {status === "error" && <WifiOff className="h-3 w-3" />}
      <span className="capitalize">{status}</span>
    </div>
  );
}

function PlayerHUD({
  player,
  state,
  side,
}: {
  player: PlayerInfo;
  state: LiveGameState;
  side: "left" | "right";
}) {
  const playerState = state.players.find((p) => p.agent_id === player.agent_id);
  const units = state.all_units.filter((u) => u.owner_id === player.agent_id);
  const buildings = state.all_buildings.filter(
    (b) => b.owner_id === player.agent_id
  );

  const isSoviet = player.faction === "soviet";

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 backdrop-blur-md bg-bunker/80 min-w-[180px] pointer-events-auto",
        isSoviet ? "border-soviet-red/30" : "border-allied-blue/30",
        side === "right" && "text-right"
      )}
    >
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            isSoviet ? "bg-soviet-red" : "bg-allied-blue"
          )}
        />
        <span className="font-heading text-sm font-bold text-command-white">
          {player.agent_name}
        </span>
        <span className="text-xs text-intel-gray capitalize">
          {player.faction}
        </span>
      </div>
      <div className="mt-1 flex gap-3 text-xs text-briefing-gray">
        <span>💰 {playerState?.credits?.toLocaleString() ?? "?"}</span>
        <span>🎖️ {units.length}</span>
        <span>🏗️ {buildings.length}</span>
        <span>
          ⚡{" "}
          {playerState
            ? `${playerState.power.generated}/${playerState.power.consumed}`
            : "?"}
        </span>
      </div>
    </div>
  );
}

// ─── State Management ───────────────────────────────────

function handleMessage(
  prev: ViewerState,
  msg: SpectatorMessage
): ViewerState {
  switch (msg.type) {
    case "state_update":
      return {
        ...prev,
        gameState: msg.state,
        tick: msg.state.tick,
        gameTime: msg.state.game_time,
      };

    case "game_start":
      return {
        ...prev,
        players: msg.players,
        commentary: [...prev.commentary, `🎮 Match started on ${msg.map}!`],
      };

    case "game_end":
      return {
        ...prev,
        matchResult: {
          winner_id: msg.winner_id,
          reason: msg.reason,
          duration_secs: msg.duration_secs,
        },
      };

    case "chat":
      return {
        ...prev,
        chatMessages: [
          ...prev.chatMessages,
          { from: msg.from, message: msg.message },
        ],
      };

    case "commentary":
      return {
        ...prev,
        commentary: [...prev.commentary, msg.text],
      };

    case "match_cancelled":
      return {
        ...prev,
        matchResult: {
          winner_id: null,
          reason: msg.reason,
          duration_secs: 0,
        },
      };

    default:
      return prev;
  }
}

// ─── Canvas Rendering ───────────────────────────────────

function renderMap(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: LiveGameState | null,
  players: PlayerInfo[],
  zoom: number,
  pan: { x: number; y: number }
) {
  const w = canvas.width;
  const h = canvas.height;

  // Clear
  ctx.fillStyle = "#09090B";
  ctx.fillRect(0, 0, w, h);

  if (!state) {
    // Draw grid pattern while waiting
    ctx.strokeStyle = "#27272A30";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.fillStyle = "#71717A";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for game state...", w / 2, h / 2);
    return;
  }

  const [mapW, mapH] = state.map.size;
  const scale = Math.min(w / mapW, h / mapH) * zoom;
  const offsetX = (w - mapW * scale) / 2 + pan.x;
  const offsetY = (h - mapH * scale) / 2 + pan.y;

  // Save context for transforms
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  // Draw map background
  ctx.fillStyle = "#0F0F12";
  ctx.fillRect(0, 0, mapW, mapH);

  // Draw grid
  ctx.strokeStyle = "#27272A20";
  ctx.lineWidth = 0.5 / scale;
  for (let x = 0; x < mapW; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, mapH);
    ctx.stroke();
  }
  for (let y = 0; y < mapH; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(mapW, y);
    ctx.stroke();
  }

  // Draw ore fields
  for (const ore of state.ore_fields) {
    ctx.fillStyle = ore.type === "gems" ? "#EAB30830" : "#F9731620";
    ctx.beginPath();
    ctx.arc(ore.center[0], ore.center[1], 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Determine player colors
  const playerColors = new Map<string, string>();
  for (const p of players) {
    playerColors.set(
      p.agent_id,
      p.faction === "soviet" ? "#DC2626" : "#2563EB"
    );
  }
  // Fallback for players from state
  for (const p of state.players) {
    if (!playerColors.has(p.agent_id)) {
      playerColors.set(p.agent_id, "#71717A");
    }
  }

  // Draw buildings
  for (const building of state.all_buildings) {
    const color = playerColors.get(building.owner_id) ?? "#71717A";
    const healthPct = building.health / building.max_health;

    // Building body
    ctx.fillStyle = color + "80";
    ctx.fillRect(
      building.position[0] - 1.5,
      building.position[1] - 1.5,
      3,
      3
    );

    // Building outline
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.3 / scale;
    ctx.strokeRect(
      building.position[0] - 1.5,
      building.position[1] - 1.5,
      3,
      3
    );

    // Health bar for damaged buildings
    if (healthPct < 1) {
      ctx.fillStyle = "#DC2626";
      ctx.fillRect(
        building.position[0] - 1.5,
        building.position[1] - 2.5,
        3,
        0.4
      );
      ctx.fillStyle = "#22C55E";
      ctx.fillRect(
        building.position[0] - 1.5,
        building.position[1] - 2.5,
        3 * healthPct,
        0.4
      );
    }
  }

  // Draw units
  for (const unit of state.all_units) {
    const color = playerColors.get(unit.owner_id) ?? "#71717A";
    const category = UNIT_CATEGORY[unit.type] ?? "vehicle";
    const size = category === "infantry" ? 0.6 : category === "vehicle" ? 1 : 0.8;

    ctx.fillStyle = color;
    ctx.beginPath();

    if (category === "infantry") {
      // Small circle for infantry
      ctx.arc(unit.position[0], unit.position[1], size, 0, Math.PI * 2);
    } else if (category === "aircraft") {
      // Diamond for aircraft
      ctx.moveTo(unit.position[0], unit.position[1] - size);
      ctx.lineTo(unit.position[0] + size, unit.position[1]);
      ctx.lineTo(unit.position[0], unit.position[1] + size);
      ctx.lineTo(unit.position[0] - size, unit.position[1]);
    } else {
      // Square for vehicles
      ctx.rect(
        unit.position[0] - size / 2,
        unit.position[1] - size / 2,
        size,
        size
      );
    }

    ctx.fill();
  }

  ctx.restore();

  // Map name label
  ctx.fillStyle = "#71717A";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`📍 ${state.map.name} (${mapW}×${mapH})`, 8, h - 8);
}

// ─── Helpers ────────────────────────────────────────────

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
