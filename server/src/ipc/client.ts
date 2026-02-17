/**
 * IPC Client — connects to ExternalBot inside OpenRA via Unix socket or TCP.
 * 
 * Protocol: Newline-delimited JSON.
 * Request:  {"id": N, "method": "...", "params": {...}}\n
 * Response: {"id": N, "result": {...}}\n
 * Event:    {"event": "...", "data": {...}}\n
 */

import * as net from "net";
import * as readline from "readline";

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class IpcClient {
  private socketPath: string;
  private tcpPort: number;
  private socket: net.Socket | null = null;
  private rl: readline.Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private eventHandlers = new Map<string, ((data: unknown) => void)[]>();
  private connected = false;

  constructor(socketPath: string, tcpPort: number) {
    this.socketPath = socketPath;
    this.tcpPort = tcpPort;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Try Unix socket first, fall back to TCP
      this.socket = new net.Socket();

      const onConnect = () => {
        this.connected = true;
        this.setupReadline();
        resolve();
      };

      const onError = (err: Error) => {
        // Fall back to TCP
        this.socket = new net.Socket();
        this.socket.connect(this.tcpPort, "127.0.0.1", onConnect);
        this.socket.on("error", reject);
      };

      this.socket.connect(this.socketPath, onConnect);
      this.socket.on("error", onError);
    });
  }

  private setupReadline() {
    if (!this.socket) return;

    this.rl = readline.createInterface({ input: this.socket });
    this.rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);

        // Response to a request
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const pending = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          clearTimeout(pending.timeout);

          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.result);
          }
        }

        // Unsolicited event
        if (msg.event) {
          const handlers = this.eventHandlers.get(msg.event) ?? [];
          for (const handler of handlers) {
            handler(msg.data);
          }
        }
      } catch (e) {
        console.error("IPC: Invalid JSON response:", line);
      }
    });

    this.socket.on("close", () => {
      this.connected = false;
      console.error("IPC: Connection closed");
    });
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.connected || !this.socket) {
      throw new Error("Not connected to OpenRA ExternalBot. Is the game running?");
    }

    const id = this.nextId++;
    const msg = JSON.stringify({ id, method, params: params ?? {} });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`IPC request timed out: ${method}`));
      }, 10000);

      this.pending.set(id, { resolve, reject, timeout });
      this.socket!.write(msg + "\n");
    });
  }

  onEvent(event: string, handler: (data: unknown) => void) {
    const handlers = this.eventHandlers.get(event) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  disconnect() {
    this.socket?.destroy();
    this.socket = null;
    this.connected = false;
  }
}
