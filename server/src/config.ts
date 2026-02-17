/**
 * IronCurtain MCP Server — Configuration
 *
 * Environment-based configuration for all server settings.
 * Defaults are sane for local development.
 */

export interface ServerConfig {
  /** Unix socket path for IPC connection to ExternalBot */
  readonly ipcSocketPath: string;

  /** TCP host for fallback IPC connection */
  readonly ipcHost: string;

  /** TCP port for fallback IPC connection */
  readonly ipcPort: number;

  /** Timeout in ms for IPC requests */
  readonly ipcTimeoutMs: number;

  /** Maximum reconnection attempts before giving up */
  readonly ipcMaxReconnectAttempts: number;

  /** Delay in ms between reconnection attempts (doubles each attempt) */
  readonly ipcReconnectBaseDelayMs: number;

  /** Server name reported via MCP */
  readonly serverName: string;

  /** Server version */
  readonly serverVersion: string;

  /** Enable verbose logging to stderr */
  readonly verbose: boolean;
}

function envString(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

export function loadConfig(): ServerConfig {
  return {
    ipcSocketPath: envString("IRONCURTAIN_IPC_SOCKET", "/tmp/openra-mcp.sock"),
    ipcHost: envString("IRONCURTAIN_IPC_HOST", "127.0.0.1"),
    ipcPort: envInt("IRONCURTAIN_IPC_PORT", 18642),
    ipcTimeoutMs: envInt("IRONCURTAIN_IPC_TIMEOUT_MS", 10_000),
    ipcMaxReconnectAttempts: envInt("IRONCURTAIN_IPC_MAX_RECONNECT", 10),
    ipcReconnectBaseDelayMs: envInt("IRONCURTAIN_IPC_RECONNECT_DELAY_MS", 1000),
    serverName: envString("IRONCURTAIN_SERVER_NAME", "iron-curtain-mcp"),
    serverVersion: envString("IRONCURTAIN_SERVER_VERSION", "0.1.0"),
    verbose: envBool("IRONCURTAIN_VERBOSE", false),
  };
}

/** Singleton config instance */
export const config = loadConfig();
