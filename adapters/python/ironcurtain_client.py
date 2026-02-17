"""
IronCurtain Python WebSocket Adapter

A complete Python client for connecting AI agents to the IronCurtain
competitive platform. Handles registration, matchmaking, and game
communication via the Standardized Agent Protocol (SAP) v1.0.

Usage:
    from ironcurtain_client import IronCurtainAgent

    class MyBot(IronCurtainAgent):
        def on_game_state(self, state: dict) -> list[dict]:
            # Analyze state and return orders
            orders = []
            for unit in state['own']['units']:
                if unit['is_idle']:
                    orders.append({
                        'type': 'attack_move',
                        'unit_ids': [unit['id']],
                        'target': [64, 64]
                    })
            return orders

    bot = MyBot(
        name="MyBot",
        arena_url="http://localhost:8080",
    )
    bot.run()

Requirements:
    pip install websockets aiohttp
"""

import asyncio
import json
import logging
import signal
import sys
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

try:
    import aiohttp
except ImportError:
    print("Error: aiohttp is required. Install it with: pip install aiohttp")
    sys.exit(1)

try:
    import websockets
    from websockets.client import WebSocketClientProtocol
except ImportError:
    print("Error: websockets is required. Install it with: pip install websockets")
    sys.exit(1)


# ─── Configuration ───────────────────────────────────────────────────────────

logger = logging.getLogger("ironcurtain")


class GameMode(str, Enum):
    RANKED_1V1 = "ranked_1v1"
    CASUAL_1V1 = "casual_1v1"
    TOURNAMENT = "tournament"


class Faction(str, Enum):
    ALLIES = "allies"
    SOVIET = "soviet"
    RANDOM = "random"


@dataclass
class AgentCredentials:
    """Credentials received from registration."""
    agent_id: str
    name: str
    api_key: str
    elo: int = 1200


@dataclass
class MatchInfo:
    """Information about the current match."""
    match_id: str
    map_name: str
    faction: str
    opponent: str
    settings: dict = field(default_factory=dict)


@dataclass
class GameState:
    """Parsed fog-filtered game state."""
    tick: int
    game_time: str
    credits: int
    power_generated: int
    power_consumed: int
    own_units: list[dict]
    own_buildings: list[dict]
    enemy_visible_units: list[dict]
    enemy_visible_buildings: list[dict]
    frozen_actors: list[dict]
    explored_percentage: float
    map_name: str
    map_size: tuple[int, int]
    known_ore_fields: list[dict]

    @classmethod
    def from_dict(cls, data: dict) -> "GameState":
        own = data.get("own", {})
        enemy = data.get("enemy", {})
        map_info = data.get("map", {})
        power = own.get("power", {})

        return cls(
            tick=data.get("tick", 0),
            game_time=data.get("game_time", "0:00"),
            credits=own.get("credits", 0),
            power_generated=power.get("generated", 0),
            power_consumed=power.get("consumed", 0),
            own_units=own.get("units", []),
            own_buildings=own.get("buildings", []),
            enemy_visible_units=enemy.get("visible_units", []),
            enemy_visible_buildings=enemy.get("visible_buildings", []),
            frozen_actors=enemy.get("frozen_actors", []),
            explored_percentage=own.get("explored_percentage", 0),
            map_name=map_info.get("name", "Unknown"),
            map_size=tuple(map_info.get("size", [128, 128])),
            known_ore_fields=map_info.get("known_ore_fields", []),
        )

    @property
    def is_low_power(self) -> bool:
        return self.power_consumed > self.power_generated

    @property
    def idle_units(self) -> list[dict]:
        return [u for u in self.own_units if u.get("is_idle", False)]

    @property
    def unit_count(self) -> int:
        return len(self.own_units)

    @property
    def building_count(self) -> int:
        return len(self.own_buildings)


# ─── Order Helpers ───────────────────────────────────────────────────────────

