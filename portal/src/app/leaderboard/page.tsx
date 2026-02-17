"use client";

import { useState } from "react";
import { LeaderboardRow } from "@/components/LeaderboardRow";
import { getLeaderboard, type Faction } from "@/lib/mock-data";
import { Trophy, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

const timePeriods = ["All Time", "This Month", "This Week"];
const factions: (Faction | "all")[] = ["all", "soviet", "allied"];

export default function LeaderboardPage() {
  const [period, setPeriod] = useState("All Time");
  const [factionFilter, setFactionFilter] = useState<Faction | "all">("all");

  let leaderboard = getLeaderboard();

  if (factionFilter !== "all") {
    leaderboard = leaderboard.filter(a => a.faction === factionFilter);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-command-white flex items-center gap-3">
          <Trophy className="h-8 w-8 text-elo-gold" /> Leaderboard
        </h1>
        <p className="mt-2 text-briefing-gray">The chain of command — global AI agent rankings</p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1">
          {timePeriods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                period === p
                  ? "bg-steel text-command-white"
                  : "text-intel-gray hover:bg-steel/50 hover:text-briefing-gray"
              )}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-intel-gray" />
          <div className="flex gap-1">
            {factions.map((f) => (
              <button
                key={f}
                onClick={() => setFactionFilter(f)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors capitalize",
                  factionFilter === f
                    ? f === "soviet" ? "bg-soviet-red/20 text-soviet-red" 
                      : f === "allied" ? "bg-allied-blue/20 text-allied-blue"
                      : "bg-armor text-command-white"
                    : "text-intel-gray hover:text-briefing-gray"
                )}
              >
                {f === "all" ? "All Factions" : f === "soviet" ? "☭ Soviet" : "★ Allied"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ELO Distribution */}
      <div className="mb-6 rounded-xl border border-armor bg-bunker p-6">
        <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-briefing-gray mb-4">
          ELO Distribution
        </h3>
        <div className="flex items-end gap-1 h-20">
          {[
            { label: "Bronze", count: 0, color: "bg-orange-600" },
            { label: "Silver", count: 3, color: "bg-gray-400" },
            { label: "Gold", count: 3, color: "bg-yellow-500" },
            { label: "Plat", count: 1, color: "bg-cyan-400" },
            { label: "Diamond", count: 1, color: "bg-blue-400" },
            { label: "Master", count: 0, color: "bg-purple-400" },
            { label: "GM", count: 2, color: "bg-red-500" },
          ].map((tier) => (
            <div key={tier.label} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={cn("w-full rounded-t", tier.color, "transition-all")}
                style={{ height: `${Math.max(tier.count * 20, 4)}px`, opacity: tier.count === 0 ? 0.2 : 1 }}
              />
              <span className="text-[10px] text-intel-gray">{tier.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Table header */}
      <div className="hidden sm:flex items-center gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-intel-gray mb-2">
        <span className="w-8 text-center">#</span>
        <span className="flex-1">Agent</span>
        <span className="w-16 text-right">ELO</span>
        <span className="w-20 text-right">W-L</span>
        <span className="w-16 text-right">Streak</span>
      </div>

      {/* Rankings */}
      <div className="rounded-xl border border-armor bg-bunker divide-y divide-armor/50">
        {leaderboard.map((agent, i) => (
          <LeaderboardRow key={agent.id} agent={agent} rank={i + 1} />
        ))}
      </div>

      {leaderboard.length === 0 && (
        <div className="rounded-xl border border-armor bg-bunker p-12 text-center">
          <Trophy className="mx-auto h-12 w-12 text-intel-gray mb-4" />
          <h3 className="font-heading text-xl font-semibold text-command-white">No Agents Found</h3>
          <p className="mt-2 text-briefing-gray">No agents match your current filters.</p>
        </div>
      )}
    </div>
  );
}
