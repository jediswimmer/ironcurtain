// Deserializes JSON commands from external AI agents into OpenRA Order objects.
// This is the "hands" of the AI — translating strategic decisions into game actions.
//
// All order formats match exactly how OpenRA's built-in bot modules issue orders.
// Order strings, subject actors, targets, and extra fields are based on real
// OpenRA bot code (ModularBot, BaseBuilderQueueManager, SquadManager, etc.).

#region Copyright & License Information
/*
 * Copyright (c) IronCurtain Contributors
 * Licensed under the MIT License. See LICENSE for details.
 */
#endregion

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using OpenRA.Mods.Common.Traits;
using OpenRA.Traits;

namespace OpenRA.Mods.MCP.Serialization
{
	public sealed class OrderDeserializer
	{
		readonly World world;
		readonly Player player;

		public OrderDeserializer(World world, Player player)
		{
			this.world = world;
			this.player = player;
		}

		/// <summary>
		/// Deserialize a single order from JSON params.
		/// Expected format: {"order": "Move", "subject_id": 123, "target_cell": [10, 20], ...}
		/// </summary>
		public Order Deserialize(JsonElement? paramsElement)
		{
			if (paramsElement == null)
				return null;

			var p = paramsElement.Value;
			if (!p.TryGetProperty("order", out var orderTypeEl))
				return null;

			var orderType = orderTypeEl.GetString();

			try
			{
				return orderType switch
				{
					"Move" => DeserializeMoveOrder(p),
					"AttackMove" => DeserializeAttackMoveOrder(p),
					"Attack" => DeserializeAttackOrder(p),
					"Stop" => DeserializeStopOrder(p),
					"DeployTransform" => DeserializeDeployOrder(p),
					"Produce" or "StartProduction" => DeserializeStartProductionOrder(p),
					"CancelProduction" => DeserializeCancelProductionOrder(p),
					"PlaceBuilding" => DeserializePlaceBuildingOrder(p),
					"Sell" => DeserializeSellOrder(p),
					"RepairBuilding" => DeserializeRepairOrder(p),
					"SetRallyPoint" => DeserializeRallyPointOrder(p),
					"Scatter" => DeserializeScatterOrder(p),
					_ => null
				};
			}
			catch (Exception ex)
			{
				Log.Write("mcp", $"OrderDeserializer: Error deserializing '{orderType}': {ex.Message}");
				return null;
			}
		}

		/// <summary>
		/// Deserialize multiple orders from JSON.
		/// Expected format: {"orders": [{"order": "Move", ...}, ...]}
		/// </summary>
		public List<Order> DeserializeMultiple(JsonElement? paramsElement)
		{
			var orders = new List<Order>();
			if (paramsElement == null)
				return orders;

			var p = paramsElement.Value;
			if (p.TryGetProperty("orders", out var ordersArray))
			{
				foreach (var orderElement in ordersArray.EnumerateArray())
				{
					var order = Deserialize(orderElement);
					if (order != null)
						orders.Add(order);
				}
			}

			return orders;
		}

		/// <summary>
		/// Get the subject actor, validating it belongs to this player and is alive.
		/// </summary>
		Actor GetOwnActor(JsonElement p, string idProperty = "subject_id")
		{
			if (!p.TryGetProperty(idProperty, out var idEl))
				return null;

			var actor = world.GetActorById(idEl.GetUInt32());
			if (actor == null || actor.IsDead || !actor.IsInWorld || actor.Owner != player)
				return null;

			return actor;
		}

		/// <summary>
		/// Get a target cell from JSON.
		/// Supports: {"target_cell": [10, 20]} or {"target_cell": {"x": 10, "y": 20}}
		/// </summary>
		CPos GetTargetCell(JsonElement p, string property = "target_cell")
		{
			var target = p.GetProperty(property);
			if (target.ValueKind == JsonValueKind.Array)
				return new CPos(target[0].GetInt32(), target[1].GetInt32());

			return new CPos(target.GetProperty("x").GetInt32(), target.GetProperty("y").GetInt32());
		}

		bool GetQueued(JsonElement p)
		{
			return p.TryGetProperty("queued", out var q) && q.GetBoolean();
		}

		// ──────────────────────────────────────────────────────────────
		// Order: Move
		// Matches: bot.QueueOrder(new Order("Move", mcv, Target.FromCell(world, location), true))
		// ──────────────────────────────────────────────────────────────
		Order DeserializeMoveOrder(JsonElement p)
		{
			var subject = GetOwnActor(p);
			if (subject == null) return null;

			var cell = GetTargetCell(p);
			var queued = GetQueued(p);
			return new Order("Move", subject, Target.FromCell(world, cell), queued);
		}

