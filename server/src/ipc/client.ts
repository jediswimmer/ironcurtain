/**
 * IPC Client — connects to ExternalBot inside OpenRA via Unix socket or TCP.
 *
 * Protocol: Newline-delimited JSON (ndjson).
 *   Request:  {"id": N, "method": "...", "params": {...}}\n
 *   Response: {"id": N, "result": {...}}\n   or  {"id": N, "error": "..."}\n
 *   Event:    {"event": "...", "data": {...}}\n
 *
 * Features:
 *   - Auto-reconnection with exponential backoff
 *   - Request/response correlation via message IDs
 *   - Event emitter for unsolicited game events
 *   - Configurable timeout per request
 */

import * as net from "node:net";
import * as readline from "node:readline";
import { EventEmitter } from "node:events";
import type { ServerConfig } from "../config.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface IpcResponseMessage {
  id: number;
  result?: unknown;
  error?: string;
}

interface IpcEventMessage {
  event: string;
  data: Record<string, unknown>;
}

type IncomingMessage = IpcResponseMessage | IpcEventMessage;

function isResponseMessage(msg: IncomingMessage): msg is IpcResponseMessage {
  return "id" in msg && typeof (msg as IpcResponseMessage).id === "number";
}

function isEventMessage(msg: IncomingMessage): msg is IpcEventMessage {
  return "event" in msg && typeof (msg as IpcEventMessage).event === "string";
}

// ─── IPC Client ──────────────────────────────────────────────────────────────

export class IpcClient extends EventEmitter {
  private readonly socketPath: string;
  private readonly tcpHost: string;
  private readonly tcpPort: number;
  private readonly timeoutMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly verbose: boolean;

  private socket: net.Socket | null = null;
  private reader: readline.Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private _connected = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false;

  constructor(cfg: ServerConfig) {
    super();
    this.socketPath = cfg.ipcSocketPath;
    this.tcpHost = cfg.ipcHost;
    this.tcpPort = cfg.ipcPort;
    this.timeoutMs = cfg.ipcTimeoutMs;
    this.maxReconnectAttempts = cfg.ipcMaxReconnectAttempts;
    this.reconnectBaseDelayMs = cfg.ipcReconnectBaseDelayMs;
    this.verbose = cfg.verbose;
  }

  /** Whether the client has an active connection to the ExternalBot. */
  get isConnected(): boolean {
    return this._connected;
  }

  /**
   * Connect to the ExternalBot IPC server.
   * Tries Unix socket first, falls back to TCP.
   */
  async connect(): Promise<void> {
    this.intentionalDisconnect = false;

    try {
      await this.connectUnixSocket();
      this.log("Connected via Unix socket:", this.socketPath);
    } catch {
      this.log("Unix socket failed, trying TCP:", `${this.tcpHost}:${this.tcpPort}`);
      await this.connectTcp();
      this.log("Connected via TCP:", `${this.tcpHost}:${this.tcpPort}`);
    }

    this.reconnectAttempt = 0;
  }

  /** Disconnect and stop reconnection attempts. */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();
    this.destroySocket();
  }

  /**
   * Send a request to the ExternalBot and wait for a response.
   *
   * @param method  IPC method name (e.g., "get_state", "issue_order")
   * @param params  Optional parameters for the request
   * @returns       The result payload from the ExternalBot
   * @throws        If not connected, request times out, or ExternalBot returns an error
   */
  async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this._connected || !this.socket) {
      throw new Error(
        "Not connected to OpenRA ExternalBot. Is the game running?"
      );
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params: params ?? {} });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`IPC request timed out after ${this.timeoutMs}ms: ${method}`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timer,
      });

      this.socket!.write(payload + "\n", (err) => {
        if (err) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new Error(`Failed to write to IPC socket: ${err.message}`));
        }
      });
    });
  }

  // ─── Private: Connection ─────────────────────────────────────────────────

  private connectUnixSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      const onError = (err: Error) => {
        sock.removeAllListeners();
        sock.destroy();
        reject(err);
      };
      sock.once("error", onError);
      sock.connect(this.socketPath, () => {
        sock.removeListener("error", onError);
        this.attachSocket(sock);
        resolve();
      });
    });
  }

  private connectTcp(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      const onError = (err: Error) => {
        sock.removeAllListeners();
        sock.destroy();
        reject(err);
      };
      sock.once("error", onError);
      sock.connect(this.tcpPort, this.tcpHost, () => {
        sock.removeListener("error", onError);
        this.attachSocket(sock);
        resolve();
      });
    });
  }

  private attachSocket(sock: net.Socket): void {
    this.destroySocket();
    this.socket = sock;
    this._connected = true;

    this.reader = readline.createInterface({ input: sock });

    this.reader.on("line", (line: string) => {
      this.handleLine(line);
    });

    sock.on("close", () => {
      this._connected = false;
      this.rejectAllPending("Connection closed");
      this.emit("disconnected");
      this.log("IPC connection closed");

      if (!this.intentionalDisconnect) {
        this.scheduleReconnect();
      }
    });

    sock.on("error", (err: Error) => {
      this.log("IPC socket error:", err.message);
    });

    this.emit("connected");
  }

  private destroySocket(): void {
    if (this.reader) {
      this.reader.close();
      this.reader = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this._connected = false;
  }

  // ─── Private: Message Handling ───────────────────────────────────────────

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: IncomingMessage;
    try {
      msg = JSON.parse(trimmed) as IncomingMessage;
    } catch {
      this.log("IPC: Invalid JSON received:", trimmed.slice(0, 200));
      return;
    }

    if (isResponseMessage(msg)) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);

        if (msg.error) {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.result);
        }
      }
    }

    if (isEventMessage(msg)) {
      this.emit("game_event", { event: msg.event, data: msg.data });
      this.emit(msg.event, msg.data);
    }
  }

  // ─── Private: Reconnection ──────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.log(
        `IPC: Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`
      );
      this.emit("reconnect_failed");
      return;
    }

    const delay = this.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempt);
    this.reconnectAttempt++;
    this.log(`IPC: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        this.log("IPC: Reconnected successfully");
        this.emit("reconnected");
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  // ─── Private: Logging ───────────────────────────────────────────────────

  private log(...args: unknown[]): void {
    if (this.verbose) {
      console.error("[IronCurtain IPC]", ...args);
    }
  }
}
