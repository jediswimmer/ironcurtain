/**
 * WebSocket Client — Real-time connection to the IronCurtain Arena.
 *
 * Handles:
 *   - Auto-reconnection with exponential backoff
 *   - Match spectating (live game state updates)
 *   - Commentary streaming
 *   - Connection status tracking
 */

// ─── Types ──────────────────────────────────────────────

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export interface GameStateUpdate {
  type: "state_update";
  state: LiveGameState;
  tick?: number;
}

export interface LiveGameState {
  tick: number;
  game_time: string;
  players: LivePlayerState[];
  all_units: LiveUnit[];
  all_buildings: LiveBuilding[];
  ore_fields: { center: [number, number]; type: "ore" | "gems" }[];
  map: { name: string; size: [number, number]; total_cells: number };
}

export interface LivePlayerState {
  player_id: string;
  agent_id: string;
  credits: number;
  power: { generated: number; consumed: number };
}

export interface LiveUnit {
  id: number;
  type: string;
  owner_id: string;
  position: [number, number];
  health: number;
  max_health: number;
  is_idle: boolean;
  activity?: string;
}

export interface LiveBuilding {
  id: number;
  type: string;
  owner_id: string;
  position: [number, number];
  health: number;
  max_health: number;
  production_queue?: { type: string; progress: number }[];
  rally_point?: [number, number];
  is_primary?: boolean;
}

export interface MatchStartEvent {
  type: "game_start";
  match_id: string;
  players: { agent_id: string; agent_name: string; faction: string; elo: number }[];
  map: string;
}

export interface MatchEndEvent {
  type: "game_end";
  winner_id: string | null;
  reason: string;
  duration_secs: number;
  elo_change?: {
    winner_elo_before: number;
    winner_elo_after: number;
    winner_elo_change: number;
    loser_elo_before: number;
    loser_elo_after: number;
    loser_elo_change: number;
  };
}

export interface ChatMessage {
  type: "chat";
  from: string;
  message: string;
}

export interface CommentaryMessage {
  type: "commentary";
  text: string;
  emotion: string;
  priority: string;
}

export type SpectatorMessage =
  | GameStateUpdate
  | MatchStartEvent
  | MatchEndEvent
  | ChatMessage
  | CommentaryMessage
  | { type: "match_cancelled"; reason: string };

export type SpectatorCallback = (msg: SpectatorMessage) => void;
export type StatusCallback = (status: ConnectionStatus) => void;

// ─── WebSocket Spectator Client ─────────────────────────

export class SpectatorClient {
  private ws: WebSocket | null = null;
  private url: string;
  private matchId: string;
  private callbacks: SpectatorCallback[] = [];
  private statusCallbacks: StatusCallback[] = [];
  private status: ConnectionStatus = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000;
  private manualClose = false;

  constructor(baseUrl: string, matchId: string) {
    // Convert http(s) to ws(s)
    this.url = baseUrl
      .replace(/^http/, "ws")
      .replace(/\/$/, "");
    this.matchId = matchId;
  }

  /**
   * Connect to the match spectator WebSocket.
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.manualClose = false;
    this.setStatus("connecting");

    try {
      this.ws = new WebSocket(`${this.url}/ws/spectate/${this.matchId}`);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus("connected");
        console.log(`[WS] Connected to match ${this.matchId}`);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as SpectatorMessage;
          for (const cb of this.callbacks) {
            cb(msg);
          }
        } catch {
          console.warn("[WS] Failed to parse message:", event.data);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[WS] Disconnected (code: ${event.code})`);
        this.setStatus("disconnected");

        if (!this.manualClose && event.code !== 1000) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        this.setStatus("error");
      };
    } catch {
      this.setStatus("error");
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from the match.
   */
  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "Client disconnected");
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  /**
   * Subscribe to spectator messages.
   */
  onMessage(callback: SpectatorCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Subscribe to connection status changes.
   */
  onStatusChange(callback: StatusCallback): () => void {
    this.statusCallbacks.push(callback);
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Get current connection status.
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  // ─── Private ────────────────────────────────────────────

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const cb of this.statusCallbacks) {
      cb(status);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log("[WS] Max reconnection attempts reached");
      this.setStatus("error");
      return;
    }

    const delay =
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts) +
      Math.random() * 1000;

    console.log(
      `[WS] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts + 1})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }
}

/**
 * Get the WebSocket base URL from environment or location.
 */
export function getWsBaseUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:8080";

  // Check for environment variable
  const envUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (envUrl) return envUrl;

  // Derive from current page location
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}
