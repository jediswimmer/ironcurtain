// CnC MCP — ExternalBot for OpenRA
// Implements IBot to bridge Claude's MCP commands into the OpenRA game engine.
//
// This is the core integration point. It:
// 1. Implements IBot (the same interface used by Rush/Normal/Turtle AI)
// 2. Runs an IPC server (Unix socket) for communication with the MCP server
// 3. Serializes game state to JSON for Claude to read
// 4. Deserializes commands from JSON into Order objects
//
// See ARCHITECTURE.md for full design documentation.

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using OpenRA.Mods.MCP.Protocol;
using OpenRA.Mods.MCP.Serialization;
using OpenRA.Traits;

namespace OpenRA.Mods.MCP
{
	[Desc("Bot controlled by an external AI via MCP (Model Context Protocol).")]
	[TraitLocation(SystemActors.Player)]
	public sealed class ExternalBotInfo : TraitInfo, IBotInfo
	{
		[FieldLoader.Require]
		[Desc("Internal id for this bot.")]
		public readonly string Type = null;

		[FieldLoader.Require]
		[Desc("Human-readable name this bot uses.")]
		public readonly string Name = null;

		[Desc("Unix socket path for IPC communication with MCP server.")]
		public readonly string SocketPath = "/tmp/openra-mcp.sock";

		[Desc("TCP port for IPC communication (fallback if Unix socket unavailable).")]
		public readonly int TcpPort = 18642;

		[Desc("Maximum orders to issue per tick.")]
		public readonly int MaxOrdersPerTick = 10;

		[Desc("Minimum ticks between full state snapshots.")]
		public readonly int StateSnapshotInterval = 25; // ~1 second at normal speed

		string IBotInfo.Type => Type;
		string IBotInfo.Name => Name;

		public override object Create(ActorInitializer init) { return new ExternalBot(this, init); }
	}

	public sealed class ExternalBot : ITick, IBot, INotifyDamage
	{
		readonly ExternalBotInfo info;
		readonly World world;
		readonly Queue<Order> pendingOrders = new();
		readonly ConcurrentQueue<IpcMessage> incomingMessages = new();
		readonly List<GameEvent> pendingEvents = new();

		Player player;
		IpcServer ipcServer;
		GameStateSerializer stateSerializer;
		OrderDeserializer orderDeserializer;
		int ticksSinceSnapshot;
		bool isEnabled;

		public bool IsEnabled => isEnabled;

		IBotInfo IBot.Info => info;
		Player IBot.Player => player;

		public ExternalBot(ExternalBotInfo info, ActorInitializer init)
		{
			this.info = info;
			world = init.World;
		}

		void IBot.Activate(Player p)
		{
			if (p.World.IsReplay)
				return;

			isEnabled = true;
			player = p;

			// Initialize serialization helpers
			stateSerializer = new GameStateSerializer(world, player);
			orderDeserializer = new OrderDeserializer(world, player);

			// Start IPC server
			ipcServer = new IpcServer(info.SocketPath, info.TcpPort);
			ipcServer.OnMessage += msg => incomingMessages.Enqueue(msg);
			ipcServer.Start();

			Log.Write("mcp", $"ExternalBot activated for player {player.ResolvedPlayerName}");
			Log.Write("mcp", $"IPC listening on {info.SocketPath} (TCP fallback: {info.TcpPort})");
		}

		void IBot.QueueOrder(Order order)
		{
			pendingOrders.Enqueue(order);
		}

		void ITick.Tick(Actor self)
		{
			if (!isEnabled || self.World.IsLoadingGameSave)
				return;

			// Process incoming IPC messages
			while (incomingMessages.TryDequeue(out var msg))
				ProcessMessage(msg);

			// Issue pending orders (rate-limited)
			var ordersToIssue = Math.Min(info.MaxOrdersPerTick, pendingOrders.Count);
			for (var i = 0; i < ordersToIssue; i++)
				world.IssueOrder(pendingOrders.Dequeue());

			// Periodic state snapshot broadcast
			ticksSinceSnapshot++;
			if (ticksSinceSnapshot >= info.StateSnapshotInterval)
			{
				ticksSinceSnapshot = 0;
				BroadcastStateUpdate();
			}
		}

		void INotifyDamage.Damaged(Actor self, AttackInfo e)
		{
			if (!isEnabled)
				return;

			pendingEvents.Add(new GameEvent
			{
				Type = "under_attack",
				ActorId = self.ActorID,
				ActorType = self.Info.Name,
				AttackerType = e.Attacker?.Info.Name,
				Position = self.Location
			});
		}

		void ProcessMessage(IpcMessage msg)
		{
			switch (msg.Method)
			{
				case "get_state":
					var state = stateSerializer.SerializeFullState();
					ipcServer.SendResponse(msg.Id, state);
					break;

				case "get_units":
					var units = stateSerializer.SerializeUnits(msg.Params);
					ipcServer.SendResponse(msg.Id, units);
					break;

				case "get_buildings":
					var buildings = stateSerializer.SerializeBuildings();
					ipcServer.SendResponse(msg.Id, buildings);
					break;

				case "get_resources":
					var resources = stateSerializer.SerializeResources();
					ipcServer.SendResponse(msg.Id, resources);
					break;

				case "get_enemy_intel":
					var intel = stateSerializer.SerializeEnemyIntel();
					ipcServer.SendResponse(msg.Id, intel);
					break;

				case "get_build_options":
					var options = stateSerializer.SerializeBuildOptions(msg.Params);
					ipcServer.SendResponse(msg.Id, options);
					break;

				case "get_production_queue":
					var queue = stateSerializer.SerializeProductionQueues();
					ipcServer.SendResponse(msg.Id, queue);
					break;

				case "issue_order":
					var order = orderDeserializer.Deserialize(msg.Params);
					if (order != null)
					{
						pendingOrders.Enqueue(order);
						ipcServer.SendResponse(msg.Id, new { success = true });
					}
					else
					{
						ipcServer.SendResponse(msg.Id, new { success = false, error = "Invalid order" });
					}
					break;

				case "issue_orders":
					var orders = orderDeserializer.DeserializeMultiple(msg.Params);
					foreach (var o in orders)
						pendingOrders.Enqueue(o);
					ipcServer.SendResponse(msg.Id, new { success = true, queued = orders.Count });
					break;

				default:
					ipcServer.SendResponse(msg.Id, new { error = $"Unknown method: {msg.Method}" });
					break;
			}
		}

		void BroadcastStateUpdate()
		{
			if (!ipcServer.HasClients)
				return;

			var update = new
			{
				tick = world.WorldTick,
				events = pendingEvents.ToArray(),
				summary = stateSerializer.SerializeSummary()
			};

			ipcServer.BroadcastEvent("state_update", update);
			pendingEvents.Clear();
		}
	}
}
