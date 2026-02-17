// Deserializes JSON commands from the MCP server into OpenRA Order objects.
// This is the "hands" of the AI — translating strategic decisions into game actions.

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

		public Order Deserialize(JsonElement? paramsElement)
		{
			if (paramsElement == null)
				return null;

			var p = paramsElement.Value;
			var orderType = p.GetProperty("order").GetString();

			return orderType switch
			{
				"Move" => DeserializeMoveOrder(p),
				"Attack" => DeserializeAttackOrder(p),
				"AttackMove" => DeserializeAttackMoveOrder(p),
				"Stop" => DeserializeStopOrder(p),
				"DeployTransform" => DeserializeDeployOrder(p),
				"StartProduction" => DeserializeStartProductionOrder(p),
				"CancelProduction" => DeserializeCancelProductionOrder(p),
				"PlaceBuilding" => DeserializePlaceBuildingOrder(p),
				"Sell" => DeserializeSellOrder(p),
				"RepairBuilding" => DeserializeRepairOrder(p),
				"SetRallyPoint" => DeserializeRallyPointOrder(p),
				"Scatter" => DeserializeScatterOrder(p),
				_ => null
			};
		}

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

		Actor GetSubject(JsonElement p)
		{
			if (!p.TryGetProperty("subject_id", out var subjectId))
				return null;

			var actor = world.GetActorById(subjectId.GetUInt32());
			if (actor == null || actor.IsDead || actor.Owner != player)
				return null;

			return actor;
		}

		Actor[] GetSubjects(JsonElement p)
		{
			if (!p.TryGetProperty("unit_ids", out var unitIds))
				return Array.Empty<Actor>();

			return unitIds.EnumerateArray()
				.Select(id => world.GetActorById(id.GetUInt32()))
				.Where(a => a != null && !a.IsDead && a.Owner == player)
				.ToArray();
		}

		CPos GetTargetCell(JsonElement p)
		{
			var target = p.GetProperty("target_cell");
			return new CPos(target[0].GetInt32(), target[1].GetInt32());
		}

		bool GetQueued(JsonElement p)
		{
			return p.TryGetProperty("queued", out var q) && q.GetBoolean();
		}

		Order DeserializeMoveOrder(JsonElement p)
		{
			var subject = GetSubject(p);
			if (subject == null) return null;

			var cell = GetTargetCell(p);
			var queued = GetQueued(p);
			return new Order("Move", subject, Target.FromCell(world, cell), queued);
		}

		Order DeserializeAttackOrder(JsonElement p)
		{
			var subject = GetSubject(p);
			if (subject == null) return null;

			var targetId = p.GetProperty("target_id").GetUInt32();
			var target = world.GetActorById(targetId);
			if (target == null || target.IsDead) return null;

			var queued = GetQueued(p);
			return new Order("Attack", subject, Target.FromActor(target), queued);
		}

		Order DeserializeAttackMoveOrder(JsonElement p)
		{
			var subject = GetSubject(p);
			if (subject == null) return null;

			var cell = GetTargetCell(p);
			var queued = GetQueued(p);
			return new Order("AttackMove", subject, Target.FromCell(world, cell), queued);
		}

		Order DeserializeStopOrder(JsonElement p)
		{
			var subject = GetSubject(p);
			if (subject == null) return null;

			return new Order("Stop", subject, false);
		}

		Order DeserializeDeployOrder(JsonElement p)
		{
			var subject = GetSubject(p);
			if (subject == null) return null;

			return new Order("DeployTransform", subject, true);
		}

		Order DeserializeStartProductionOrder(JsonElement p)
		{
			var subjectId = p.TryGetProperty("building_id", out var bid) ? bid.GetUInt32() : 0;
			Actor subject = null;

			if (subjectId > 0)
			{
				subject = world.GetActorById(subjectId);
			}
			else
			{
				// Auto-select a production building that can build this type
				var itemType = p.GetProperty("type").GetString();
				subject = world.Actors
					.Where(a => a.Owner == player && !a.IsDead && a.IsInWorld)
					.Where(a => a.TraitsImplementing<ProductionQueue>().Any(q => q.Enabled))
					.FirstOrDefault();
			}

			if (subject == null) return null;

			var type = p.GetProperty("type").GetString();
			var count = p.TryGetProperty("count", out var c) ? c.GetInt32() : 1;

			return Order.StartProduction(subject, type, count);
		}

		Order DeserializeCancelProductionOrder(JsonElement p)
		{
			var subject = GetSubject(p);
			if (subject == null) return null;

			var type = p.GetProperty("type").GetString();
			var count = p.TryGetProperty("count", out var c) ? c.GetInt32() : 1;

			return Order.CancelProduction(subject, type, count);
		}

		Order DeserializePlaceBuildingOrder(JsonElement p)
		{
			// Building placement is more complex — needs the player actor and building location
			var type = p.GetProperty("type").GetString();
			var position = p.GetProperty("position");
			var cell = new CPos(position[0].GetInt32(), position[1].GetInt32());

			// PlaceBuilding orders target the player actor
			return new Order("PlaceBuilding", player.PlayerActor,
				Target.FromCell(world, cell), false)
			{
				TargetString = type,
				ExtraLocation = cell
			};
		}

		Order DeserializeSellOrder(JsonElement p)
		{
			var subject = GetSubject(p);
			if (subject == null) return null;

			return new Order("Sell", subject, false);
		}

		Order DeserializeRepairOrder(JsonElement p)
		{
			var subject = GetSubject(p);
			if (subject == null) return null;

			return new Order("RepairBuilding", subject, false);
		}

		Order DeserializeRallyPointOrder(JsonElement p)
		{
			var subject = GetSubject(p);
			if (subject == null) return null;

			var position = p.GetProperty("position");
			var cell = new CPos(position[0].GetInt32(), position[1].GetInt32());

			return new Order("SetRallyPoint", subject, Target.FromCell(world, cell), false);
		}

		Order DeserializeScatterOrder(JsonElement p)
		{
			var subject = GetSubject(p);
			if (subject == null) return null;

			return new Order("Scatter", subject, false);
		}
	}
}
