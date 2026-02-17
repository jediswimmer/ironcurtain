"use client";

import { cn } from "@/lib/utils";
import { LiveIndicator } from "./LiveIndicator";
import { FactionIcon } from "./FactionIcon";
import { Eye, Clock, Trophy } from "lucide-react";
import type { Match } from "@/lib/mock-data";
import Link from "next/link";

interface MatchCardProps {
  match: Match;
  featured?: boolean;
  className?: string;
}

export function MatchCard({ match, featured = false, className }: MatchCardProps) {
  const isLive = match.status === "live";
  const isCompleted = match.status === "completed";
  const p1 = match.players[0];
  const p2 = match.players[1];

  return (
    <Link href={`/matches/${match.id}`}>
      <div
        className={cn(
          "group rounded-xl border bg-bunker transition-all duration-200",
          isLive ? "border-soviet-red/40 hover:border-soviet-red/60 animate-glow-pulse" : "border-armor hover:border-gunmetal",
          featured && "col-span-full",
          className
        )}
      >
        {/* Thumbnail area */}
        <div className={cn(
          "relative overflow-hidden rounded-t-xl bg-steel",
          featured ? "aspect-video" : "aspect-video"
        )}>
          {/* Placeholder grid pattern */}
          <div className="absolute inset-0 bg-grid-pattern opacity-30" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="flex items-center justify-center gap-4">
                <div className="flex flex-col items-center">
                  <FactionIcon faction={p1.faction} size={featured ? "lg" : "md"} />
                  <span className={cn("mt-1 font-heading font-semibold text-command-white", featured ? "text-lg" : "text-sm")}>
                    {p1.agent.name}
                  </span>
                  <span className="font-mono text-xs text-briefing-gray">{p1.agent.elo}</span>
                </div>
                <span className={cn("font-heading font-bold text-gunmetal", featured ? "text-3xl" : "text-xl")}>VS</span>
                <div className="flex flex-col items-center">
                  <FactionIcon faction={p2.faction} size={featured ? "lg" : "md"} />
                  <span className={cn("mt-1 font-heading font-semibold text-command-white", featured ? "text-lg" : "text-sm")}>
                    {p2.agent.name}
                  </span>
                  <span className="font-mono text-xs text-briefing-gray">{p2.agent.elo}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Status badge */}
          <div className="absolute left-3 top-3">
            {isLive && <LiveIndicator size="sm" />}
            {isCompleted && (
              <span className="inline-flex items-center gap-1 rounded bg-gunmetal/80 px-2 py-0.5 text-[10px] font-semibold uppercase text-briefing-gray">
                Completed
              </span>
            )}
          </div>

          {/* Mode badge */}
          {match.mode === "tournament" && (
            <div className="absolute right-3 top-3">
              <span className="inline-flex items-center gap-1 rounded bg-elo-gold/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-elo-gold">
                <Trophy className="h-3 w-3" /> Tournament
              </span>
            </div>
          )}
        </div>

        {/* Info area */}
        <div className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm text-briefing-gray">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {match.duration}
              </span>
              {isLive && (
                <span className="flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5" /> {match.viewers}
                </span>
              )}
            </div>
            <span className="text-xs text-intel-gray capitalize">{match.mode} · {match.map}</span>
          </div>

          {isCompleted && match.winner && (
            <div className="mt-2 flex items-center gap-1.5 text-sm">
              <Trophy className="h-3.5 w-3.5 text-elo-gold" />
              <span className="font-semibold text-elo-gold">
                {match.players.find(p => p.agent.id === match.winner)?.agent.name} wins
              </span>
            </div>
          )}

          {featured && match.commentary.length > 0 && (
            <div className="mt-3 rounded-lg bg-steel/50 p-2.5">
              <p className="text-sm italic text-briefing-gray">
                &ldquo;{match.commentary[0].text}&rdquo;
              </p>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
