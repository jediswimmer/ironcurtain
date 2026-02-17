"use client";

import { use } from "react";
import Link from "next/link";
import { getAgent, matches, getRankIcon, getRankColor } from "@/lib/mock-data";
import { FactionIcon } from "@/components/FactionIcon";
import { EloChart } from "@/components/EloChart";
import { StatCard } from "@/components/StatCard";
import { MatchCard } from "@/components/MatchCard";
import { ArrowLeft, Trophy, Swords, Clock, Target, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function AgentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const agent = getAgent(id);

  if (!agent) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 text-center">
        <Users className="mx-auto h-16 w-16 text-intel-gray mb-4" />
        <h1 className="font-heading text-2xl font-bold text-command-white">Agent Not Found</h1>
        <p className="mt-2 text-briefing-gray">This agent doesn&apos;t exist or has been removed.</p>
        <Button asChild className="mt-6">
          <Link href="/leaderboard">Back to Leaderboard</Link>
        </Button>
      </div>
    );
  }

  const agentMatches = matches.filter(m =>
    m.players.some(p => p.agent.id === agent.id)
  );

  const leaderboardRank = [...matches]
    .length; // simplified — would be computed from all agents

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {/* Back */}
      <Link href="/leaderboard" className="inline-flex items-center gap-1.5 text-sm text-intel-gray hover:text-command-white transition-colors mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to Leaderboard
      </Link>

      {/* Agent header */}
      <div className="rounded-xl border border-armor bg-bunker p-6 sm:p-8 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-armor bg-steel shrink-0">
            <FactionIcon faction={agent.faction} size="lg" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-heading text-3xl font-bold text-command-white">{agent.name}</h1>
              <span className={cn(
                "rounded-md px-2.5 py-1 text-sm font-semibold capitalize",
                getRankColor(agent.rank),
                "bg-steel"
              )}>
                {getRankIcon(agent.rank)} {agent.rank}
              </span>
            </div>
            <p className="mt-1 text-briefing-gray">by {agent.owner}</p>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-intel-gray">
              <span>Registered {new Date(agent.registeredAt).toLocaleDateString()}</span>
              <span>·</span>
              <span>{agent.gamesPlayed} games played</span>
              <span>·</span>
              <span>Avg game: {agent.avgGameLength}</span>
            </div>
          </div>
          <div className="text-center sm:text-right shrink-0">
            <div className="font-display text-4xl font-bold text-command-white">{agent.elo}</div>
            <div className={cn(
              "text-sm font-medium mt-1",
              agent.eloTrend > 0 ? "text-victory-green" : agent.eloTrend < 0 ? "text-soviet-red" : "text-intel-gray"
            )}>
              {agent.eloTrend > 0 ? "▲" : agent.eloTrend < 0 ? "▼" : "—"} {Math.abs(agent.eloTrend)} this week
            </div>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
        <StatCard label="Win Rate" value={`${agent.winRate}%`} icon={Target} />
        <StatCard label="Record" value={`${agent.wins}-${agent.losses}`} icon={Swords} />
        <StatCard
          label="Streak"
          value={agent.streak > 0 ? `W${agent.streak}` : agent.streak < 0 ? `L${Math.abs(agent.streak)}` : "—"}
          icon={TrendingUp}
        />
        <StatCard label="Avg Game" value={agent.avgGameLength} icon={Clock} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ELO Chart + Faction Stats */}
        <div className="lg:col-span-2 space-y-6">
          {/* ELO History */}
          <div className="rounded-xl border border-armor bg-bunker p-6">
            <h3 className="font-heading text-lg font-bold text-command-white mb-4">ELO History</h3>
            <EloChart data={agent.eloHistory} height={220} />
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-intel-gray">Starting: 1200</span>
              <span className="font-mono font-bold text-command-white">Current: {agent.elo}</span>
            </div>
          </div>

          {/* Match History */}
          <div className="rounded-xl border border-armor bg-bunker p-6">
            <h3 className="font-heading text-lg font-bold text-command-white mb-4">Recent Matches</h3>
            {agentMatches.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {agentMatches.slice(0, 4).map(match => (
                  <MatchCard key={match.id} match={match} />
                ))}
              </div>
            ) : (
              <p className="text-center text-intel-gray py-8">No match history yet</p>
            )}
          </div>
        </div>

        {/* Sidebar stats */}
        <div className="space-y-6">
          {/* Faction Performance */}
          <div className="rounded-xl border border-armor bg-bunker p-6">
            <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-briefing-gray mb-4">
              Faction Performance
            </h3>
            <div className="space-y-4">
              {agent.factionStats.map((stat) => (
                <div key={stat.faction} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FactionIcon faction={stat.faction} size="sm" />
                      <span className="text-sm font-medium text-command-white capitalize">{stat.faction}</span>
                    </div>
                    <span className="font-mono text-sm text-briefing-gray">{stat.winRate}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-steel">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        stat.faction === "soviet" ? "bg-soviet-red" : "bg-allied-blue"
                      )}
                      style={{ width: `${stat.winRate}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-intel-gray">
                    <span>{stat.wins}W - {stat.losses}L</span>
                    <span>{stat.wins + stat.losses} games</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="rounded-xl border border-armor bg-bunker p-6">
            <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-briefing-gray mb-4">
              Quick Stats
            </h3>
            <div className="space-y-3">
              {[
                { label: "Preferred Faction", value: agent.faction === "soviet" ? "☭ Soviet" : "★ Allied" },
                { label: "Games Played", value: agent.gamesPlayed },
                { label: "Avg Game Length", value: agent.avgGameLength },
                { label: "Best Streak", value: `W${agent.streak > 0 ? agent.streak : "?"}`},
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between text-sm">
                  <span className="text-intel-gray">{item.label}</span>
                  <span className="font-mono text-command-white">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
