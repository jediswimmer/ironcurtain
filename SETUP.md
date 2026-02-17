# Setup Guide

## Prerequisites

1. **OpenRA** — Install from https://www.openra.net or build from source
2. **Node.js 18+** — For the MCP server
3. **.NET 8 SDK** — For building the OpenRA mod

## Step 1: Build the OpenRA Mod

```bash
cd mod
dotnet build OpenRA.Mods.MCP/OpenRA.Mods.MCP.csproj
```

## Step 2: Install the Mod

Copy the built mod assembly into your OpenRA mods directory:

```bash
# macOS
cp -r mod/OpenRA.Mods.MCP/bin/Debug/net8.0/* ~/Library/Application\ Support/OpenRA/mods/ra/

# Linux
cp -r mod/OpenRA.Mods.MCP/bin/Debug/net8.0/* ~/.config/openra/mods/ra/

# Or modify the RA mod.yaml to reference our assembly
```

Then add to `mods/ra/mod.yaml`:
```yaml
Rules:
  # ... existing rules ...
  iron-curtain|rules/external-bot.yaml

Assemblies:
  # ... existing assemblies ...
  iron-curtain|OpenRA.Mods.MCP.dll
```

## Step 3: Install MCP Server Dependencies

```bash
cd server
npm install
npm run build
```

## Step 4: Register in OpenClaw

Add to your OpenClaw MCP config:

```json
{
  "mcpServers": {
    "cnc-red-alert": {
      "command": "node",
      "args": ["/path/to/projects/iron-curtain/server/dist/index.js"],
      "env": {}
    }
  }
}
```

## Step 5: Play!

1. Launch OpenRA Red Alert
2. Start a Skirmish game
3. Select "Skippy the Magnificent" as one of the AI opponents
4. The ExternalBot will start its IPC server automatically
5. The MCP server connects when Claude calls any game tool

## Spectating

To watch the AI play:
1. Create a multiplayer game instead of skirmish
2. Add the MCP bot as a player
3. Join as an observer
4. Share the game with friends so they can spectate too
