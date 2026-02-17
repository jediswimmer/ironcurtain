// IronCurtain — ExternalBot for OpenRA
// Implements IBot to bridge external AI commands into the OpenRA game engine.
//
// This is the core integration point. It:
// 1. Implements IBot (the same interface used by ModularBot AI)
// 2. Runs a TCP IPC server for communication with external AI agents
// 3. Serializes game state to JSON for external consumption
// 4. Deserializes commands from JSON into Order objects
//
// See ARCHITECTURE.md for full design documentation.

#region Copyright & License Information
/*
 * Copyright (c) IronCurtain Contributors
 * Licensed under the MIT License. See LICENSE for details.
 */
#endregion

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using OpenRA.Mods.Common.Traits;
using OpenRA.Mods.MCP.Protocol;
using OpenRA.Mods.MCP.Serialization;
using OpenRA.Support;
using OpenRA.Traits;

namespace OpenRA.Mods.MCP
{
	[Desc("Bot controlled by an external AI via TCP IPC.")]
	[TraitLocation(SystemActors.Player)]
	public sealed class ExternalBotInfo : TraitInfo, IBotInfo
	{
		[FieldLoader.Require]
		[Desc("Internal id for this bot.")]
		public readonly string Type = null;

		[FieldLoader.Require]
		[Desc("Human-readable name this bot uses.")]
		public readonly string Name = null;

		[Desc("TCP port for IPC communication with external AI agent.")]
		public readonly int TcpPort = 18642;

		[Desc("Minimum portion of pending orders to issue each tick " +
			"(e.g. 5 issues at least 1/5th of all pending orders).")]
		public readonly int MinOrderQuotientPerTick = 5;

		[Desc("Minimum ticks between full state snapshots broadcast to clients.")]
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
		readonly ConcurrentQueue<IpcClientMessage> incomingMessages = new();
		readonly List<GameEvent> pendingEvents = new();

		Player player;
		IpcServer ipcServer;
		GameStateSerializer stateSerializer;
		OrderDeserializer orderDeserializer;
		int ticksSinceSnapshot;

		public bool IsEnabled { get; private set; }

		IBotInfo IBot.Info => info;
		Player IBot.Player => player;

		public ExternalBot(ExternalBotInfo info, ActorInitializer init)
		{
			this.info = info;
			world = init.World;
		}

		void IBot.Activate(Player p)
		{
			// Bot logic must not affect world state directly; only via orders
			// Orders are recorded in replay, so bots shouldn't be enabled during replays
			if (p.World.IsReplay)
				return;

			IsEnabled = true;
			player = p;

			// Initialize serialization helpers
			stateSerializer = new GameStateSerializer(world, player);
			orderDeserializer = new OrderDeserializer(world, player);

			// Start TCP IPC server
			ipcServer = new IpcServer(info.TcpPort);
			ipcServer.OnMessage += (clientId, msg) => incomingMessages.Enqueue(
				new IpcClientMessage { ClientId = clientId, Message = msg });
			ipcServer.Start();

			Log.Write("mcp", $"ExternalBot activated for player {player.ResolvedPlayerName}");
			Log.Write("mcp", $"IPC listening on TCP port {info.TcpPort}");
		}

		void IBot.QueueOrder(Order order)
		{
			pendingOrders.Enqueue(order);
		}

		void ITick.Tick(Actor self)
		{
			if (!IsEnabled || self.World.IsLoadingGameSave)
				return;

			using (new PerfSample("mcp_bot_tick"))
			{
				// Run bot logic outside of sync checks (same pattern as ModularBot)
				Sync.RunUnsynced(Game.Settings.Debug.SyncCheckBotModuleCode, world, () =>
				{
					// Process incoming IPC messages
					while (incomingMessages.TryDequeue(out var clientMsg))
						ProcessMessage(clientMsg.ClientId, clientMsg.Message);

					// Periodic state snapshot broadcast
					ticksSinceSnapshot++;
					if (ticksSinceSnapshot >= info.StateSnapshotInterval)
					{
						ticksSinceSnapshot = 0;
						BroadcastStateUpdate();
					}
				});
			}

			// Issue pending orders (rate-limited, same as ModularBot)
			var ordersToIssue = Math.Min(
				(pendingOrders.Count + info.MinOrderQuotientPerTick - 1) / info.MinOrderQuotientPerTick,
				pendingOrders.Count);

			for (var i = 0; i < ordersToIssue; i++)
				world.IssueOrder(pendingOrders.Dequeue());
		}

