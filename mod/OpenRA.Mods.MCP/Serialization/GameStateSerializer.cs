// Serializes OpenRA game state to JSON for external AI agents.
// STRICTLY respects fog of war — only reports what the bot player can actually see.
//
// This is the "eyes" of the AI. Everything the external agent knows about the game
// comes through this serializer.
//
// All types returned are anonymous objects suitable for System.Text.Json serialization.

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
	public sealed class GameStateSerializer
	{
		readonly World world;
		readonly Player player;

		public GameStateSerializer(World world, Player player)
		{
			this.world = world;
			this.player = player;
		}

		/// <summary>
		/// Quick summary for periodic state_update broadcasts (low bandwidth).
		/// </summary>
		public object SerializeSummary()
		{
			var resources = player.PlayerActor.Trait<PlayerResources>();
			var ownActors = world.Actors
				.Where(a => a.Owner == player && !a.IsDead && a.IsInWorld);

			return new
			{
				tick = world.WorldTick,
				credits = resources.GetCashAndResources(),
				cash = resources.Cash,
				ore = resources.Resources,
				unit_count = ownActors.Count(a => a.Info.HasTraitInfo<MobileInfo>() && !a.Info.HasTraitInfo<BuildingInfo>()),
				building_count = ownActors.Count(a => a.Info.HasTraitInfo<BuildingInfo>()),
				is_game_over = world.IsGameOver
			};
		}

		/// <summary>
		/// Full game state snapshot — everything the AI needs to make decisions.
		/// </summary>
		public object SerializeFullState()
		{
			return new
			{
				tick = world.WorldTick,
				is_game_over = world.IsGameOver,
				player_info = SerializePlayerInfo(),
				units = SerializeUnits(null),
				buildings = SerializeBuildings(),
				resources = SerializeResources(),
				enemy_intel = SerializeEnemyIntel(),
				build_options = SerializeBuildOptions(),
				production_queues = SerializeProductionQueues(),
				power = SerializePowerState()
			};
		}

		object SerializePlayerInfo()
		{
			var resources = player.PlayerActor.Trait<PlayerResources>();
			var powerManager = player.PlayerActor.TraitOrDefault<PowerManager>();

			return new
			{
				name = player.ResolvedPlayerName,
				faction = player.Faction.InternalName,
				credits = resources.GetCashAndResources(),
				cash = resources.Cash,
				ore = resources.Resources,
				power_provided = powerManager?.PowerProvided ?? 0,
				power_drained = powerManager?.PowerDrained ?? 0,
				excess_power = powerManager?.ExcessPower ?? 0
			};
		}

		/// <summary>
		/// Serialize own mobile units with optional type filtering.
		/// </summary>
		public object SerializeUnits(JsonElement? filterParams)
		{
			string typeFilter = null;
			if (filterParams != null && filterParams.Value.TryGetProperty("type", out var typeEl))
				typeFilter = typeEl.GetString();

			var query = world.Actors
				.Where(a => a.Owner == player && !a.IsDead && a.IsInWorld)
				.Where(a => a.Info.HasTraitInfo<MobileInfo>() && !a.Info.HasTraitInfo<BuildingInfo>());

			if (typeFilter != null)
				query = query.Where(a => a.Info.Name == typeFilter);

			var units = query.Select(a =>
			{
				var health = a.TraitOrDefault<IHealth>();
				var mobile = a.TraitOrDefault<Mobile>();

				return new
				{
					id = a.ActorID,
					type = a.Info.Name,
					position = new { x = a.Location.X, y = a.Location.Y },
					health = health?.HP ?? 0,
					max_health = health?.MaxHP ?? 0,
					health_percent = health != null && health.MaxHP > 0
						? (int)((double)health.HP / health.MaxHP * 100) : 100,
					is_idle = a.IsIdle,
					can_attack = a.Info.HasTraitInfo<AttackBaseInfo>(),
					can_move = mobile != null && !mobile.IsTraitDisabled,
					is_harvester = a.Info.HasTraitInfo<HarvesterInfo>()
				};
			}).ToArray();

			var byType = units
				.GroupBy(u => u.type)
				.ToDictionary(g => g.Key, g => g.Count());

			return new
			{
				units,
				total_count = units.Length,
				by_type = byType
			};
		}

		/// <summary>
		/// Serialize own buildings with production and health info.
		/// </summary>
		public object SerializeBuildings()
		{
			var buildings = world.Actors
				.Where(a => a.Owner == player && !a.IsDead && a.IsInWorld)
				.Where(a => a.Info.HasTraitInfo<BuildingInfo>())
				.Select(a =>
				{
					var health = a.TraitOrDefault<IHealth>();

					// Get production queues attached to this actor
					var actorQueues = a.TraitsImplementing<ProductionQueue>()
						.Where(q => q.Enabled)
						.SelectMany(q => q.AllQueued().Select(item => new
						{
							type = item.Item,
							progress_percent = item.TotalCost > 0
								? (int)((1.0 - (double)item.RemainingCost / item.TotalCost) * 100)
								: 100,
							paused = item.Paused,
							done = item.Done,
							cost = item.TotalCost
						}))
						.ToArray();

					var rallyPoint = a.TraitOrDefault<RallyPoint>();
					var primaryBuilding = a.TraitOrDefault<PrimaryBuilding>();

					return new
					{
						id = a.ActorID,
						type = a.Info.Name,
						position = new { x = a.Location.X, y = a.Location.Y },
						health = health?.HP ?? 0,
						max_health = health?.MaxHP ?? 0,
						health_percent = health != null && health.MaxHP > 0
							? (int)((double)health.HP / health.MaxHP * 100) : 100,
						production_queue = actorQueues,
						rally_point = rallyPoint?.Path.Count > 0
							? new { x = rallyPoint.Path[^1].X, y = rallyPoint.Path[^1].Y }
							: null,
						is_primary = primaryBuilding?.IsPrimary ?? false,
						has_production = a.TraitsImplementing<ProductionQueue>().Any(q => q.Enabled)
					};
				})
				.ToArray();

			return new { buildings };
		}

		/// <summary>
		/// Serialize resource / economy status.
		/// </summary>
		public object SerializeResources()
		{
			var resources = player.PlayerActor.Trait<PlayerResources>();

			var harvesters = world.Actors
				.Where(a => a.Owner == player && !a.IsDead && a.IsInWorld)
				.Where(a => a.Info.HasTraitInfo<HarvesterInfo>())
				.Select(a => new
				{
					id = a.ActorID,
					position = new { x = a.Location.X, y = a.Location.Y },
					is_idle = a.IsIdle,
					health_percent = a.TraitOrDefault<IHealth>() is IHealth h && h.MaxHP > 0
						? (int)((double)h.HP / h.MaxHP * 100) : 100
				})
				.ToArray();

			return new
			{
				credits = resources.GetCashAndResources(),
				cash = resources.Cash,
				ore = resources.Resources,
				harvester_count = harvesters.Length,
				harvesters
			};
		}

		/// <summary>
		/// Serialize visible enemy information.
		/// STRICTLY ENFORCES FOG OF WAR — only reports actors visible to this player.
		/// </summary>
		public object SerializeEnemyIntel()
		{
			// Visible enemy actors (currently within LOS)
			var visibleEnemies = world.Actors
				.Where(a => !a.IsDead && a.IsInWorld)
				.Where(a => a.Owner != player && !a.Owner.NonCombatant)
				.Where(a => a.CanBeViewedByPlayer(player))
				.Select(a =>
				{
					var health = a.TraitOrDefault<IHealth>();
					return new
					{
						id = a.ActorID,
						type = a.Info.Name,
						owner = a.Owner.ResolvedPlayerName,
						position = new { x = a.Location.X, y = a.Location.Y },
						health_percent = health != null && health.MaxHP > 0
							? (int)((double)health.HP / health.MaxHP * 100) : 100,
						is_building = a.Info.HasTraitInfo<BuildingInfo>(),
						is_harvester = a.Info.HasTraitInfo<HarvesterInfo>(),
						can_attack = a.Info.HasTraitInfo<AttackBaseInfo>()
					};
				})
				.ToArray();

			// Frozen actors (last known positions of enemies in fog)
			var frozenEnemies = new List<object>();
			var frozenActorLayer = player.FrozenActorLayer;
			if (frozenActorLayer != null)
			{
				// Use the map bounds to search the entire map via FrozenActorsInRegion
				var mapBounds = new CellRegion(
					world.Map.Grid.Type,
					new CPos(world.Map.Bounds.Left, world.Map.Bounds.Top),
					new CPos(world.Map.Bounds.Right, world.Map.Bounds.Bottom));

				foreach (var frozen in frozenActorLayer.FrozenActorsInRegion(mapBounds, onlyVisible: false))
				{
					if (!frozen.IsValid)
						continue;

					// Skip own frozen actors
					if (frozen.Owner == player)
						continue;

					// Skip non-combatant owners
					if (frozen.Owner?.NonCombatant == true)
						continue;

					// Convert center position to cell coordinates
					var cell = world.Map.CellContaining(frozen.CenterPosition);

					frozenEnemies.Add(new
					{
						id = frozen.ID,
						type = frozen.Info.Name,
						owner = frozen.Owner?.ResolvedPlayerName,
						position = new { x = cell.X, y = cell.Y },
						is_visible = frozen.Visible,
						is_building = frozen.Info.HasTraitInfo<BuildingInfo>()
					});
				}
			}

			return new
			{
				visible = visibleEnemies,
				visible_count = visibleEnemies.Length,
				frozen = frozenEnemies.ToArray(),
				frozen_count = frozenEnemies.Count
			};
		}

		/// <summary>
		/// Serialize available build options based on current tech tree state.
		/// </summary>
		public object SerializeBuildOptions()
		{
			var buildable = new List<object>();

			// Check all production queues on the player actor and on owned buildings
			var allQueues = world.Actors
				.Where(a => a.Owner == player && !a.IsDead && a.IsInWorld)
				.SelectMany(a => a.TraitsImplementing<ProductionQueue>())
				.Where(q => q.Enabled);

			var seenItems = new HashSet<string>();

			foreach (var queue in allQueues)
			{
				foreach (var item in queue.BuildableItems())
				{
					// Avoid duplicates across queues
					var key = $"{queue.Info.Type}:{item.Name}";
					if (!seenItems.Add(key))
						continue;

					var bi = item.TraitInfoOrDefault<BuildableInfo>();
					var vi = item.TraitInfoOrDefault<ValuedInfo>();

					buildable.Add(new
					{
						type = item.Name,
						queue_type = queue.Info.Type,
						cost = vi?.Cost ?? 0,
						prerequisites = bi?.Prerequisites.ToArray() ?? Array.Empty<string>(),
						is_building = item.HasTraitInfo<BuildingInfo>(),
						is_defense = item.HasTraitInfo<AttackBaseInfo>() && item.HasTraitInfo<BuildingInfo>()
					});
				}
			}

			return new { options = buildable.ToArray() };
		}

		/// <summary>
		/// Serialize current production queue state across all owned producers.
		/// </summary>
		public object SerializeProductionQueues()
		{
			var queues = world.Actors
				.Where(a => a.Owner == player && !a.IsDead && a.IsInWorld)
				.SelectMany(a => a.TraitsImplementing<ProductionQueue>()
					.Where(q => q.Enabled)
					.Select(q => new
					{
						type = q.Info.Type,
						actor_id = a.ActorID,
						items = q.AllQueued().Select(item => new
						{
							type = item.Item,
							progress_percent = item.TotalCost > 0
								? (int)((1.0 - (double)item.RemainingCost / item.TotalCost) * 100)
								: 100,
							paused = item.Paused,
							done = item.Done,
							cost = item.TotalCost,
							remaining_cost = item.RemainingCost
						}).ToArray()
					}))
				.ToArray();

			return new { queues };
		}

		/// <summary>
		/// Serialize power state.
		/// </summary>
		public object SerializePowerState()
		{
			var powerManager = player.PlayerActor.TraitOrDefault<PowerManager>();
			if (powerManager == null)
				return new { available = false };

			return new
			{
				available = true,
				power_provided = powerManager.PowerProvided,
				power_drained = powerManager.PowerDrained,
				excess_power = powerManager.ExcessPower,
				is_low_power = powerManager.ExcessPower < 0
			};
		}

		/// <summary>
		/// Serialize map metadata.
		/// </summary>
		public object SerializeMapInfo()
		{
			var map = world.Map;
			return new
			{
				title = map.Title,
				width = map.MapSize.Width,
				height = map.MapSize.Height,
				bounds = new
				{
					left = map.Bounds.Left,
					top = map.Bounds.Top,
					right = map.Bounds.Right,
					bottom = map.Bounds.Bottom
				},
				players = world.Players
					.Where(p => !p.NonCombatant)
					.Select(p => new
					{
						name = p.ResolvedPlayerName,
						faction = p.Faction.InternalName,
						is_bot = p.IsBot,
						is_self = p == player
					})
					.ToArray()
			};
		}
	}
}