class Orders:
    """Helper class for creating order dicts."""

    @staticmethod
    def move(unit_ids: list[int], target: tuple[int, int], queued: bool = False) -> dict:
        return {"type": "move", "unit_ids": unit_ids, "target": list(target), "queued": queued}

    @staticmethod
    def attack(unit_ids: list[int], target_id: int) -> dict:
        return {"type": "attack", "unit_ids": unit_ids, "target_id": target_id}

    @staticmethod
    def attack_move(unit_ids: list[int], target: tuple[int, int]) -> dict:
        return {"type": "attack_move", "unit_ids": unit_ids, "target": list(target)}

    @staticmethod
    def deploy(unit_ids: list[int]) -> dict:
        return {"type": "deploy", "unit_ids": unit_ids}

    @staticmethod
    def build(build_type: str, position: tuple[int, int]) -> dict:
        return {"type": "build", "build_type": build_type, "target": list(position)}

    @staticmethod
    def train(unit_type: str, count: int = 1) -> dict:
        return {"type": "train", "build_type": unit_type, "count": count}

    @staticmethod
    def sell(building_id: int) -> dict:
        return {"type": "sell", "building_id": building_id}

    @staticmethod
    def repair(building_id: int) -> dict:
        return {"type": "repair", "building_id": building_id}

    @staticmethod
    def set_rally(building_id: int, target: tuple[int, int]) -> dict:
        return {"type": "set_rally", "building_id": building_id, "target": list(target)}

    @staticmethod
    def stop(unit_ids: list[int]) -> dict:
        return {"type": "stop", "unit_ids": unit_ids}

    @staticmethod
    def scatter(unit_ids: list[int]) -> dict:
        return {"type": "scatter", "unit_ids": unit_ids}

    @staticmethod
    def guard(unit_ids: list[int], target_id: int) -> dict:
        return {"type": "guard", "unit_ids": unit_ids, "target_id": target_id}

    @staticmethod
    def patrol(unit_ids: list[int], target: tuple[int, int]) -> dict:
        return {"type": "patrol", "unit_ids": unit_ids, "target": list(target)}


# ─── Base Agent ──────────────────────────────────────────────────────────────

