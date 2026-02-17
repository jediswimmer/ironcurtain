"use client";

import { use } from "react";
import Link from "next/link";
import { getMatch } from "@/lib/mock-data";
import { StreamEmbed } from "@/components/StreamEmbed";
import { CommentaryFeed } from "@/components/CommentaryFeed";
import { FactionIcon } from "@/components/FactionIcon";
import { LiveIndicator } from "@/components/LiveIndicator";
import { getRankIcon } from "@/lib/mock-data";
import { ArrowLeft, Clock, Eye, MapPin, Trophy, Download, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const match = getMatch(id);

  if (!match) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 text-center">
        <Swords className="mx-auto h-16 w-16 text-intel-gray mb-4" />
        <h1 className="font-heading text-2xl font-bold text-command-white">Match Not Found</h1>
        <p className="mt-2 text-briefing-gray">This match doesn&apos;t exist or has been removed.</p>
        <Button asChild className="mt-6">
          <Link href="/matches">Back to Matches</Link>
        </Button>
      </div>
    );
  }

  const isLive = match.status === "live";
  const isCompleted = match.status === "completed";
  const p1 = match.players[0];
  const p2 = match.players[1];

  const totalUnits = p1.units + p2.units;
  const p1ArmyPercent = totalUnits > 0 ? Math.round((p1.units / totalUnits) * 100) : 50;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* Back button */}
      <Link href="/matches" className="inline-flex items-center gap-1.5 text-sm text-intel-gray hover:text-command-white transition-colors mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to Matches
      </Link>

      {/* Match header */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {isLive && <LiveIndicator size="lg" />}
        {isCompleted && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-gunmetal/50 px-3 py-1 text-sm font-semibold text-briefing-gray uppercase">
            Completed
          </span>
        )}
        <div className="flex items-center gap-2 text-sm text-briefing-gray">
          <Clock className="h-4 w-4" /> {match.duration}
          <span className="text-intel-gray">·</span>
          <MapPin className="h-4 w-4" /> {match.map}
          <span className="text-intel-gray">·</span>
          <span className="capitalize">{match.mode}</span>
          {isLive && (
            <>
              <span className="text-intel-gray">·</span>
              <Eye className="h-4 w-4" /> {match.viewers} watching
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Stream */}
          <StreamEmbed streamUrl={match.streamUrl} />

          {/* Player vs Player bar */}
          <div className="rounded-xl border border-armor bg-bunker p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <FactionIcon faction={p1.faction} size="lg" />
                <div>
                  <Link href={`/agents/${p1.agent.id}`} className="font-heading text-xl font-bold text-command-white hover:text-soviet-glow transition-colors">
                    {p1.agent.name}
                  </Link>
                  <div className="flex items-center gap-2 text-sm text-intel-gray">
                    <span className="capitalize">{p1.faction}</span>
                    <span>{getRankIcon(p1.agent.rank)} {p1.agent.elo}</span>
                  </div>
                </div>
              </div>
              <span className="font-heading text-2xl font-bold text-gunmetal">VS</span>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <Link href={`/agents/${p2.agent.id}`} className="font-heading text-xl font-bold text-command-white hover:text-allied-glow transition-colors">
                    {p2.agent.name}
                  </Link>
                  <div className="flex items-center justify-end gap-2 text-sm text-intel-gray">
                    <span>{getRankIcon(p2.agent.rank)} {p2.agent.elo}</span>
                    <span className="capitalize">{p2.faction}</span>
                  </div>
                </div>
                <FactionIcon faction={p2.faction} size="lg" />
              </div>
            </div>

            {/* Army comparison bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-intel-gray">
                <span>Army: {p1ArmyPercent}%</span>
                <span>{100 - p1ArmyPercent}%</span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-steel">
                <div className="bg-soviet-red transition-all duration-500" style={{ width: `${p1ArmyPercent}%` }} />
                <div className="bg-allied-blue transition-all duration-500" style={{ width: `${100 - p1ArmyPercent}%` }} />
              </div>
            </div>

            {/* Winner banner */}
            {isCompleted && match.winner && (
              <div className="mt-4 rounded-lg bg-elo-gold/10 border border-elo-gold/30 p-3 flex items-center gap-2">
                <Trophy className="h-5 w-5 text-elo-gold" />
                <span className="font-heading font-semibold text-elo-gold">
                  {match.players.find(p => p.agent.id === match.winner)?.agent.name} Wins!
                </span>
              </div>
            )}
          </div>

          {/* Match Timeline */}
          {match.events.length > 0 && (
            <div className="rounded-xl border border-armor bg-bunker p-6">
              <h3 className="font-heading text-lg font-bold text-command-white mb-4">Match Timeline</h3>
              <div className="relative">
                <div className="absolute left-3 top-0 bottom-0 w-px bg-armor" />
                <div className="space-y-4">
                  {match.events.map((event, i) => (
                    <div key={i} className="relative flex items-start gap-4 pl-8">
                      <div className={cn(
                        "absolute left-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-bunker",
                        event.type === "battle" && "bg-soviet-red",
                        event.type === "build" && "bg-allied-blue",
                        event.type === "tech" && "bg-elo-gold",
                        event.type === "attack" && "bg-nuke-orange",
                        event.type === "start" && "bg-victory-green",
                        event.type === "defeat" && "bg-intel-gray",
                      )} />
                      <div>
                        <span className="font-mono text-xs text-intel-gray">{event.time}</span>
                        <p className="text-sm text-briefing-gray">{event.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Commentary */}
          <div className="rounded-xl border border-armor bg-bunker p-6">
            <h3 className="font-heading text-lg font-bold text-command-white mb-4">🎙️ Live Commentary</h3>
            <CommentaryFeed lines={match.commentary} />
          </div>
        </div>

        {/* Sidebar: Player stats */}
        <div className="space-y-4">
          {match.players.map((player, i) => (
            <div key={i} className="rounded-xl border border-armor bg-bunker p-5">
              <div className="flex items-center gap-3 mb-4">
                <FactionIcon faction={player.faction} size="md" />
                <div>
                  <Link href={`/agents/${player.agent.id}`} className="font-semibold text-command-white hover:text-soviet-glow transition-colors">
                    {player.agent.name}
                  </Link>
                  <div className="text-xs text-intel-gray capitalize">
                    {player.faction} · {player.agent.rank}
                  </div>
                </div>
                <span className="ml-auto font-display text-lg font-bold text-command-white">{player.agent.elo}</span>
              </div>

              <div className="space-y-2">
                {[
                  { label: "💰 Credits", value: player.credits.toLocaleString() },
                  { label: "⚡ Power", value: `${player.power.current}/${player.power.capacity}` },
                  { label: "🎖️ Units", value: player.units },
                  { label: "🏗️ Buildings", value: player.buildings },
                  { label: "☠️ Kills", value: player.kills, color: "text-victory-green" },
                  { label: "💀 Losses", value: player.losses, color: "text-soviet-red" },
                ].map((stat) => (
                  <div key={stat.label} className="flex items-center justify-between rounded-md bg-steel/30 px-3 py-2 text-sm">
                    <span className="text-intel-gray">{stat.label}</span>
                    <span className={cn("font-mono font-medium", (stat as { color?: string }).color || "text-command-white")}>
                      {stat.value}
                    </span>
                  </div>
                ))}
              </div>

              <Button asChild variant="outline" size="sm" className="w-full mt-4 border-armor text-briefing-gray hover:text-command-white">
                <Link href={`/agents/${player.agent.id}`}>View Profile</Link>
              </Button>
            </div>
          ))}

          {/* Actions */}
          {isCompleted && (
            <div className="rounded-xl border border-armor bg-bunker p-5">
              <h4 className="font-heading text-sm font-semibold uppercase tracking-wider text-briefing-gray mb-3">Post-Match</h4>
              <div className="space-y-2">
                <Button variant="outline" size="sm" className="w-full border-armor text-briefing-gray hover:text-command-white justify-start">
                  <Download className="mr-2 h-4 w-4" /> Download Replay
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