		// ──────────────────────────────────────────────────────────────
		// Order: AttackMove
		// Matches: bot.QueueOrder(new Order("AttackMove", actor, target, false))
		// Also supports grouped actors via "unit_ids"
		// ──────────────────────────────────────────────────────────────
		Order DeserializeAttackMoveOrder(JsonElement p)
		{
			var cell = GetTargetCell(p);
			var queued = GetQueued(p);

			// Support grouped attack-move (like squad orders)
			if (p.TryGetProperty("unit_ids", out var unitIds))
			{
				var groupedActors = unitIds.EnumerateArray()
					.Select(id => world.GetActorById(id.GetUInt32()))
					.Where(a => a != null && !a.IsDead && a.IsInWorld && a.Owner == player)
					.ToArray();

				if (groupedActors.Length == 0) return null;

				return new Order("AttackMove", null, Target.FromCell(world, cell), queued,
					groupedActors: groupedActors);
			}

			// Single-actor attack-move
			var subject = GetOwnActor(p);
			if (subject == null) return null;

			return new Order("AttackMove", subject, Target.FromCell(world, cell), queued);
		}

		// ──────────────────────────────────────────────────────────────
		// Order: Attack (target a specific actor)
		// ──────────────────────────────────────────────────────────────
		Order DeserializeAttackOrder(JsonElement p)
		{
			var subject = GetOwnActor(p);
			if (subject == null) return null;

			if (!p.TryGetProperty("target_id", out var targetIdEl))
				return null;

			var target = world.GetActorById(targetIdEl.GetUInt32());
			if (target == null || target.IsDead || !target.IsInWorld)
				return null;

			var queued = GetQueued(p);
			return new Order("Attack", subject, Target.FromActor(target), queued);
		}

		// ──────────────────────────────────────────────────────────────
		// Order: Stop
		// ──────────────────────────────────────────────────────────────
		Order DeserializeStopOrder(JsonElement p)
		{
			var subject = GetOwnActor(p);
			if (subject == null) return null;

			return new Order("Stop", subject, false);
		}

		// ──────────────────────────────────────────────────────────────
		// Order: DeployTransform (deploy MCV)
		// Matches: bot.QueueOrder(new Order("DeployTransform", mcv, true))
		// ──────────────────────────────────────────────────────────────
		Order DeserializeDeployOrder(JsonElement p)
		{
			var subject = GetOwnActor(p);
			if (subject == null) return null;

			return new Order("DeployTransform", subject, true);
		}

		// ──────────────────────────────────────────────────────────────
		// Order: StartProduction (queue a unit or building for production)
		// Matches: bot.QueueOrder(Order.StartProduction(queue.Actor, item.Name, 1))
		//
		// JSON: {"order": "Produce", "type": "e1", "count": 1}
		//   or: {"order": "Produce", "type": "e1", "count": 1, "building_id": 123}
		// ──────────────────────────────────────────────────────────────
		Order DeserializeStartProductionOrder(JsonElement p)
		{
			var type = p.GetProperty("type").GetString();
			var count = p.TryGetProperty("count", out var c) ? c.GetInt32() : 1;

			// If building_id is specified, use that specific producer
			Actor producer = null;
			if (p.TryGetProperty("building_id", out var bid))
			{
				producer = GetOwnActor(p, "building_id");
			}
			else
			{
				// Find a production queue that can build this item
				producer = world.Actors
					.Where(a => a.Owner == player && !a.IsDead && a.IsInWorld)
					.FirstOrDefault(a => a.TraitsImplementing<ProductionQueue>()
						.Any(q => q.Enabled && q.BuildableItems().Any(i => i.Name == type)));
			}

			if (producer == null)
			{
				Log.Write("mcp", $"OrderDeserializer: No producer found for '{type}'");
				return null;
			}

			return Order.StartProduction(producer, type, count);
		}

