# ExternalBot Integration Testing Guide

## Prerequisites

1. **OpenRA source code** — Clone from https://github.com/OpenRA/OpenRA
2. **OpenRA.Mods.MCP project** — This mod, compiled against OpenRA's engine
3. **.NET 8 SDK** — Required to build OpenRA and the mod
4. **A TCP client** — `netcat`, `telnet`, Python, or any language that can speak TCP

## Build Steps

### 1. Clone OpenRA

```bash
git clone https://github.com/OpenRA/OpenRA /tmp/OpenRA
cd /tmp/OpenRA
make all  # or: dotnet build OpenRA.sln
```

### 2. Add the mod to OpenRA

Copy the mod files into OpenRA's mod structure:

```bash
# Create the mod project directory
mkdir -p /tmp/OpenRA/OpenRA.Mods.MCP
cp -r /tmp/ironcurtain/mod/OpenRA.Mods.MCP/* /tmp/OpenRA/OpenRA.Mods.MCP/

# Add project to the solution
cd /tmp/OpenRA
dotnet sln add OpenRA.Mods.MCP/OpenRA.Mods.MCP.csproj
```

Create `OpenRA.Mods.MCP/OpenRA.Mods.MCP.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <LangVersion>latest</LangVersion>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="../OpenRA.Game/OpenRA.Game.csproj" />
    <ProjectReference Include="../OpenRA.Mods.Common/OpenRA.Mods.Common.csproj" />
  </ItemGroup>
</Project>
```

### 3. Register the bot in mod rules

Add to `mods/ra/rules/player.yaml` (or equivalent):

```yaml
Player:
	ExternalBot@MCPBot:
		Type: mcp
		Name: IronCurtain AI
		TcpPort: 18642
		MinOrderQuotientPerTick: 5
		StateSnapshotInterval: 25
```

And add the assembly to `mods/ra/mod.yaml`:

```yaml
Assemblies:
	...existing assemblies...
	OpenRA.Mods.MCP.dll
```

### 4. Build and run

```bash
cd /tmp/OpenRA
dotnet build
dotnet run --project OpenRA.Game -- Game.Mod=ra
```

## Integration Tests

### Test 1: Bot Appears in Lobby

**Steps:**
1. Launch OpenRA with the mod loaded
2. Start a Skirmish game
3. Open the AI player dropdown

**Expected:** "IronCurtain AI" appears as a selectable AI option.

### Test 2: TCP Server Starts

**Steps:**
1. Start a game with "IronCurtain AI" selected as an opponent
2. Check if TCP port 18642 is listening:
   ```bash
   lsof -i :18642
   # or
   netstat -an | grep 18642
   ```

**Expected:** Port 18642 is listening after the game starts.

### Test 3: Client Connection

**Steps:**
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

**Steps:**
1. Connect to the bot
2. Send:
   ```json
   {"id":1,"method":"ping"}
   ```

**Expected:** Response with current tick and player info:
```json
{"id":1,"result":{"pong":true,"tick":0,"player_name":"IronCurtain AI","is_game_over":false}}
```

### Test 5: Get Full State

**Steps:**
1. Connect to the bot
2. Send:
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

### Test 6: Get Units / Buildings / Resources Individually

**Steps:**
1. Send each query:
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

**Expected:** Each returns a valid JSON response with the appropriate data subset.

### Test 7: Deploy MCV

**Steps:**
1. Get the game state and find the MCV actor ID
2. Send:
   ```json
   {"id":11,"method":"issue_order","params":{"order":"DeployTransform","subject_id":MCV_ACTOR_ID}}
   ```

**Expected:** 
- Response: `{"id":11,"result":{"success":true}}`
- MCV deploys into a Construction Yard in game

### Test 8: Start Production

**Steps:**
1. After deploying MCV, send:
   ```json
   {"id":12,"method":"issue_order","params":{"order":"Produce","type":"powr","count":1}}
   ```

**Expected:**
- Response confirms success
- Power Plant appears in production queue (verify with `get_production_queues`)

### Test 9: Place Building

