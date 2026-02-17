/**
 * Leaderboard — ELO rating calculation and rankings.
 */

export interface AgentRating {
  agent_id: string;
  agent_name: string;
  elo: number;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  peak_elo: number;
  current_streak: number;
  ratings_by_mode: Record<string, number>;
  registered_at: string;
  last_active: string;
}

export class Leaderboard {
  // In production, this is backed by PostgreSQL
  private ratings: Map<string, AgentRating> = new Map();
  
  getOrCreate(agentId: string, agentName: string): AgentRating {
    if (!this.ratings.has(agentId)) {
      this.ratings.set(agentId, {
        agent_id: agentId,
        agent_name: agentName,
        elo: 1200,
        games_played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        peak_elo: 1200,
        current_streak: 0,
        ratings_by_mode: {},
        registered_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
      });
    }
    return this.ratings.get(agentId)!;
  }
  
  /**
   * Update ratings after a match result.
   */
  recordResult(
    winnerId: string,
    loserId: string,
    mode: string,
    isDraw: boolean = false
  ): { winner_elo_change: number; loser_elo_change: number } {
    const winner = this.ratings.get(winnerId);
    const loser = this.ratings.get(loserId);
    if (!winner || !loser) throw new Error("Unknown agent");
    
    const kWinner = this.getKFactor(winner.games_played);
    const kLoser = this.getKFactor(loser.games_played);
    
    const expectedWin = 1 / (1 + Math.pow(10, (loser.elo - winner.elo) / 400));
    const expectedLose = 1 - expectedWin;
    
    let winnerScore: number;
    let loserScore: number;
    
    if (isDraw) {
      winnerScore = 0.5;
      loserScore = 0.5;
      winner.draws++;
      loser.draws++;
    } else {
      winnerScore = 1;
      loserScore = 0;
      winner.wins++;
      loser.losses++;
      winner.current_streak = winner.current_streak > 0 ? winner.current_streak + 1 : 1;
      loser.current_streak = loser.current_streak < 0 ? loser.current_streak - 1 : -1;
    }
    
    const winnerChange = Math.round(kWinner * (winnerScore - expectedWin));
    const loserChange = Math.round(kLoser * (loserScore - expectedLose));
    
    winner.elo += winnerChange;
    loser.elo += loserChange;
    winner.games_played++;
    loser.games_played++;
    
    if (winner.elo > winner.peak_elo) winner.peak_elo = winner.elo;
    if (loser.elo > loser.peak_elo) loser.peak_elo = loser.elo;
    
    winner.last_active = new Date().toISOString();
    loser.last_active = new Date().toISOString();
    
    // Update per-mode ratings
    winner.ratings_by_mode[mode] = (winner.ratings_by_mode[mode] ?? 1200) + winnerChange;
    loser.ratings_by_mode[mode] = (loser.ratings_by_mode[mode] ?? 1200) + loserChange;
    
    return {
      winner_elo_change: winnerChange,
      loser_elo_change: loserChange,
    };
  }
  
  /**
   * Get global leaderboard sorted by ELO.
   */
  getLeaderboard(mode?: string, limit: number = 50): AgentRating[] {
    const agents = Array.from(this.ratings.values());
    
    if (mode) {
      agents.sort((a, b) => 
        (b.ratings_by_mode[mode] ?? 1200) - (a.ratings_by_mode[mode] ?? 1200)
      );
    } else {
      agents.sort((a, b) => b.elo - a.elo);
    }
    
    return agents.slice(0, limit);
  }
  
  getTier(elo: number): string {
    if (elo >= 2400) return "Grandmaster";
    if (elo >= 2200) return "Master";
    if (elo >= 2000) return "Diamond";
    if (elo >= 1800) return "Platinum";
    if (elo >= 1600) return "Gold";
    if (elo >= 1400) return "Silver";
    if (elo >= 1200) return "Bronze";
    return "Unranked";
  }
  
  private getKFactor(gamesPlayed: number): number {
    if (gamesPlayed < 10) return 40;    // Placement — big swings
    if (gamesPlayed < 30) return 32;    // Calibrating
    return 20;                           // Settled
  }
}
