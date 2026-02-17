// Serializes OpenRA game state to JSON for the MCP server.
// Respects fog of war — only reports what the bot player can actually see.
//
// This is the "eyes" of the AI. Everything Claude knows about the game
// comes through this serializer.

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
		/// Quick summary for periodic updates (low bandwidth).
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
				unit_count = ownActors.Count(a => a.Info.HasTraitInfo<MobileInfo>()),
				building_count = ownActors.Count(a => a.Info.HasTraitInfo<BuildingInfo>()),
				is_game_over = world.IsGameOver
			};
		}

		/// <summary>
		/// Full game state snapshot.
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
				enemy_intel = SerializeEnemyIntel()
			};
		}

		object SerializePlayerInfo()
		{
			var resources = player.PlayerActor.Trait<PlayerResources>();
			return new
			{
				name = player.ResolvedPlayerName,
				faction = player.Faction.InternalName,
				credits = resources.GetCashAndResources(),
				cash = resources.Cash,
				// Power info would come from PowerManager trait
			};
		}

		/// <summary>
		/// Serialize own units with optional filtering.
		/// </summary>
		public object SerializeUnits(JsonElement? filterParams)
		{
			var units = world.Actors
				.Where(a => a.Owner == player && !a.IsDead && a.IsInWorld)
				.Where(a => a.Info.HasTraitInfo<MobileInfo>() && !a.Info.HasTraitInfo<BuildingInfo>())
				.Select(a => new
				{
					id = a.ActorID,
					type = a.Info.Name,
					position = new[] { a.Location.X, a.Location.Y },
					health = a.TraitOrDefault<Health>()?.HP ?? 0,
					max_health = a.TraitOrDefault<Health>()?.MaxHP ?? 0,
					is_idle = a.IsIdle,
					can_attack = a.Info.HasTraitInfo<AttackBaseInfo>(),
					can_move = !a.TraitOrDefault<Mobile>()?.IsTraitDisabled ?? false
				})
				.ToArray();

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
		/// Serialize own buildings with production info.
		/// </summary>
		public object SerializeBuildings()
		{
			var buildings = world.Actors
				.Where(a => a.Owner == player && !a.IsDead && a.IsInWorld)
				.Where(a => a.Info.HasTraitInfo<BuildingInfo>())
				.Select(a =>
				{
					var queues = a.TraitsImplementing<ProductionQueue>()
						.Where(q => q.Enabled)
						.SelectMany(q => q.AllQueued().Select(item => new
						{
							type = item.Item,
							progress_percent = item.TotalCost > 0
								? (int)((1.0 - (double)item.RemainingCost / item.TotalCost) * 100)
								: 0,
							paused = item.Paused,
							cost = item.TotalCost
						}))
						.ToArray();

					var rallyPoint = a.TraitOrDefault<RallyPoint>();

					return new
					{
						id = a.ActorID,
						type = a.Info.Name,
						position = new[] { a.Location.X, a.Location.Y },
						health = a.TraitOrDefault<Health>()?.HP ?? 0,
						max_health = a.TraitOrDefault<Health>()?.MaxHP ?? 0,
						production_queue = queues,
						rally_point = rallyPoint?.Path.Count > 0
							? new[] { rallyPoint.Path[^1].X, rallyPoint.Path[^1].Y }
							: null,
						is_primary = a.TraitOrDefault<PrimaryBuilding>()?.IsPrimary ?? false
					};
				})
				.ToArray();

			return new { buildings };
		}

		/// <summary>
		/// Serialize resource status.
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
					position = new[] { a.Location.X, a.Location.Y },
					is_idle = a.IsIdle
				})
				.ToArray();

			return new
			{
				credits = resources.GetCashAndResources(),
				cash = resources.Cash,
				harvesters
			};
		}

		/// <summary>
		/// Serialize visible enemy information. RESPECTS FOG OF WAR.
		/// </summary>
		public object SerializeEnemyIntel()
		{
			var visibleEnemies = world.Actors
				.Where(a => !a.IsDead && a.IsInWorld)
				.Where(a => a.Owner != player && !a.Owner.NonCombatant)
				.Where(a => a.CanBeViewedByPlayer(player)) // FOG OF WAR CHECK
				.Select(a => new
				{
					id = a.ActorID,
					type = a.Info.Name,
					owner = a.Owner.ResolvedPlayerName,
					position = new[] { a.Location.X, a.Location.Y },
					health_percent = a.TraitOrDefault<Health>() != null
						? (int)((double)a.Trait<Health>().HP / a.Trait<Health>().MaxHP * 100)
						: 100,
					is_building = a.Info.HasTraitInfo<BuildingInfo>()
				})
				.ToArray();

			// Also include frozen actor info (last known positions in fog)
			var frozenActors = new List<object>();
			if (player.FrozenActorLayer != null)
			{
				foreach (var frozen in player.FrozenActorLayer.FrozenActorsForPlayer(player))
				{
					if (!frozen.IsValid || frozen.Actor?.IsDead == true)
						continue;

					frozenActors.Add(new
					{
						id = frozen.ID,
						type = frozen.Info.Name,
						owner = frozen.Owner?.ResolvedPlayerName,
						position = new[] { frozen.Location.X, frozen.Location.Y },
						is_frozen = true,
						is_building = frozen.Info.HasTraitInfo<BuildingInfo>()
					});
				}
			}

			return new
			{
				visible = visibleEnemies,
				frozen = frozenActors.ToArray()
			};
		}

		/// <summary>
		/// Serialize available build options based on current tech tree state.
		/// </summary>
		public object SerializeBuildOptions(JsonElement? filterParams)
		{
			var buildable = new List<object>();

			foreach (var queue in player.PlayerActor.TraitsImplementing<ProductionQueue>().Where(q => q.Enabled))
			{
				foreach (var item in queue.BuildableItems())
				{
					var bi = item.TraitInfoOrDefault<BuildableInfo>();
					var vi = item.TraitInfoOrDefault<ValuedInfo>();
					buildable.Add(new
					{
						type = item.Name,
						queue_type = queue.Info.Type,
						cost = vi?.Cost ?? 0,
						prerequisites = bi?.Prerequisites?.ToArray() ?? Array.Empty<string>(),
						is_building = item.HasTraitInfo<BuildingInfo>()
					});
				}
			}

			return new { options = buildable.ToArray() };
		}

		/// <summary>
		/// Serialize current production queue state.
		/// </summary>
		public object SerializeProductionQueues()
		{
			var queues = player.PlayerActor.TraitsImplementing<ProductionQueue>()
				.Where(q => q.Enabled)
				.Select(q => new
				{
					type = q.Info.Type,
					items = q.AllQueued().Select(item => new
					{
						type = item.Item,
						progress_percent = item.TotalCost > 0
							? (int)((1.0 - (double)item.RemainingCost / item.TotalCost) * 100)
							: 0,
						paused = item.Paused,
						cost = item.TotalCost,
						remaining_cost = item.RemainingCost
					}).ToArray()
				})
				.ToArray();

			return new { queues };
		}
	}
}
