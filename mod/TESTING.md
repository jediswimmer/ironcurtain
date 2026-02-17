# ExternalBot Integration Testing Guide

## Prerequisites

1. **OpenRA source code** — Clone from https://github.com/OpenRA/OpenRA
2. **.NET 8 SDK** — Required to build OpenRA and the mod
3. **A TCP client** — `netcat`, Python, or any language that can speak TCP

## Build Steps

### 1. Clone OpenRA

```bash
git clone https://github.com/OpenRA/OpenRA /tmp/OpenRA
cd /tmp/OpenRA
make all  # or: dotnet build OpenRA.sln
```

### 2. Build the mod

The mod project references OpenRA's game assemblies. Build it pointing at your OpenRA checkout:

```bash
cd /tmp/ironcurtain/mod/OpenRA.Mods.MCP
dotnet build -p:OpenRADir=/tmp/OpenRA
```

This produces `bin/Debug/net8.0/OpenRA.Mods.MCP.dll`.

### 3. Install into OpenRA

Copy the compiled assembly and register it in the Red Alert mod:

```bash
# Copy the DLL
cp bin/Debug/net8.0/OpenRA.Mods.MCP.dll /tmp/OpenRA/bin/

# Register the assembly in mod.yaml — add to the Assemblies section:
#   common|OpenRA.Mods.MCP.dll
```

Edit `/tmp/OpenRA/mods/ra/mod.yaml` and add to the `Assemblies:` block:
```yaml
Assemblies:
	# ...existing assemblies...
	common|OpenRA.Mods.MCP.dll
```

Add the bot rules to `/tmp/OpenRA/mods/ra/mod.yaml` in the `Rules:` block:
```yaml
Rules:
	# ...existing rules...
	ra|rules/external-bot.yaml
```

Then copy the bot rules file:
```bash
cp /tmp/ironcurtain/mod/rules/external-bot.yaml /tmp/OpenRA/mods/ra/rules/
```

### 4. Build and run

```bash
cd /tmp/OpenRA
dotnet run --project OpenRA.Launcher -- Game.Mod=ra
```

Or if using `make`:
```bash
cd /tmp/OpenRA
make run
```

## Integration Tests

### Test 1: Bot Appears in Lobby

1. Launch OpenRA with the mod loaded
2. Start a Skirmish game
3. Open the AI player dropdown

**Expected:** "IronCurtain AI" appears as a selectable AI option.

### Test 2: TCP Server Starts

1. Start a game with "IronCurtain AI" selected as an opponent
2. Check if TCP port 18642 is listening:
   ```bash
   lsof -i :18642
   # or
   ss -tlnp | grep 18642
   ```

**Expected:** Port 18642 is listening after the game starts.

### Test 3: Client Connection

1. Start a game with the ExternalBot
2. Connect via netcat:
   ```bash
   nc localhost 18642
   ```

**Expected:** Receive a JSON welcome message:
```json
{"event":"connected","data":{"client_id":"client-1","protocol_version":1}}
```

### Test 4: Ping/Pong

Send:
```json
{"id":1,"method":"ping"}
```

**Expected:**
```json
{"id":1,"result":{"pong":true,"tick":0,"player_name":"IronCurtain AI","is_game_over":false}}
```

### Test 5: Get Full State

Send:
```json
{"id":2,"method":"get_state"}
```

**Expected:** Full game state JSON including:
- `tick` — current game tick
- `player_info` — name, faction, credits, power
- `units` — array of own units with id, type, position, health
- `buildings` — array of own buildings with production queues
- `resources` — credits, harvesters
- `enemy_intel` — visible and frozen enemy actors
- `build_options` — available items to produce
- `production_queues` — current queue state
- `power` — power provided/drained

### Test 6: Individual Queries

```json
{"id":3,"method":"get_units"}
{"id":4,"method":"get_buildings"}
{"id":5,"method":"get_resources"}
{"id":6,"method":"get_enemy_intel"}
{"id":7,"method":"get_build_options"}
{"id":8,"method":"get_production_queues"}
{"id":9,"method":"get_power"}
{"id":10,"method":"get_map_info"}
```

Each returns a valid JSON response with the appropriate data subset.

### Test 7: Deploy MCV

Find the MCV actor ID from `get_state`, then:
```json
{"id":11,"method":"issue_order","params":{"order":"DeployTransform","subject_id":MCV_ACTOR_ID}}
```

