# ============================================================================
# IronCurtain — Headless OpenRA Dedicated Server
#
# Runs a headless OpenRA Red Alert server with the ExternalBot mod installed.
# Each match gets its own container, configured via environment variables.
#
# Build:   docker build -t ironcurtain/openra-server:latest .
# Run:     docker run -e MAP="Ore Lord" -e IPC_PORT=10000 -p 10000:10000 ironcurtain/openra-server:latest
#
# Environment Variables:
#   MAP                 - Map name (default: "Ore Lord")
#   PLAYER1_FACTION     - Player 1 faction: allies|soviet (default: soviet)
#   PLAYER2_FACTION     - Player 2 faction: allies|soviet (default: allies)
#   GAME_SPEED          - Game speed: slower|slow|normal|fast|faster (default: normal)
#   STARTING_CASH       - Starting credits (default: 10000)
#   TECH_LEVEL          - Tech level: low|medium|high|unrestricted (default: unrestricted)
#   FOG_OF_WAR          - Enable fog of war: true|false (default: true)
#   SHROUD              - Enable shroud: true|false (default: true)
#   IPC_PORT            - ExternalBot IPC port (default: 10000)
#   SERVER_PORT         - OpenRA server port (default: 1234)
#   SERVER_NAME         - Server name for the lobby (default: IronCurtain Match)
#   MATCH_ID            - Match identifier for logging (default: unknown)
#   MAX_TICKS           - Maximum game ticks before draw (default: 36000 = 25 min)
# ============================================================================

# ── Stage 1: Build OpenRA from source ──────────────────────────────────────

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    unzip \
    make \
    lua5.1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Clone OpenRA (specific release for stability)
ARG OPENRA_VERSION=release-20231010
RUN git clone --depth 1 --branch ${OPENRA_VERSION} \
    https://github.com/OpenRA/OpenRA.git /build/openra

WORKDIR /build/openra

# Build OpenRA
RUN make all RUNTIME=net8

# ── Stage 2: Install ExternalBot Mod ───────────────────────────────────────

# Copy IronCurtain mod files
COPY mod/ /build/openra/mods/mcp/

# Build the mod
RUN dotnet build /build/openra/mods/mcp/OpenRA.Mods.MCP.csproj \
    -c Release \
    -o /build/openra/bin/

# ── Stage 3: Runtime Image ─────────────────────────────────────────────────

FROM mcr.microsoft.com/dotnet/runtime:8.0-jammy

# Install minimal runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    lua5.1 \
    liblua5.1-0 \
    libfreetype6 \
    libopenal1 \
    libsdl2-2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN useradd -m -s /bin/bash openra
WORKDIR /opt/openra

# Copy built OpenRA from builder
COPY --from=builder /build/openra/bin/ /opt/openra/bin/
COPY --from=builder /build/openra/mods/ /opt/openra/mods/
COPY --from=builder /build/openra/glsl/ /opt/openra/glsl/ 
COPY --from=builder /build/openra/lua/ /opt/openra/lua/

# Copy entrypoint script
COPY entrypoint.sh /opt/openra/entrypoint.sh
RUN chmod +x /opt/openra/entrypoint.sh

# Create directories for replays and data
RUN mkdir -p /opt/openra/replays /opt/openra/data && \
    chown -R openra:openra /opt/openra

# ── Environment Defaults ──────────────────────────────────────────────────

ENV MAP="Ore Lord" \
    PLAYER1_FACTION="soviet" \
    PLAYER2_FACTION="allies" \
    GAME_SPEED="normal" \
    STARTING_CASH="10000" \
    TECH_LEVEL="unrestricted" \
    FOG_OF_WAR="true" \
    SHROUD="true" \
    IPC_PORT="10000" \
    SERVER_PORT="1234" \
    SERVER_NAME="IronCurtain Match" \
    MATCH_ID="unknown" \
    MAX_TICKS="36000"

# ── Expose Ports ──────────────────────────────────────────────────────────

# IPC port for ExternalBot communication
EXPOSE ${IPC_PORT}

# OpenRA server port (UDP for game traffic)
EXPOSE ${SERVER_PORT}/udp

# ── Health Check ──────────────────────────────────────────────────────────

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD pgrep -f "OpenRA.Server" || exit 1

# ── Run ──────────────────────────────────────────────────────────────────

USER openra
ENTRYPOINT ["/opt/openra/entrypoint.sh"]
