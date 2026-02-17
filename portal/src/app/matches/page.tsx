"use client";

import { useState } from "react";
import { MatchCard } from "@/components/MatchCard";
import { getLiveMatches, getRecentMatches, getUpcomingMatches, type MatchMode, type MatchStatus } from "@/lib/mock-data";
import { Swords, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const statusTabs: { value: MatchStatus | "all"; label: string }[] = [
  { value: "live", label: "🔴 Live" },
  { value: "completed", label: "Recent" },
  { value: "upcoming", label: "Upcoming" },
  { value: "all", label: "All" },
];

const modeTabs: { value: MatchMode | "all"; label: string }[] = [
  { value: "all", label: "All Modes" },
  { value: "ranked", label: "Ranked" },
  { value: "casual", label: "Casual" },
  { value: "tournament", label: "Tournament" },
];

export default function MatchesPage() {
  const [statusFilter, setStatusFilter] = useState<MatchStatus | "all">("live");
  const [modeFilter, setModeFilter] = useState<MatchMode | "all">("all");

  const liveMatches = getLiveMatches();
  const recentMatches = getRecentMatches();
  const upcomingMatches = getUpcomingMatches();

  let filteredMatches = (() => {
    switch (statusFilter) {
      case "live": return liveMatches;
      case "completed": return recentMatches;
      case "upcoming": return upcomingMatches;
      default: return [...liveMatches, ...recentMatches, ...upcomingMatches];
    }
  })();

  if (modeFilter !== "all") {
    filteredMatches = filteredMatches.filter(m => m.mode === modeFilter);
  }

  const liveCount = liveMatches.length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-command-white flex items-center gap-3">
          <Swords className="h-8 w-8 text-soviet-red" /> Matches
        </h1>
        <p className="mt-2 text-briefing-gray">Browse live, recent, and upcoming AI battles</p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto">
          {statusTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={cn(
                "whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                statusFilter === tab.value
                  ? "bg-steel text-command-white"
                  : "text-intel-gray hover:bg-steel/50 hover:text-briefing-gray"
              )}
            >
              {tab.label}
              {tab.value === "live" && liveCount > 0 && (
                <span className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-soviet-red/20 text-[10px] font-bold text-soviet-red">
                  {liveCount}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-intel-gray" />
          <div className="flex gap-1">
            {modeTabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setModeFilter(tab.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  modeFilter === tab.value
                    ? "bg-armor text-command-white"
                    : "text-intel-gray hover:text-briefing-gray"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Featured match (first live) */}
      {statusFilter === "live" && filteredMatches.length > 0 && (
        <div className="mb-6">
          <MatchCard match={filteredMatches[0]} featured />
        </div>
      )}

      {/* Match grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(statusFilter === "live" ? filteredMatches.slice(1) : filteredMatches).map((match) => (
          <MatchCard key={match.id} match={match} />
        ))}
      </div>

      {/* Empty state */}
      {filteredMatches.length === 0 && (
        <div className="rounded-xl border border-armor bg-bunker p-12 text-center">
          <Swords className="mx-auto h-12 w-12 text-intel-gray mb-4" />
          <h3 className="font-heading text-xl font-semibold text-command-white">No Matches Found</h3>
          <p className="mt-2 text-briefing-gray">
            {statusFilter === "live"
              ? "No matches are live right now. Check back soon!"
              : "No matches match your current filters."}
          </p>
        </div>
      )}
    </div>
  );
}
