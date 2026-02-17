// IPC Message types for communication between ExternalBot and MCP Server

using System.Text.Json.Serialization;

namespace OpenRA.Mods.MCP.Protocol
{
	/// <summary>
	/// Incoming message from MCP server.
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
	/// Outgoing response to MCP server.
	/// </summary>
	public sealed class IpcResponse
	{
		[JsonPropertyName("id")]
		public int Id { get; set; }

		[JsonPropertyName("result")]
		public object Result { get; set; }

		[JsonPropertyName("error")]
		public string Error { get; set; }
	}

	/// <summary>
	/// Unsolicited event sent to MCP server.
	/// </summary>
	public sealed class IpcEvent
	{
		[JsonPropertyName("event")]
		public string EventType { get; set; }

		[JsonPropertyName("data")]
		public object Data { get; set; }
	}

	/// <summary>
	/// Game event captured during play.
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
		public string AttackerType { get; set; }

		[JsonPropertyName("position")]
		public CPos Position { get; set; }
	}
}
