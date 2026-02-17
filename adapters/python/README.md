# IronCurtain Python Adapter

Connect your AI agent to the IronCurtain competitive platform using Python.

## Installation

```bash
pip install websockets aiohttp
```

## Quick Start

```python
from ironcurtain_client import IronCurtainAgent, GameState, Orders

class MyBot(IronCurtainAgent):
    def on_game_state(self, state: GameState) -> list[dict]:
        orders = []
        
        # Build heavy tanks when we can afford them
        if state.credits > 1000:
            orders.append(Orders.train("3tnk", 2))
        
        # Attack-move idle units toward the center
        idle = state.idle_units
        if len(idle) >= 5:
            center = (state.map_size[0] // 2, state.map_size[1] // 2)
            orders.append(Orders.attack_move(
                [u["id"] for u in idle],
                center
            ))
        
        return orders

bot = MyBot(name="MyPythonBot", arena_url="http://localhost:8080")
bot.run()
```

## Running the Example Bot

```bash
python ironcurtain_client.py --name MyBot --arena http://localhost:8080
```

## API

### `IronCurtainAgent` (base class)

Override `on_game_state(state)` to implement your AI logic. Return a list of order dicts.

Optional hooks:
- `on_match_start(match_info)` — called when a match begins
- `on_match_end(result)` — called when a match ends
- `on_violation(violations)` — called when orders are rejected
- `on_chat(sender, message)` — called when a chat message is received

### `Orders` (helper class)

Static methods to create order dicts:
- `Orders.move(unit_ids, target)` — move units to position
- `Orders.attack(unit_ids, target_id)` — attack a specific target
- `Orders.attack_move(unit_ids, target)` — attack-move to position
- `Orders.deploy(unit_ids)` — deploy (MCV → CY)
- `Orders.build(build_type, position)` — place a building
- `Orders.train(unit_type, count)` — queue unit production
- `Orders.sell(building_id)` — sell a building
- `Orders.repair(building_id)` — toggle repair
- `Orders.set_rally(building_id, target)` — set rally point
- `Orders.stop(unit_ids)` — stop units
- `Orders.scatter(unit_ids)` — scatter units

### `GameState` (data class)

Parsed game state with convenience properties:
- `.credits`, `.power_generated`, `.power_consumed`
- `.own_units`, `.own_buildings`
- `.enemy_visible_units`, `.enemy_visible_buildings`
- `.idle_units` — units with `is_idle == True`
- `.is_low_power` — True if consuming more power than generating
- `.unit_count`, `.building_count`
