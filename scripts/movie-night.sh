#!/bin/bash
# ╔══════════════════════════════════════════════════════╗
# ║          🎬 MOVIE NIGHT — ONE COMMAND LAUNCH 🎬      ║
# ║                                                      ║
# ║  Starts everything needed for the full broadcast:    ║
# ║  1. OpenRA game with ExternalBot + spectator slots   ║
# ║  2. MCP server (Skippy's brain)                      ║
# ║  3. Broadcaster agent (live commentary)              ║
# ║  4. Overlay server (stats + subtitles for OBS)       ║
# ╚══════════════════════════════════════════════════════╝

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Default settings
STYLE="${1:-esports}"
MAP="${2:-}"
OVERLAY_PORT=8080
IPC_SOCKET="/tmp/openra-mcp.sock"

echo "🎬 ═══════════════════════════════════════════════"
echo "   RED ALERT: MOVIE NIGHT"
echo "   Commentary Style: $STYLE"
echo "   Map: ${MAP:-random}"
echo "═══════════════════════════════════════════════════"
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo "🛑 Shutting down broadcast..."
    kill $BROADCASTER_PID 2>/dev/null || true
    kill $MCP_PID 2>/dev/null || true
    rm -f "$IPC_SOCKET"
    echo "✅ Broadcast ended. GG!"
}
trap cleanup EXIT

# Step 1: Start the Broadcaster Agent
echo "🎙️  Starting Broadcaster Agent (style: $STYLE)..."
cd "$PROJECT_DIR/broadcaster"
npx tsx src/index.ts --style "$STYLE" --overlay-port $OVERLAY_PORT &
BROADCASTER_PID=$!
echo "   PID: $BROADCASTER_PID"
echo ""

# Step 2: Remind about OBS setup
echo "📺 OBS SETUP CHECKLIST:"
echo "   1. Add Browser Source → http://localhost:$OVERLAY_PORT/overlay"
echo "      (Position: bottom of screen, 1920x80)"
echo "   2. Add Browser Source → http://localhost:$OVERLAY_PORT/subtitles"
echo "      (Position: lower third, 1200x100)"
echo "   3. Add Window Capture → OpenRA game window"
echo "   4. Add Audio Input → BlackHole 2ch (commentary audio)"
echo "   5. Lower game audio to ~40% so commentary is clear"
echo ""

# Step 3: Instructions for starting the game
echo "🎮 GAME SETUP:"
echo "   1. Launch OpenRA Red Alert"
echo "   2. Create a Multiplayer game (NOT Skirmish)"
echo "   3. Select 'Skippy the Magnificent' as Player 1"
echo "   4. Have your friend join as Player 2"
echo "   5. Join yourself as Observer"
echo "   6. Start the game!"
echo ""
echo "   The MCP server will auto-connect when Claude's tools are called."
echo "   The Broadcaster will auto-connect when the game starts."
echo ""

echo "🎙️  BROADCAST READY — Waiting for game to start..."
echo "   Overlay: http://localhost:$OVERLAY_PORT/overlay"
echo "   Subtitles: http://localhost:$OVERLAY_PORT/subtitles"
echo ""
echo "   Press Ctrl+C to end the broadcast."
echo ""

# Keep alive
wait