**Steps:**
1. Wait for building to complete (check production queue for `done: true`)
2. Send:
   ```json
   {"id":13,"method":"issue_order","params":{"order":"PlaceBuilding","type":"powr","position":[X,Y]}}
   ```
   (Use a valid position near the Construction Yard)

**Expected:** Building is placed on the map.

### Test 10: Move Unit

**Steps:**
1. Find a mobile unit from `get_units`
2. Send:
   ```json
   {"id":14,"method":"issue_order","params":{"order":"Move","subject_id":UNIT_ID,"target_cell":[X,Y]}}
   ```

**Expected:** Unit starts moving to the target cell.

### Test 11: Attack Move

**Steps:**
1. Send with group of unit IDs:
   ```json
   {"id":15,"method":"issue_order","params":{"order":"AttackMove","unit_ids":[ID1,ID2,ID3],"target_cell":[X,Y]}}
   ```

**Expected:** Units attack-move toward the target.

### Test 12: Batch Orders

**Steps:**
1. Send multiple orders at once:
   ```json
   {"id":16,"method":"issue_orders","params":{"orders":[
     {"order":"Move","subject_id":ID1,"target_cell":[10,10]},
     {"order":"Move","subject_id":ID2,"target_cell":[12,10]}
   ]}}
   ```

**Expected:** Both units move. Response: `{"id":16,"result":{"success":true,"queued":2}}`

### Test 13: State Update Broadcasts

**Steps:**
1. Connect and wait ~1 second (25 ticks at normal speed)

**Expected:** Receive unsolicited `state_update` events:
```json
{"event":"state_update","data":{"tick":25,"is_game_over":false,"events":[],"summary":{...}}}
```

### Test 14: Damage Events

**Steps:**
1. Connect to the bot
2. In another terminal, manually attack one of the bot's units/buildings
3. Wait for the next state_update broadcast

**Expected:** The `events` array in the state_update contains:
```json
{"type":"under_attack","actor_id":123,"actor_type":"1tnk","attacker_type":"e1","position_x":10,"position_y":20,"damage":40,"tick":100}
```

### Test 15: Fog of War Enforcement

**Steps:**
1. Send `get_enemy_intel`
2. Compare visible enemies with what the bot player can actually see on the map

**Expected:** Only enemy actors within the bot's line of sight appear in `visible`. Hidden enemies appear in `frozen` (last known position) only if previously seen.

### Test 16: Sell Building

**Steps:**
1. Find a building ID
2. Send:
   ```json
   {"id":17,"method":"issue_order","params":{"order":"Sell","subject_id":BUILDING_ID}}
   ```

**Expected:** Building starts selling animation, credits are refunded.

### Test 17: Repair Building

**Steps:**
1. Damage a building, then send:
   ```json
   {"id":18,"method":"issue_order","params":{"order":"RepairBuilding","subject_id":BUILDING_ID}}
   ```

**Expected:** Building starts repairing (costs credits).

### Test 18: Set Rally Point

**Steps:**
1. Find a production building ID
2. Send:
   ```json
   {"id":19,"method":"issue_order","params":{"order":"SetRallyPoint","subject_id":BUILDING_ID,"position":[X,Y]}}
   ```

**Expected:** Rally point flag appears at the specified position.

### Test 19: Multi-Client Support

**Steps:**
1. Connect two separate TCP clients to port 18642
2. Send requests from both clients simultaneously

**Expected:** Both clients receive welcome messages, can send requests, and both receive broadcast state_update events. Responses are routed to the correct client.

### Test 20: Graceful Disconnection

**Steps:**
1. Connect a client
2. Abruptly close the connection (Ctrl+C on netcat)
3. Wait for next state_update cycle

**Expected:** No crashes. Server logs "Client disconnected". Remaining clients (if any) continue receiving updates.

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
    
    # Read response line
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

## Automated CI Testing

For headless CI environments, OpenRA supports running matches without a UI:

```bash
# Start a headless game with the external bot
openra --headless --server-name=test --map=<map_uid> \
  --player1=mcp --player2=mcp \
  --port1=18642 --port2=18643
```

See OpenRA's dedicated server documentation for headless match configuration.
