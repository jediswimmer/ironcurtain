// IPC Server for ExternalBot — handles Unix socket / TCP communication
// with the MCP server process.
//
// Protocol: Newline-delimited JSON over Unix socket or TCP.
// Each message is a single line of JSON followed by \n.

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
	public sealed class IpcServer : IDisposable
	{
		readonly string socketPath;
		readonly int tcpPort;
		readonly ConcurrentBag<StreamWriter> clients = new();
		readonly JsonSerializerOptions jsonOptions = new()
		{
			PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
			WriteIndented = false
		};

		Socket listener;
		Thread acceptThread;
		bool running;

		public event Action<IpcMessage> OnMessage;
		public bool HasClients => !clients.IsEmpty;

		public IpcServer(string socketPath, int tcpPort)
		{
			this.socketPath = socketPath;
			this.tcpPort = tcpPort;
		}

		public void Start()
		{
			running = true;

			// Try Unix socket first, fall back to TCP
			try
			{
				if (File.Exists(socketPath))
					File.Delete(socketPath);

				listener = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
				listener.Bind(new UnixDomainSocketEndPoint(socketPath));
				listener.Listen(5);
				Log.Write("mcp", $"IPC: Listening on Unix socket {socketPath}");
			}
			catch
			{
				listener = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
				listener.Bind(new IPEndPoint(IPAddress.Loopback, tcpPort));
				listener.Listen(5);
				Log.Write("mcp", $"IPC: Listening on TCP port {tcpPort}");
			}

			acceptThread = new Thread(AcceptLoop) { IsBackground = true, Name = "MCP-IPC-Accept" };
			acceptThread.Start();
		}

		void AcceptLoop()
		{
			while (running)
			{
				try
				{
					var clientSocket = listener.Accept();
					var thread = new Thread(() => HandleClient(clientSocket))
					{
						IsBackground = true,
						Name = $"MCP-IPC-Client-{clientSocket.GetHashCode()}"
					};
					thread.Start();
				}
				catch (SocketException) when (!running)
				{
					break;
				}
			}
		}

		void HandleClient(Socket clientSocket)
		{
			using var stream = new NetworkStream(clientSocket, true);
			using var reader = new StreamReader(stream, Encoding.UTF8);
			var writer = new StreamWriter(stream, Encoding.UTF8) { AutoFlush = true };
			clients.Add(writer);

			Log.Write("mcp", "IPC: Client connected");

			try
			{
				while (running && clientSocket.Connected)
				{
					var line = reader.ReadLine();
					if (line == null)
						break;

					try
					{
						var msg = JsonSerializer.Deserialize<IpcMessage>(line, jsonOptions);
						if (msg != null)
							OnMessage?.Invoke(msg);
					}
					catch (JsonException ex)
					{
						Log.Write("mcp", $"IPC: Invalid JSON: {ex.Message}");
					}
				}
			}
			catch (IOException)
			{
				// Client disconnected
			}

			Log.Write("mcp", "IPC: Client disconnected");
		}

		public void SendResponse(int id, object result)
		{
			var response = new IpcResponse { Id = id, Result = result };
			var json = JsonSerializer.Serialize(response, jsonOptions);
			BroadcastLine(json);
		}

		public void BroadcastEvent(string eventType, object data)
		{
			var evt = new IpcEvent { EventType = eventType, Data = data };
			var json = JsonSerializer.Serialize(evt, jsonOptions);
			BroadcastLine(json);
		}

		void BroadcastLine(string json)
		{
			foreach (var writer in clients)
			{
				try
				{
					writer.WriteLine(json);
				}
				catch
				{
					// Client disconnected, will be cleaned up
				}
			}
		}

		public void Dispose()
		{
			running = false;
			listener?.Close();
			listener?.Dispose();

			if (File.Exists(socketPath))
				File.Delete(socketPath);
		}
	}
}
