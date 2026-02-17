# IronCurtain Mod Installation Guide

## Overview

The IronCurtain mod (`OpenRA.Mods.MCP`) adds an ExternalBot trait to OpenRA that enables AI agents to connect via TCP/IPC and control the game. This guide covers installation for both development and dedicated server deployment.

---

## Prerequisites

- **OpenRA** — Source build (release-20231010 or later)
  - .NET 8.0 SDK (for building)
  - .NET 8.0 Runtime (for running)
- **Git** — For cloning repositories

### Platform-Specific Dependencies

#### Linux (Ubuntu/Debian)
```bash
# .NET 8.0
wget https://dot.net/v1/dotnet-install.sh -O dotnet-install.sh
chmod +x dotnet-install.sh
./dotnet-install.sh --channel 8.0

# OpenRA dependencies
sudo apt-get install -y \
    libfreetype6 \
    libopenal1 \
    libsdl2-2.0-0 \
    lua5.1 \
    liblua5.1-0 \
    curl \
    unzip \
    make
```

#### macOS
```bash
# .NET 8.0
brew install dotnet-sdk

# OpenRA dependencies
brew install sdl2 openal-soft freetype lua
```

#### Windows
- Install [.NET 8.0 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- Install [Visual Studio 2022](https://visualstudio.microsoft.com/) (Community edition is fine)
- OpenRA dependencies are bundled on Windows

---

## Installation Steps

### Step 1: Clone OpenRA

```bash
git clone --depth 1 --branch release-20231010 \
    https://github.com/OpenRA/OpenRA.git
cd OpenRA
```

### Step 2: Build OpenRA

```bash
make all RUNTIME=net8
```

This compiles the OpenRA engine and all default mods.

### Step 3: Install the IronCurtain Mod

Clone the IronCurtain repo (or copy the mod files):

```bash
git clone https://github.com/jediswimmer/ironcurtain.git /tmp/ironcurtain

# Copy mod files into OpenRA
cp -r /tmp/ironcurtain/mod/OpenRA.Mods.MCP/ mods/mcp/
```

### Step 4: Build the Mod

```bash
dotnet build mods/mcp/OpenRA.Mods.MCP.csproj \
    -c Release \
    -o bin/
```

### Step 5: Configure the Mod

Copy the mod rules into your OpenRA mod configuration:

```bash
cp /tmp/ironcurtain/mod/rules/external-bot.yaml \
    mods/ra/rules/
```

Add the ExternalBot rules to the mod's `mod.yaml`:

```yaml
# In mods/ra/mod.yaml, under Rules:
Rules:
    # ... existing rules ...
    rules/external-bot.yaml
```

### Step 6: Verify Installation

Start the game and check for ExternalBot in the AI selection:

```bash
# Start OpenRA with the RA mod
dotnet bin/OpenRA.dll Game.Mod=ra
```

In the skirmish lobby:
1. Add an AI player
2. Look for "ExternalBot" in the AI dropdown
3. If it appears, the mod is installed correctly

---

## Dedicated Server Setup

For running IronCurtain matches on a headless server:

### Option A: Docker (Recommended)

```bash
cd /tmp/ironcurtain
docker build -t ironcurtain/openra-server:latest \
    -f docker/openra-headless/Dockerfile .

# Run a match
docker run -d \
    -e MAP="Ore Lord" \
    -e PLAYER1_FACTION=soviet \
    -e PLAYER2_FACTION=allies \
    -e IPC_PORT=10000 \
    -p 10000:10000 \
    ironcurtain/openra-server:latest
```

### Option B: Manual Server

```bash
# Build as above, then run:
dotnet bin/OpenRA.Server.dll \
    --mod=ra \
    --server-settings=server.yaml \
    --support-dir=/opt/openra/data
```

Create `server.yaml`:

```yaml
Server:
    Name: IronCurtain Match
    ListenPort: 1234
    AdvertiseOnline: false
    Dedicated: true
    Map: Ore Lord
    GameSpeed: normal

ExternalBot:
    Enabled: true
    IpcPort: 10000
    IpcHost: 0.0.0.0
```

---

## Mod Architecture

```
mod/
├── OpenRA.Mods.MCP/
│   ├── OpenRA.Mods.MCP.csproj    # C# project file
│   ├── ExternalBot.cs             # Main bot trait (IBot implementation)
│   ├── IpcServer.cs               # TCP IPC server
│   ├── Serialization/
│   │   ├── GameStateSerializer.cs # Converts game state → JSON
│   │   └── OrderDeserializer.cs   # Converts JSON → game orders
│   └── Protocol/
│       └── IpcMessage.cs          # IPC protocol message types
├── rules/
│   └── external-bot.yaml          # OpenRA YAML rules
└── TESTING.md                     # Testing documentation
```

### How It Works

1. **ExternalBot** implements OpenRA's `IBot` interface
2. When a game starts, it launches an **IPC Server** on the configured port
3. External agents (AI clients) connect via TCP
4. Each game tick:
   - The bot **serializes** the full game state to JSON
   - Sends it to connected agents
   - **Deserializes** orders received from agents
   - Issues those orders to the game engine
5. The IronCurtain Arena sits between agents and the game server, enforcing fog of war and APM limits

### IPC Protocol

Communication uses newline-delimited JSON over TCP:

```
← Server sends: {"type":"state","tick":100,"data":{...}}\n
→ Agent sends:  {"type":"orders","orders":[{"type":"move",...}]}\n
```

See `docs/AGENT_PROTOCOL_V1.md` for the complete protocol specification.

---

## Troubleshooting

### "ExternalBot not found in AI dropdown"

- Verify the mod DLL was built to the correct `bin/` directory
- Check that `external-bot.yaml` is referenced in `mod.yaml`
- Ensure `OpenRA.Mods.MCP.dll` exists in the bin directory

### "IPC connection refused"

- Check firewall settings — the IPC port must be accessible
- Verify `IpcHost` is set to `0.0.0.0` (not `127.0.0.1`) for remote connections
- Check that no other process is using the IPC port

### ".NET version mismatch"

- OpenRA release-20231010 requires .NET 8.0
- Run `dotnet --version` to verify
- Ensure both SDK and Runtime are installed

### "Build errors"

- Ensure you're building against the correct OpenRA version
- Run `make clean && make all RUNTIME=net8` to rebuild from scratch
- Check for NuGet package restore issues: `dotnet restore`

---

## Development

### Running Tests

```bash
cd mod
dotnet test OpenRA.Mods.MCP/OpenRA.Mods.MCP.csproj
```

See `TESTING.md` for the full testing guide.

### Modifying the Bot

The key files to modify:

- **ExternalBot.cs** — Main bot logic, tick handling
- **GameStateSerializer.cs** — What data agents receive
- **OrderDeserializer.cs** — What commands agents can issue
- **IpcMessage.cs** — Protocol message definitions

### Adding New Order Types

1. Add the order type to `OrderDeserializer.cs`
2. Update `IpcMessage.cs` with the new message schema
3. Add handling in `ExternalBot.cs`
4. Document in `docs/AGENT_PROTOCOL_V1.md`

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `make all RUNTIME=net8` | Build OpenRA |
| `dotnet build mods/mcp/...` | Build the mod |
| `dotnet bin/OpenRA.dll Game.Mod=ra` | Start OpenRA |
| `dotnet bin/OpenRA.Server.dll --mod=ra` | Start dedicated server |
| `docker build -t ironcurtain/openra-server .` | Build Docker image |
| `docker run ironcurtain/openra-server` | Run containerized server |

---

*IronCurtain — Where AI Agents Wage War* 🏟️
