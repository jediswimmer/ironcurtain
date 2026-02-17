/**
 * Matchmaker — ELO-based agent pairing system.
 * 
 * Runs on a tick (every 5 seconds), scans the queue, and pairs agents
 * with similar ratings. ELO range widens over time so nobody waits forever.
 */

import { WebSocket } from "ws";

export interface QueueEntry {
  agent_id: string;
  agent_name: string;
  mode: string;
  faction_preference: "allies" | "soviet" | "random";
  elo: number;
  elo_range: number;
  joined_at: number;
  ws?: WebSocket;
}

export interface MatchPairing {
  mode: string;
  players: Array<{
    agent_id: string;
    agent_name: string;
    faction: "allies" | "soviet";
    elo: number;
  }>;
}

export class Matchmaker {
  private queues: Map<string, QueueEntry[]> = new Map();
  private queueConnections: Map<string, WebSocket> = new Map();
  
  addToQueue(entry: QueueEntry): void {
    const queue = this.queues.get(entry.mode) ?? [];
    
    // Don't allow duplicate entries
    if (queue.some(e => e.agent_id === entry.agent_id)) {
      throw new Error("Agent already in queue");
    }
    
    queue.push(entry);
    this.queues.set(entry.mode, queue);
    
    console.log(`📋 ${entry.agent_name} (${entry.elo}) joined ${entry.mode} queue`);
  }
  
  removeFromQueue(agentId: string): void {
    for (const [mode, queue] of this.queues) {
      this.queues.set(mode, queue.filter(e => e.agent_id !== agentId));
    }
  }
  
  getQueueStatus(agentId: string): { in_queue: boolean; position?: number; mode?: string } {
    for (const [mode, queue] of this.queues) {
      const idx = queue.findIndex(e => e.agent_id === agentId);
      if (idx >= 0) {
        return { in_queue: true, position: idx + 1, mode };
      }
    }
    return { in_queue: false };
  }
  
  handleQueueConnection(ws: WebSocket): void {
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.agent_id) {
          this.queueConnections.set(msg.agent_id, ws);
        }
      } catch {}
    });
  }
  
  async tick(): Promise<MatchPairing[]> {
    const pairings: MatchPairing[] = [];
    
    for (const [mode, entries] of this.queues) {
      if (entries.length < 2) continue;
      
      // Widen ELO range over time (10 points per 30 seconds)
      const now = Date.now();
      for (const entry of entries) {
        const waitSeconds = (now - entry.joined_at) / 1000;
        entry.elo_range = Math.min(500, 50 + Math.floor(waitSeconds / 30) * 10);
      }
      
      // Sort by wait time (longest first)
      entries.sort((a, b) => a.joined_at - b.joined_at);
      
      const matched = new Set<string>();
      
      for (let i = 0; i < entries.length; i++) {
        if (matched.has(entries[i].agent_id)) continue;
        
        for (let j = i + 1; j < entries.length; j++) {
          if (matched.has(entries[j].agent_id)) continue;
          
          const eloDiff = Math.abs(entries[i].elo - entries[j].elo);
          const maxRange = Math.max(entries[i].elo_range, entries[j].elo_range);
          
          if (eloDiff <= maxRange) {
            // MATCH FOUND
            const factions = this.assignFactions(entries[i], entries[j]);
            
            pairings.push({
              mode,
              players: [
                {
                  agent_id: entries[i].agent_id,
                  agent_name: entries[i].agent_name,
                  faction: factions[0],
                  elo: entries[i].elo,
                },
                {
                  agent_id: entries[j].agent_id,
                  agent_name: entries[j].agent_name,
                  faction: factions[1],
                  elo: entries[j].elo,
                },
              ],
            });
            
            matched.add(entries[i].agent_id);
            matched.add(entries[j].agent_id);
            
            console.log(`⚔️  MATCH: ${entries[i].agent_name} (${entries[i].elo}) vs ${entries[j].agent_name} (${entries[j].elo})`);
            
            // Notify agents via WebSocket
            this.notifyAgent(entries[i].agent_id, "match_found", pairings[pairings.length - 1]);
            this.notifyAgent(entries[j].agent_id, "match_found", pairings[pairings.length - 1]);
            
            break;
          }
        }
      }
      
      // Remove matched entries from queue
      this.queues.set(mode, entries.filter(e => !matched.has(e.agent_id)));
    }
    
    return pairings;
  }
  
  private assignFactions(
    a: QueueEntry, 
    b: QueueEntry
  ): ["allies" | "soviet", "allies" | "soviet"] {
    const prefA = a.faction_preference;
    const prefB = b.faction_preference;
    
    // If both want different factions, give them what they want
    if (prefA !== "random" && prefB !== "random" && prefA !== prefB) {
      return [prefA, prefB];
    }
    
    // If one has a preference and the other is random
    if (prefA !== "random" && prefB === "random") {
      return [prefA, prefA === "allies" ? "soviet" : "allies"];
    }
    if (prefB !== "random" && prefA === "random") {
      return [prefB === "allies" ? "soviet" : "allies", prefB];
    }
    
    // Both random or both want the same — coin flip
    const coin = Math.random() > 0.5;
    return coin ? ["allies", "soviet"] : ["soviet", "allies"];
  }
  
  private notifyAgent(agentId: string, event: string, data: unknown): void {
    const ws = this.queueConnections.get(agentId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event, data }));
    }
  }
}
