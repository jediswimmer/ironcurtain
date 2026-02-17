// IPC Message types for communication between ExternalBot and external AI agents.
//
// Protocol is newline-delimited JSON over TCP.
// Messages flow in both directions:
//   Client → Bot: IpcMessage (request/command)
//   Bot → Client: IpcResponse (response to a request) or IpcEvent (unsolicited update)

#region Copyright & License Information
/*
 * Copyright (c) IronCurtain Contributors
 * Licensed under the MIT License. See LICENSE for details.
 */
#endregion

using System.Text.Json.Serialization;

namespace OpenRA.Mods.MCP.Protocol
{
	/// <summary>
	/// Incoming message from an external AI agent.
	/// JSON format: {"id": 1, "method": "get_state", "params": {...}}
	/// </summary>
	public sealed class IpcMessage
	{
		[JsonPropertyName("id")]
		public int Id { get; set; }

		[JsonPropertyName("method")]
		public string Method { get; set; }

		[JsonPropertyName("params")]
		public System.Text.Json.JsonElement? Params { get; set; }
	}

	/// <summary>
	/// Outgoing response to an external AI agent.
	/// JSON format: {"id": 1, "result": {...}} or {"id": 1, "error": "..."}
	/// </summary>
	public sealed class IpcResponse
	{
		[JsonPropertyName("id")]
		public int Id { get; set; }

		[JsonPropertyName("result")]
		public object Result { get; set; }

		[JsonPropertyName("error")]
		[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
		public string Error { get; set; }
	}

	/// <summary>
	/// Unsolicited event sent to all connected clients.
	/// JSON format: {"event": "state_update", "data": {...}}
	/// </summary>
	public sealed class IpcEvent
	{
		[JsonPropertyName("event")]
		public string EventType { get; set; }

		[JsonPropertyName("data")]
		public object Data { get; set; }
	}

	/// <summary>
	/// A game event captured during play (damage, unit lost, etc.).
	/// Accumulated between state snapshots and sent as part of state_update events.
	/// </summary>
	public sealed class GameEvent
	{
		[JsonPropertyName("type")]
		public string Type { get; set; }

		[JsonPropertyName("actor_id")]
		public uint ActorId { get; set; }

		[JsonPropertyName("actor_type")]
		public string ActorType { get; set; }

		[JsonPropertyName("attacker_type")]
		[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
		public string AttackerType { get; set; }

		[JsonPropertyName("position_x")]
		public int PositionX { get; set; }

		[JsonPropertyName("position_y")]
		public int PositionY { get; set; }

		[JsonPropertyName("damage")]
		public int Damage { get; set; }

		[JsonPropertyName("tick")]
		public int Tick { get; set; }
	}
}
