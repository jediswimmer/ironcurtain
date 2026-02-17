// TCP IPC Server for ExternalBot — handles communication with external AI agents.
//
// Protocol: Newline-delimited JSON over TCP.
// Each message is a single line of JSON followed by \n.
//
// The server tracks individual clients and routes responses to the correct sender.

#region Copyright & License Information
/*
 * Copyright (c) IronCurtain Contributors
 * Licensed under the MIT License. See LICENSE for details.
 */
#endregion

using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using OpenRA.Mods.MCP.Protocol;

namespace OpenRA.Mods.MCP
{
	/// <summary>
	/// Wrapper that pairs a client ID with an incoming IPC message.
	/// </summary>
	public sealed class IpcClientMessage
	{
		public string ClientId;
		public IpcMessage Message;
	}

	public sealed class IpcServer : IDisposable
	{
		readonly int tcpPort;

		/// <summary>
		/// Connected clients indexed by unique client ID.
		/// </summary>
		readonly ConcurrentDictionary<string, StreamWriter> clients = new();

		readonly JsonSerializerOptions jsonOptions = new()
		{
			PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
			WriteIndented = false
		};

		TcpListener listener;
		Thread acceptThread;
		volatile bool running;
		int clientCounter;

		/// <summary>
		/// Fired when a client sends a message. Parameters: (clientId, message).
		/// </summary>
		public event Action<string, IpcMessage> OnMessage;

		public bool HasClients => !clients.IsEmpty;

		public IpcServer(int tcpPort)
		{
			this.tcpPort = tcpPort;
		}

		public void Start()
		{
			running = true;

			listener = new TcpListener(IPAddress.Any, tcpPort);
			listener.Start();

			Log.Write("mcp", $"IPC: TCP server listening on port {tcpPort}");

			acceptThread = new Thread(AcceptLoop)
			{
				IsBackground = true,
				Name = "MCP-IPC-Accept"
			};

			acceptThread.Start();
		}

		void AcceptLoop()
		{
			while (running)
			{
				try
				{
					var tcpClient = listener.AcceptTcpClient();
					tcpClient.NoDelay = true; // Disable Nagle for low latency

					var clientId = $"client-{Interlocked.Increment(ref clientCounter)}";
					var thread = new Thread(() => HandleClient(clientId, tcpClient))
					{
						IsBackground = true,
						Name = $"MCP-IPC-{clientId}"
					};

					thread.Start();
				}
				catch (SocketException) when (!running)
				{
					break;
				}
				catch (ObjectDisposedException) when (!running)
				{
					break;
				}
				catch (Exception ex)
				{
					if (running)
						Log.Write("mcp", $"IPC: Accept error: {ex.Message}");
				}
			}
		}

		void HandleClient(string clientId, TcpClient tcpClient)
		{
			StreamWriter writer = null;

			try
			{
				var stream = tcpClient.GetStream();
				var reader = new StreamReader(stream, Encoding.UTF8);
				writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };

				clients.TryAdd(clientId, writer);
				Log.Write("mcp", $"IPC: Client {clientId} connected from {tcpClient.Client.RemoteEndPoint}");

				// Send welcome message
				var welcome = JsonSerializer.Serialize(new IpcEvent
				{
					EventType = "connected",
					Data = new { client_id = clientId, protocol_version = 1 }
				}, jsonOptions);

				writer.WriteLine(welcome);

				while (running && tcpClient.Connected)
				{
					var line = reader.ReadLine();
					if (line == null)
						break; // Client disconnected

					if (string.IsNullOrWhiteSpace(line))
						continue; // Skip empty lines

					try
					{
						var msg = JsonSerializer.Deserialize<IpcMessage>(line, jsonOptions);
						if (msg != null)
							OnMessage?.Invoke(clientId, msg);
					}
					catch (JsonException ex)
					{
						Log.Write("mcp", $"IPC: Invalid JSON from {clientId}: {ex.Message}");

						// Send error response back
						try
						{
							var errorResponse = JsonSerializer.Serialize(new IpcResponse
							{
								Id = -1,
								Error = $"Invalid JSON: {ex.Message}"
							}, jsonOptions);

							writer.WriteLine(errorResponse);
						}
						catch
						{
							break;
						}
					}
				}
			}
			catch (IOException)
			{
				// Client disconnected
			}
			catch (Exception ex)
			{
				Log.Write("mcp", $"IPC: Error with {clientId}: {ex.Message}");
			}
			finally
			{
				clients.TryRemove(clientId, out _);
				Log.Write("mcp", $"IPC: Client {clientId} disconnected");

				try
				{
					writer?.Dispose();
					tcpClient.Dispose();
				}
				catch
				{
					// Best-effort cleanup
				}
			}
		}

		/// <summary>
		/// Send a response to a specific client.
		/// </summary>
		public void SendResponse(string clientId, int requestId, object result)
		{
			if (!clients.TryGetValue(clientId, out var writer))
				return;

			var response = new IpcResponse { Id = requestId, Result = result };
			var json = JsonSerializer.Serialize(response, jsonOptions);

			try
			{
				lock (writer)
				{
					writer.WriteLine(json);
				}
			}
			catch (Exception ex)
			{
				Log.Write("mcp", $"IPC: Failed to send response to {clientId}: {ex.Message}");
				clients.TryRemove(clientId, out _);
			}
		}

		/// <summary>
		/// Broadcast an event to all connected clients.
		/// </summary>
		public void BroadcastEvent(string eventType, object data)
		{
			var evt = new IpcEvent { EventType = eventType, Data = data };
			var json = JsonSerializer.Serialize(evt, jsonOptions);

			foreach (var kvp in clients)
			{
				try
				{
					lock (kvp.Value)
					{
						kvp.Value.WriteLine(json);
					}
				}
				catch
				{
					// Client disconnected — remove it
					clients.TryRemove(kvp.Key, out _);
				}
			}
		}

		public void Dispose()
		{
			running = false;

			try
			{
				listener?.Stop();
			}
			catch
			{
				// Best-effort
			}

			// Close all client connections
			foreach (var kvp in clients)
			{
				try
				{
					kvp.Value.Dispose();
				}
				catch
				{
					// Best-effort
				}
			}

			clients.Clear();
		}
	}
}