		// ──────────────────────────────────────────────────────────────
		// Order: CancelProduction
		// Matches: bot.QueueOrder(Order.CancelProduction(queue.Actor, item, 1))
		// ──────────────────────────────────────────────────────────────
		Order DeserializeCancelProductionOrder(JsonElement p)
		{
			var type = p.GetProperty("type").GetString();
			var count = p.TryGetProperty("count", out var c) ? c.GetInt32() : 1;

			Actor producer = null;
			if (p.TryGetProperty("building_id", out _))
				producer = GetOwnActor(p, "building_id");
			else
			{
				// Find a queue that's producing this item
				producer = world.Actors
					.Where(a => a.Owner == player && !a.IsDead && a.IsInWorld)
					.FirstOrDefault(a => a.TraitsImplementing<ProductionQueue>()
						.Any(q => q.Enabled && q.AllQueued().Any(i => i.Item == type)));
			}

			if (producer == null) return null;

			return Order.CancelProduction(producer, type, count);
		}

		// ──────────────────────────────────────────────────────────────
		// Order: PlaceBuilding
		// Matches (from BaseBuilderQueueManager):
		//   bot.QueueOrder(new Order("PlaceBuilding", player.PlayerActor,
		//     Target.FromCell(world, location), false)
		//   {
		//     TargetString = currentBuilding.Item,
		//     ExtraLocation = new CPos(actorVariant, 0),
		//     ExtraData = queue.Actor.ActorID,
		//     SuppressVisualFeedback = true
		//   });
		//
		// JSON: {"order": "PlaceBuilding", "type": "fact", "position": [10, 20]}
		//   or: {"order": "PlaceBuilding", "type": "fact", "position": [10, 20], "building_id": 123}
		// ──────────────────────────────────────────────────────────────
		Order DeserializePlaceBuildingOrder(JsonElement p)
		{
			var type = p.GetProperty("type").GetString();
			var cell = GetTargetCell(p, "position");

			// Find the production queue that has a completed item of this type
			uint producerActorId = 0;
			if (p.TryGetProperty("building_id", out var bid))
			{
				producerActorId = bid.GetUInt32();
			}
			else
			{
				// Auto-find a queue with a completed building of this type
				var producerActor = world.Actors
					.Where(a => a.Owner == player && !a.IsDead && a.IsInWorld)
					.FirstOrDefault(a => a.TraitsImplementing<ProductionQueue>()
						.Any(q => q.Enabled && q.AllQueued().Any(i => i.Done && i.Item == type)));

				if (producerActor != null)
					producerActorId = producerActor.ActorID;
			}

			return new Order("PlaceBuilding", player.PlayerActor,
				Target.FromCell(world, cell), false)
			{
				TargetString = type,
				ExtraLocation = CPos.Zero, // No variant
				ExtraData = producerActorId,
				SuppressVisualFeedback = true
			};
		}

		// ──────────────────────────────────────────────────────────────
		// Order: Sell
		// Matches: bot.QueueOrder(new Order("Sell", building, Target.FromActor(building), false))
		// ──────────────────────────────────────────────────────────────
		Order DeserializeSellOrder(JsonElement p)
		{
			var subject = GetOwnActor(p);
			if (subject == null) return null;

			return new Order("Sell", subject, Target.FromActor(subject), false);
		}

		// ──────────────────────────────────────────────────────────────
		// Order: RepairBuilding
		// Matches: bot.QueueOrder(new Order("RepairBuilding", owner.PlayerActor, Target.FromActor(building), false))
		// Note: subject is the PLAYER ACTOR, target is the building to repair
		// ──────────────────────────────────────────────────────────────
		Order DeserializeRepairOrder(JsonElement p)
		{
			var building = GetOwnActor(p);
			if (building == null) return null;

			return new Order("RepairBuilding", player.PlayerActor, Target.FromActor(building), false);
		}

		// ──────────────────────────────────────────────────────────────
		// Order: SetRallyPoint
		// Matches: bot.QueueOrder(new Order("SetRallyPoint", rp.Actor,
		//   Target.FromCell(world, location), false) { SuppressVisualFeedback = true })
		// ──────────────────────────────────────────────────────────────
		Order DeserializeRallyPointOrder(JsonElement p)
		{
			var subject = GetOwnActor(p);
			if (subject == null) return null;

			var cell = GetTargetCell(p, "position");

			return new Order("SetRallyPoint", subject, Target.FromCell(world, cell), false)
			{
				SuppressVisualFeedback = true
			};
		}

		// ──────────────────────────────────────────────────────────────
		// Order: Scatter
		// ──────────────────────────────────────────────────────────────
		Order DeserializeScatterOrder(JsonElement p)
		{
			var subject = GetOwnActor(p);
			if (subject == null) return null;

			return new Order("Scatter", subject, false);
		}
	}
}
