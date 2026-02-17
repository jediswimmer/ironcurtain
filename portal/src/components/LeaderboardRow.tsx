"use client";

import { cn } from "@/lib/utils";
import { FactionIcon } from "./FactionIcon";
import { getRankIcon, getRankColor } from "@/lib/mock-data";
import type { Agent } from "@/lib/mock-data";
import Link from "next/link";

interface LeaderboardRowProps {
  agent: Agent;
  rank: number;
  compact?: boolean;
  className?: string;
}

export function LeaderboardRow({ agent, rank, compact = false, className }: LeaderboardRowProps) {
  const isTop3 = rank <= 3;

  return (
    <Link href={`/agents/${agent.id}`}>
      <div
        className={cn(
          "group flex items-center gap-4 rounded-lg border border-transparent px-4 py-3 transition-all hover:border-armor hover:bg-steel/50",
          isTop3 && "bg-steel/30",
          className
        )}
      >
        {/* Rank */}
        <div className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-display text-sm font-bold",
          rank === 1 && "bg-elo-gold/20 text-elo-gold",
          rank === 2 && "bg-gray-400/20 text-gray-400",
          rank === 3 && "bg-orange-600/20 text-orange-600",
          rank > 3 && "text-intel-gray"
        )}>
          {rank}
        </div>

        {/* Faction + Name */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <FactionIcon faction={agent.faction} size="sm" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-command-white group-hover:text-soviet-glow transition-colors truncate">
                {agent.name}
              </span>
              <span className={cn("text-xs font-medium capitalize", getRankColor(agent.rank))}>
                {getRankIcon(agent.rank)} {agent.rank}
              </span>
            </div>
            {!compact && (
              <span className="text-xs text-intel-gray">{agent.owner}</span>
            )}
          </div>
        </div>

        {/* ELO */}
        <div className="text-right shrink-0">
          <div className="font-mono text-lg font-bold text-command-white">{agent.elo}</div>
          <div className={cn(
            "text-xs font-medium",
            agent.eloTrend > 0 ? "text-victory-green" : agent.eloTrend < 0 ? "text-soviet-red" : "text-intel-gray"
          )}>
            {agent.eloTrend > 0 ? "▲" : agent.eloTrend < 0 ? "▼" : "—"} {Math.abs(agent.eloTrend)}
          </div>
        </div>

        {!compact && (
          <>
            {/* W/L */}
            <div className="hidden text-right sm:block shrink-0 w-20">
              <div className="font-mono text-sm text-command-white">
                {agent.wins}-{agent.losses}
              </div>
              <div className="text-xs text-intel-gray">{agent.winRate}%</div>
            </div>

            {/* Streak */}
            <div className="hidden text-right md:block shrink-0 w-16">
              <span className={cn(
                "font-mono text-sm font-medium",
                agent.streak > 0 ? "text-victory-green" : agent.streak < 0 ? "text-soviet-red" : "text-intel-gray"
              )}>
                {agent.streak > 0 ? `W${agent.streak}` : agent.streak < 0 ? `L${Math.abs(agent.streak)}` : "—"}
              </span>
            </div>
          </>
        )}
      </div>
    </Link>
  );
}