**Expected:** MCV deploys into a Construction Yard.

### Test 8: Start Production

```json
{"id":12,"method":"issue_order","params":{"order":"Produce","type":"powr","count":1}}
```

**Expected:** Power Plant appears in production queue.

### Test 9: Place Building

Wait for building to complete (check `get_production_queues` for `done: true`), then:
```json
{"id":13,"method":"issue_order","params":{"order":"PlaceBuilding","type":"powr","position":[X,Y]}}
```

**Expected:** Building is placed on the map.

### Test 10: Move Unit

```json
{"id":14,"method":"issue_order","params":{"order":"Move","subject_id":UNIT_ID,"target_cell":[X,Y]}}
```

### Test 11: Attack Move (Group)

```json
{"id":15,"method":"issue_order","params":{"order":"AttackMove","unit_ids":[ID1,ID2],"target_cell":[X,Y]}}
```

### Test 12: Batch Orders

```json
{"id":16,"method":"issue_orders","params":{"orders":[
  {"order":"Move","subject_id":ID1,"target_cell":[10,10]},
  {"order":"Move","subject_id":ID2,"target_cell":[12,10]}
]}}
```

**Expected:** `{"id":16,"result":{"success":true,"queued":2}}`

### Test 13: State Update Broadcasts

Connect and wait ~1 second (25 ticks at normal speed).

**Expected:** Receive unsolicited `state_update` events:
```json
{"event":"state_update","data":{"tick":25,"is_game_over":false,"events":[],"summary":{...}}}
```

### Test 14: Game Over Event

When a game ends:
```json
{"event":"game_over","data":{"tick":1234,"winner":"Player Name","self_won":false}}
```

### Test 15: Fog of War

Send `get_enemy_intel` — only enemy actors within the bot's line of sight appear in `visible`. Previously seen enemies in fog appear in `frozen` with their last known position.

### Test 16: Sell / Repair / Rally Point

```json
{"id":17,"method":"issue_order","params":{"order":"Sell","subject_id":BUILDING_ID}}
{"id":18,"method":"issue_order","params":{"order":"RepairBuilding","subject_id":BUILDING_ID}}
{"id":19,"method":"issue_order","params":{"order":"SetRallyPoint","subject_id":BUILDING_ID,"position":[X,Y]}}
```

### Test 17: Graceful Disconnection

Abruptly close the TCP connection. No crashes. Other clients continue working.

## Quick Test Script (Python)

```python
#!/usr/bin/env python3
"""Quick smoke test for ExternalBot IPC."""

import json
import socket
import time

def send_recv(sock, method, params=None, req_id=None):
    if req_id is None:
        req_id = int(time.time() * 1000) % 100000
    msg = {"id": req_id, "method": method}
    if params:
        msg["params"] = params
    sock.sendall((json.dumps(msg) + "\n").encode())

    data = b""
    while b"\n" not in data:
        chunk = sock.recv(4096)
        if not chunk:
            break
        data += chunk

    return json.loads(data.decode().strip().split("\n")[-1])

def main():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.connect(("localhost", 18642))
    sock.settimeout(5.0)

    # Read welcome
    welcome = sock.recv(4096).decode().strip()
    print(f"Welcome: {welcome}")

    # Ping
    resp = send_recv(sock, "ping", req_id=1)
    print(f"Ping: {json.dumps(resp, indent=2)}")

    # Get state
    resp = send_recv(sock, "get_state", req_id=2)
    print(f"State keys: {list(resp.get('result', {}).keys())}")

    # Get map info
    resp = send_recv(sock, "get_map_info", req_id=3)
    print(f"Map: {json.dumps(resp.get('result', {}), indent=2)}")

    # Get build options
    resp = send_recv(sock, "get_build_options", req_id=4)
    options = resp.get("result", {}).get("options", [])
    print(f"Build options: {len(options)} items available")

    sock.close()
    print("\nAll smoke tests passed!")

if __name__ == "__main__":
    main()
```

## AI vs AI Setup

For running two external bots against each other, configure two bot instances with different ports in the rules YAML:

```yaml
Player:
  ExternalBot@MCPBot1:
    Type: mcp-1
    Name: IronCurtain Red
    TcpPort: 18642

  ExternalBot@MCPBot2:
    Type: mcp-2
    Name: IronCurtain Blue
    TcpPort: 18643
```

Then connect separate AI agents to ports 18642 and 18643.
