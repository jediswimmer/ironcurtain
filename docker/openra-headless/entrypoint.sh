#!/bin/bash
# ============================================================================
# IronCurtain — Headless OpenRA Server Entrypoint
#
# Configures and launches the OpenRA dedicated server with ExternalBot support.
# All configuration comes from environment variables set by the Arena.
# ============================================================================

set -euo pipefail

echo "═══════════════════════════════════════════════════════"
echo "  🏟️  IronCurtain — OpenRA Headless Server"
echo "═══════════════════════════════════════════════════════"
echo "  Match ID:      ${MATCH_ID}"
echo "  Map:           ${MAP}"
echo "  Player 1:      ${PLAYER1_FACTION}"
echo "  Player 2:      ${PLAYER2_FACTION}"
echo "  Game Speed:    ${GAME_SPEED}"
echo "  Starting Cash: ${STARTING_CASH}"
echo "  Tech Level:    ${TECH_LEVEL}"
echo "  Fog of War:    ${FOG_OF_WAR}"
echo "  IPC Port:      ${IPC_PORT}"
echo "  Server Port:   ${SERVER_PORT}"
echo "  Max Ticks:     ${MAX_TICKS}"
echo "═══════════════════════════════════════════════════════"

# ── Generate Server Settings ─────────────────────────────────────────────

SETTINGS_DIR="/opt/openra/data/settings"
mkdir -p "${SETTINGS_DIR}"

cat > "${SETTINGS_DIR}/server.yaml" <<EOF
Server:
	Name: ${SERVER_NAME}
	ListenPort: ${SERVER_PORT}
	AdvertiseOnline: false
	EnableSingleplayer: false
	Password:
	RequireAuthentication: false
	Map: ${MAP}
	GameSpeed: ${GAME_SPEED}
	Dedicated: true
	AllowPortForward: false
	EnableLintChecks: false
	EnableGeoIP: false

ExternalBot:
	Enabled: true
	IpcPort: ${IPC_PORT}
	IpcHost: 0.0.0.0
	Player1Faction: ${PLAYER1_FACTION}
	Player2Faction: ${PLAYER2_FACTION}

Game:
	FogOfWar: ${FOG_OF_WAR}
	Shroud: ${SHROUD}
	StartingCash: ${STARTING_CASH}
	TechLevel: ${TECH_LEVEL}
	MaxTicks: ${MAX_TICKS}

Replay:
	Directory: /opt/openra/replays
	Enabled: true
EOF

echo "📝 Server configuration written"

# ── Signal Handling ──────────────────────────────────────────────────────

cleanup() {
    echo ""
    echo "🛑 Shutting down OpenRA server (Match: ${MATCH_ID})..."
    
    # Copy replay if it exists
    if ls /opt/openra/replays/*.orarep 1> /dev/null 2>&1; then
        echo "📼 Replay saved: $(ls /opt/openra/replays/*.orarep)"
    fi
    
    # Kill the server process
    if [ -n "${SERVER_PID:-}" ]; then
        kill -TERM "${SERVER_PID}" 2>/dev/null || true
        wait "${SERVER_PID}" 2>/dev/null || true
    fi
    
    echo "✅ Server stopped cleanly"
    exit 0
}

trap cleanup SIGTERM SIGINT SIGQUIT

# ── Launch Server ────────────────────────────────────────────────────────

echo "🚀 Starting OpenRA dedicated server..."

# Launch the dedicated server with the ExternalBot mod
dotnet /opt/openra/bin/OpenRA.Server.dll \
    --server-settings="${SETTINGS_DIR}/server.yaml" \
    --mod=ra \
    --support-dir=/opt/openra/data \
    &

SERVER_PID=$!
echo "📡 Server PID: ${SERVER_PID}"
echo "🎮 Waiting for agents to connect on IPC port ${IPC_PORT}..."

# Wait for the server process
wait "${SERVER_PID}"
EXIT_CODE=$?

echo "🏁 Server exited with code: ${EXIT_CODE} (Match: ${MATCH_ID})"

# Save replay file info
if ls /opt/openra/replays/*.orarep 1> /dev/null 2>&1; then
    REPLAY_FILE=$(ls -t /opt/openra/replays/*.orarep | head -1)
    echo "📼 Replay available: ${REPLAY_FILE}"
fi

exit ${EXIT_CODE}