class IronCurtainAgent(ABC):
    """
    Base class for IronCurtain AI agents.

    Subclass this and implement on_game_state() to create your bot.
    The framework handles registration, matchmaking, and communication.
    """

    def __init__(
        self,
        name: str,
        arena_url: str = "http://localhost:8080",
        api_key: Optional[str] = None,
        agent_id: Optional[str] = None,
        mode: GameMode = GameMode.RANKED_1V1,
        faction: Faction = Faction.RANDOM,
        auto_queue: bool = True,
        log_level: int = logging.INFO,
    ):
        self.name = name
        self.arena_url = arena_url.rstrip("/")
        self.ws_url = arena_url.replace("http", "ws").rstrip("/")
        self.mode = mode
        self.faction = faction
        self.auto_queue = auto_queue

        self.credentials: Optional[AgentCredentials] = None
        if api_key and agent_id:
            self.credentials = AgentCredentials(
                agent_id=agent_id,
                name=name,
                api_key=api_key,
            )

        self.match_info: Optional[MatchInfo] = None
        self.game_state: Optional[GameState] = None
        self.match_result: Optional[dict] = None
        self.matches_played = 0
        self.wins = 0
        self.losses = 0

        self._running = True
        self._ws: Optional[WebSocketClientProtocol] = None

        logging.basicConfig(
            level=log_level,
            format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        )

    # ─── Abstract Methods (implement these) ────────────────────────────

    @abstractmethod
    def on_game_state(self, state: GameState) -> list[dict]:
        """
        Called every tick with the fog-filtered game state.
        Return a list of order dicts to send to the server.

        This is the core of your bot's AI logic.
        """
        ...

    # ─── Optional Hooks ───────────────────────────────────────────────

    def on_match_start(self, match_info: MatchInfo) -> None:
        """Called when a match begins."""
        logger.info(
            f"Match started: {match_info.map_name} as {match_info.faction} "
            f"vs {match_info.opponent}"
        )

    def on_match_end(self, result: dict) -> None:
        """Called when a match ends."""
        outcome = result.get("result", "unknown")
        logger.info(f"Match ended: {outcome}")

    def on_violation(self, violations: list[str]) -> None:
        """Called when orders are rejected."""
        for v in violations:
            logger.warning(f"Order violation: {v}")

    def on_chat(self, sender: str, message: str) -> None:
        """Called when a chat message is received."""
        logger.debug(f"Chat from {sender}: {message}")

    # ─── Run Loop ─────────────────────────────────────────────────────

    def run(self) -> None:
        """Start the agent. Blocks until stopped."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, self._shutdown)

        try:
            loop.run_until_complete(self._main_loop())
        except KeyboardInterrupt:
            logger.info("Interrupted. Shutting down.")
        finally:
            loop.close()

    async def _main_loop(self) -> None:
        """Main agent loop: register → queue → play → repeat."""
        # Step 1: Register (if needed)
        if not self.credentials:
            self.credentials = await self._register()

        logger.info(
            f"Agent ready: {self.credentials.name} "
            f"(ID: {self.credentials.agent_id})"
        )

        # Step 2: Self-onboard (learn the game)
        await self._self_onboard()

        # Step 3: Queue → Match → Play loop
        while self._running:
            try:
                # Join the queue
                await self._join_queue()

                # Wait for match via queue WebSocket
                match_data = await self._wait_for_match()
                if not match_data:
                    continue

                # Play the match
                await self._play_match(match_data)

                self.matches_played += 1
                logger.info(
                    f"Record: {self.wins}W / {self.losses}L "
                    f"({self.matches_played} games)"
                )

                if not self.auto_queue:
                    break

                # Brief cooldown between matches
                await asyncio.sleep(2)

            except Exception as e:
                logger.error(f"Error in main loop: {e}")
                await asyncio.sleep(5)

    # ─── API Calls ────────────────────────────────────────────────────

    async def _register(self) -> AgentCredentials:
        """Register this agent with the arena."""
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.arena_url}/api/agents/register",
                json={"name": self.name},
            ) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise RuntimeError(f"Registration failed: {resp.status} {text}")

                data = await resp.json()
                creds = AgentCredentials(
                    agent_id=data["agent_id"],
                    name=data["name"],
                    api_key=data["api_key"],
                    elo=data.get("elo", 1200),
                )
                logger.info(f"Registered as {creds.name} (ELO: {creds.elo})")
                logger.warning(
                    f"API KEY (save this!): {creds.api_key}"
                )
                return creds

    async def _self_onboard(self) -> None:
        """Fetch onboarding information from the arena."""
        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(f"{self.arena_url}/api/onboard") as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        logger.info(
                            f"Connected to {data.get('platform', 'IronCurtain')} "
                            f"v{data.get('version', '?')}"
                        )
            except Exception:
                logger.debug("Self-onboarding endpoint not available (non-critical)")

    async def _join_queue(self) -> None:
        """Join the matchmaking queue."""
        assert self.credentials is not None
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.arena_url}/api/queue/join",
                json={
                    "mode": self.mode.value,
                    "faction_preference": self.faction.value,
                },
                headers={
                    "Authorization": f"Bearer {self.credentials.api_key}",
                },
            ) as resp:
                if resp.status == 409:
                    logger.debug("Already in queue")
                    return
                if resp.status != 200:
                    text = await resp.text()
                    raise RuntimeError(f"Queue join failed: {resp.status} {text}")

                logger.info(f"Joined {self.mode.value} queue")

    async def _wait_for_match(self) -> Optional[dict]:
        """Wait for a match via the queue WebSocket."""
        assert self.credentials is not None
        uri = f"{self.ws_url}/ws/queue"
        logger.info("Waiting for match...")

        try:
            async with websockets.connect(uri) as ws:
                # Identify ourselves
                await ws.send(json.dumps({
                    "type": "identify",
                    "agent_id": self.credentials.agent_id,
                }))

                # Wait for match_found or timeout
                while self._running:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=30)
                        msg = json.loads(raw)

                        if msg.get("event") == "match_found":
                            logger.info("Match found!")
                            return msg.get("data", {})
                        elif msg.get("event") == "queue_timeout":
                            logger.info("Queue timeout. Re-queuing...")
                            return None
                        elif msg.get("type") == "identified":
                            logger.debug("Queue connection identified")

                    except asyncio.TimeoutError:
                        continue

        except Exception as e:
            logger.error(f"Queue WebSocket error: {e}")
            await asyncio.sleep(3)
            return None

        return None

    async def _play_match(self, match_data: dict) -> None:
        """Connect to match WebSocket and play."""
        assert self.credentials is not None

        # Extract match info from the pairing data
        match_id = match_data.get("id", "unknown")
        players = match_data.get("players", [])
        map_name = match_data.get("map", "Unknown")

        # Find our faction and opponent
        our_player = None
        opponent_name = "Unknown"
        for p in players:
            if p.get("agent_id") == self.credentials.agent_id:
                our_player = p
            else:
                opponent_name = p.get("agent_name", "Unknown")

        self.match_info = MatchInfo(
            match_id=match_id,
            map_name=map_name,
            faction=our_player.get("faction", "random") if our_player else "random",
            opponent=opponent_name,
            settings=match_data.get("settings", {}),
        )

        self.on_match_start(self.match_info)

        # Connect to match WebSocket
        uri = f"{self.ws_url}/ws/match/{match_id}/agent"

        try:
            async with websockets.connect(uri) as ws:
                self._ws = ws

                # Identify
                await ws.send(json.dumps({
                    "type": "identify",
                    "agent_id": self.credentials.agent_id,
                }))

                # Game loop
                while self._running:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=30)
                        msg = json.loads(raw)

                        await self._handle_match_message(ws, msg)

                        if msg.get("type") == "game_end":
                            break

                    except asyncio.TimeoutError:
                        # Request state if we haven't heard anything
                        await ws.send(json.dumps({
                            "type": "get_state",
                            "agent_id": self.credentials.agent_id,
                        }))

        except websockets.exceptions.ConnectionClosed:
            logger.warning("Match connection closed")
        except Exception as e:
            logger.error(f"Match error: {e}")
        finally:
            self._ws = None

    async def _handle_match_message(
        self, ws: WebSocketClientProtocol, msg: dict
    ) -> None:
        """Handle a message from the match WebSocket."""
        assert self.credentials is not None
        msg_type = msg.get("type", "")

        if msg_type in ("state_update", "state_response"):
            state_data = msg.get("state", {})
            self.game_state = GameState.from_dict(state_data)

            # Get orders from the bot's AI
            orders = self.on_game_state(self.game_state)

            if orders:
                await ws.send(json.dumps({
                    "type": "orders",
                    "agent_id": self.credentials.agent_id,
                    "orders": orders,
                }))

        elif msg_type == "game_end":
            result = msg.get("result", "unknown")
            self.match_result = msg

            if result == "victory":
                self.wins += 1
            elif result == "defeat":
                self.losses += 1

            self.on_match_end(msg)

        elif msg_type == "order_violations":
            violations = msg.get("violations", [])
            self.on_violation(violations)

        elif msg_type == "chat":
            self.on_chat(msg.get("from", "?"), msg.get("message", ""))

        elif msg_type in ("connected", "game_start"):
            logger.debug(f"Match event: {msg_type}")

    # ─── Shutdown ─────────────────────────────────────────────────────

    def _shutdown(self) -> None:
        logger.info("Shutting down...")
        self._running = False


# ─── Example Bot ─────────────────────────────────────────────────────────────

class ExampleBot(IronCurtainAgent):
    """
    A simple example bot that demonstrates the IronCurtain Python adapter.

    Strategy: Mass heavy tanks and attack-move toward the center of the map.
    """

    def on_game_state(self, state: GameState) -> list[dict]:
        orders: list[dict] = []

        # Early game: build economy
        if state.tick < 1000:
            # Deploy MCV if we have one
            mcv_units = [u for u in state.own_units if u["type"] == "mcv"]
            if mcv_units:
                orders.append(Orders.deploy([mcv_units[0]["id"]]))

            # Train harvesters
            war_factories = [
                b for b in state.own_buildings if b["type"] == "weap"
            ]
            if war_factories:
                orders.append(Orders.train("harv", 1))

        # Mid game: build army and attack
        else:
            # Queue heavy tanks
            war_factories = [
                b for b in state.own_buildings if b["type"] == "weap"
            ]
            if war_factories and state.credits > 1000:
                orders.append(Orders.train("3tnk", 2))

            # Send idle units toward the center
            idle = state.idle_units
            combat_idle = [u for u in idle if u["type"] not in ("harv", "mcv")]
            if len(combat_idle) >= 5:
                center = (state.map_size[0] // 2, state.map_size[1] // 2)
                unit_ids = [u["id"] for u in combat_idle]
                orders.append(Orders.attack_move(unit_ids, center))

        return orders

    def on_match_start(self, match_info: MatchInfo) -> None:
        super().on_match_start(match_info)
        logger.info(f"Let's go! Playing as {match_info.faction} on {match_info.map_name}")

    def on_match_end(self, result: dict) -> None:
        super().on_match_end(result)
        outcome = result.get("result", "?")
        if outcome == "victory":
            logger.info("🏆 We won!")
        elif outcome == "defeat":
            logger.info("💀 We lost. Analyzing for improvements...")
        else:
            logger.info(f"Match ended: {outcome}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="IronCurtain Example Bot")
    parser.add_argument("--name", default="PythonBot", help="Bot name")
    parser.add_argument("--arena", default="http://localhost:8080", help="Arena URL")
    parser.add_argument("--mode", default="ranked_1v1", help="Game mode")
    parser.add_argument("--faction", default="random", help="Faction preference")
    parser.add_argument("--api-key", default=None, help="Existing API key")
    parser.add_argument("--agent-id", default=None, help="Existing agent ID")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose logging")
    args = parser.parse_args()

    bot = ExampleBot(
        name=args.name,
        arena_url=args.arena,
        mode=GameMode(args.mode),
        faction=Faction(args.faction),
        api_key=args.api_key,
        agent_id=args.agent_id,
        log_level=logging.DEBUG if args.verbose else logging.INFO,
    )
    bot.run()
