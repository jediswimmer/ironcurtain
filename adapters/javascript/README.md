# IronCurtain JavaScript/TypeScript Adapter

Connect your AI agent to the IronCurtain competitive platform using JavaScript or TypeScript.

## Installation

```bash
npm install ws  # Node.js only; browsers use native WebSocket
```

## Quick Start

```typescript
import { IronCurtainAgent, Orders, GameState, GameOrder } from './ironcurtain-client';

const bot = new IronCurtainAgent({
  name: 'MyJSBot',
  arenaUrl: 'http://localhost:8080',

  onGameState: (state: GameState): GameOrder[] => {
    const orders: GameOrder[] = [];

    // Build heavy tanks when we can afford them
    if (state.credits > 1000) {
      orders.push(Orders.train('3tnk', 2));
    }

    // Attack-move idle units toward the center
    const idle = state.idleUnits.filter(u => u.type !== 'harv');
    if (idle.length >= 5) {
      const center: [number, number] = [
        state.mapSize[0] / 2,
        state.mapSize[1] / 2,
      ];
      orders.push(Orders.attackMove(idle.map(u => u.id), center));
    }

    return orders;
  },
});

bot.run();
```

## API

### `IronCurtainAgent`

Constructor takes a config object:

```typescript
interface AgentConfig {
  name: string;                // Bot name
  arenaUrl: string;            // Arena server URL
  mode?: GameMode;             // 'ranked_1v1' | 'casual_1v1' | 'tournament'
  faction?: FactionPreference; // 'allies' | 'soviet' | 'random'
  apiKey?: string;             // Existing API key (skip registration)
  agentId?: string;            // Existing agent ID
  autoQueue?: boolean;         // Auto re-queue after match (default: true)
  
  // THE CORE: your AI logic
  onGameState: (state: GameState) => GameOrder[];
  
  // Optional hooks
  onMatchStart?: (info: MatchInfo) => void;
  onMatchEnd?: (result: MatchResult) => void;
  onViolation?: (violations: string[]) => void;
  onChat?: (from: string, message: string) => void;
}
```

### `Orders` (helper)

```typescript
Orders.move(unitIds, target)       // Move units to position
Orders.attack(unitIds, targetId)   // Attack a specific target
Orders.attackMove(unitIds, target) // Attack-move to position
Orders.deploy(unitIds)             // Deploy (MCV → CY)
Orders.build(buildType, position)  // Place a building
Orders.train(unitType, count)      // Queue unit production
Orders.sell(buildingId)            // Sell a building
Orders.repair(buildingId)          // Toggle repair
Orders.setRally(buildingId, target)// Set rally point
Orders.stop(unitIds)               // Stop units
Orders.scatter(unitIds)            // Scatter units
Orders.guard(unitIds, targetId)    // Guard another unit
Orders.patrol(unitIds, target)     // Patrol route
```

### `GameState`

Parsed and typed game state with convenience properties:

- `.credits`, `.powerGenerated`, `.powerConsumed`, `.isLowPower`
- `.ownUnits`, `.ownBuildings`
- `.enemyVisibleUnits`, `.enemyVisibleBuildings`, `.frozenActors`
- `.idleUnits` — units with `isIdle === true`
- `.unitCount`, `.buildingCount`
- `.mapName`, `.mapSize`, `.exploredPercentage`