		void INotifyDamage.Damaged(Actor self, AttackInfo e)
		{
			if (!IsEnabled || self.World.IsLoadingGameSave)
				return;

			Sync.RunUnsynced(Game.Settings.Debug.SyncCheckBotModuleCode, world, () =>
			{
				pendingEvents.Add(new GameEvent
				{
					Type = "under_attack",
					ActorId = self.ActorID,
					ActorType = self.Info.Name,
					AttackerType = e.Attacker?.Info.Name,
					PositionX = self.Location.X,
					PositionY = self.Location.Y,
					Damage = e.Damage.Value,
					Tick = world.WorldTick
				});
			});
		}

		void ProcessMessage(string clientId, IpcMessage msg)
		{
			try
			{
				switch (msg.Method)
				{
					case "get_state":
						var state = stateSerializer.SerializeFullState();
						ipcServer.SendResponse(clientId, msg.Id, state);
						break;

					case "get_units":
						var units = stateSerializer.SerializeUnits(msg.Params);
						ipcServer.SendResponse(clientId, msg.Id, units);
						break;

					case "get_buildings":
						var buildings = stateSerializer.SerializeBuildings();
						ipcServer.SendResponse(clientId, msg.Id, buildings);
						break;

					case "get_resources":
						var resources = stateSerializer.SerializeResources();
						ipcServer.SendResponse(clientId, msg.Id, resources);
						break;

					case "get_enemy_intel":
						var intel = stateSerializer.SerializeEnemyIntel();
						ipcServer.SendResponse(clientId, msg.Id, intel);
						break;

					case "get_build_options":
						var options = stateSerializer.SerializeBuildOptions();
						ipcServer.SendResponse(clientId, msg.Id, options);
						break;

					case "get_production_queues":
						var queues = stateSerializer.SerializeProductionQueues();
						ipcServer.SendResponse(clientId, msg.Id, queues);
						break;

					case "get_map_info":
						var mapInfo = stateSerializer.SerializeMapInfo();
						ipcServer.SendResponse(clientId, msg.Id, mapInfo);
						break;

					case "get_power":
						var power = stateSerializer.SerializePowerState();
						ipcServer.SendResponse(clientId, msg.Id, power);
						break;

					case "issue_order":
						var order = orderDeserializer.Deserialize(msg.Params);
						if (order != null)
						{
							pendingOrders.Enqueue(order);
							ipcServer.SendResponse(clientId, msg.Id, new { success = true });
						}
						else
						{
							ipcServer.SendResponse(clientId, msg.Id, new { success = false, error = "Invalid or unrecognized order" });
						}

						break;

					case "issue_orders":
						var orders = orderDeserializer.DeserializeMultiple(msg.Params);
						foreach (var o in orders)
							pendingOrders.Enqueue(o);
						ipcServer.SendResponse(clientId, msg.Id, new { success = true, queued = orders.Count });
						break;

					case "ping":
						ipcServer.SendResponse(clientId, msg.Id, new
						{
							pong = true,
							tick = world.WorldTick,
							player_name = player.ResolvedPlayerName,
							is_game_over = world.IsGameOver
						});
						break;

					default:
						ipcServer.SendResponse(clientId, msg.Id, new { error = $"Unknown method: {msg.Method}" });
						break;
				}
			}
			catch (Exception ex)
			{
				Log.Write("mcp", $"Error processing message '{msg.Method}': {ex.Message}");
				try
				{
					ipcServer.SendResponse(clientId, msg.Id, new { error = ex.Message });
				}
				catch
				{
					// Client may have disconnected
				}
			}
		}

		void BroadcastStateUpdate()
		{
			if (!ipcServer.HasClients)
				return;

			var update = new
			{
				tick = world.WorldTick,
				is_game_over = world.IsGameOver,
				events = pendingEvents.ToArray(),
				summary = stateSerializer.SerializeSummary()
			};

			ipcServer.BroadcastEvent("state_update", update);
			pendingEvents.Clear();
		}
	}
}
