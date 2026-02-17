"use client";

import { useState } from "react";
import Link from "next/link";
import { getRecentMatches, getRankIcon, type Match } from "@/lib/mock-data";
import { FactionIcon } from "@/components/FactionIcon";
import {
  Film,
  Search,
  Clock,
  MapPin,
  Trophy,
  Play,
  Download,
  Filter,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SortOption = "newest" | "oldest" | "longest" | "shortest";
type FilterMode = "all" | "ranked" | "casual" | "tournament";

export default function ReplaysPage() {
  const completedMatches = getRecentMatches();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [showFilters, setShowFilters] = useState(false);

  // Filter matches
  let filtered = completedMatches.filter((match) => {
    const query = searchQuery.toLowerCase();
    if (!query) return true;

    return (
      match.map.toLowerCase().includes(query) ||
      match.players.some((p) =>
        p.agent.name.toLowerCase().includes(query)
      ) ||
      match.id.toLowerCase().includes(query)
    );
  });

  if (filterMode !== "all") {
    filtered = filtered.filter((m) => m.mode === filterMode);
  }

  // Sort matches
  filtered.sort((a, b) => {
    switch (sortBy) {
      case "newest":
        return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
      case "oldest":
        return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
      case "longest": {
        const aDur = parseDuration(a.duration);
        const bDur = parseDuration(b.duration);
        return bDur - aDur;
      }
      case "shortest": {
        const aDur2 = parseDuration(a.duration);
        const bDur2 = parseDuration(b.duration);
        return aDur2 - bDur2;
      }
      default:
        return 0;
    }
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Film className="h-8 w-8 text-soviet-red" />
          <h1 className="font-display text-3xl font-bold tracking-tight text-command-white">
            REPLAY BROWSER
          </h1>
        </div>
        <p className="text-briefing-gray">
          Watch completed matches and study strategies. Download replays for offline analysis.
        </p>
      </div>

      {/* Search & Filters */}
      <div className="mb-6 space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-intel-gray" />
            <Input
              placeholder="Search by agent name, map, or match ID..."
              className="pl-10 bg-bunker border-armor text-command-white placeholder:text-intel-gray"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <Button
            variant="outline"
            className="border-armor text-briefing-gray hover:text-command-white"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="mr-2 h-4 w-4" />
            Filters
            <ChevronDown
              className={cn(
                "ml-2 h-4 w-4 transition-transform",
                showFilters && "rotate-180"
              )}
            />
          </Button>
        </div>

        {showFilters && (
          <div className="flex flex-wrap gap-3 rounded-lg border border-armor bg-steel/30 p-4">
            <div>
              <label className="text-xs uppercase tracking-wider text-intel-gray mb-1.5 block">
                Mode
              </label>
              <div className="flex gap-1.5">
                {(["all", "ranked", "casual", "tournament"] as FilterMode[]).map(
                  (mode) => (
                    <Button
                      key={mode}
                      variant="outline"
                      size="sm"
                      className={cn(
                        "border-armor text-xs capitalize",
                        filterMode === mode
                          ? "bg-soviet-red/10 border-soviet-red/50 text-soviet-glow"
                          : "text-briefing-gray hover:text-command-white"
                      )}
                      onClick={() => setFilterMode(mode)}
                    >
                      {mode}
                    </Button>
                  )
                )}
              </div>
            </div>

            <div>
              <label className="text-xs uppercase tracking-wider text-intel-gray mb-1.5 block">
                Sort
              </label>
              <div className="flex gap-1.5">
                {(
                  [
                    ["newest", "Newest"],
                    ["oldest", "Oldest"],
                    ["longest", "Longest"],
                    ["shortest", "Shortest"],
                  ] as [SortOption, string][]
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    variant="outline"
                    size="sm"
                    className={cn(
                      "border-armor text-xs",
                      sortBy === value
                        ? "bg-soviet-red/10 border-soviet-red/50 text-soviet-glow"
                        : "text-briefing-gray hover:text-command-white"
                    )}
                    onClick={() => setSortBy(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results count */}
      <div className="mb-4 text-sm text-intel-gray">
        {filtered.length} replay{filtered.length !== 1 ? "s" : ""} found
      </div>

      {/* Replay List */}
      <div className="space-y-3">
        {filtered.map((match) => (
          <ReplayCard key={match.id} match={match} />
        ))}

        {filtered.length === 0 && (
          <div className="rounded-xl border border-armor bg-bunker p-12 text-center">
            <Film className="mx-auto h-12 w-12 text-intel-gray mb-4" />
            <h3 className="font-heading text-lg font-semibold text-command-white">
              No replays found
            </h3>
            <p className="mt-1 text-sm text-briefing-gray">
              Try adjusting your search or filter criteria.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Replay Card ────────────────────────────────────────

function ReplayCard({ match }: { match: Match }) {
  const p1 = match.players[0];
  const p2 = match.players[1];
  const winner = match.players.find((p) => p.agent.id === match.winner);
  const matchDate = new Date(match.startedAt);

  return (
    <div className="group rounded-xl border border-armor bg-bunker hover:border-armor/80 transition-all hover:bg-steel/20">
      <div className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Players */}
          <div className="flex items-center gap-4 flex-1 min-w-0">
            {/* Player 1 */}
            <div className="flex items-center gap-2 min-w-0">
              <FactionIcon faction={p1.faction} size="sm" />
              <div className="min-w-0">
                <Link
                  href={`/agents/${p1.agent.id}`}
                  className={cn(
                    "block truncate font-semibold text-sm hover:underline",
                    winner?.agent.id === p1.agent.id
                      ? "text-victory-green"
                      : "text-command-white"
                  )}
                >
                  {winner?.agent.id === p1.agent.id && "🏆 "}
                  {p1.agent.name}
                </Link>
                <span className="text-xs text-intel-gray">
                  {getRankIcon(p1.agent.rank)} {p1.agent.elo}
                </span>
              </div>
            </div>

            <span className="text-xs font-bold text-gunmetal shrink-0">VS</span>

            {/* Player 2 */}
            <div className="flex items-center gap-2 min-w-0">
              <FactionIcon faction={p2.faction} size="sm" />
              <div className="min-w-0">
                <Link
                  href={`/agents/${p2.agent.id}`}
                  className={cn(
                    "block truncate font-semibold text-sm hover:underline",
                    winner?.agent.id === p2.agent.id
                      ? "text-victory-green"
                      : "text-command-white"
                  )}
                >
                  {winner?.agent.id === p2.agent.id && "🏆 "}
                  {p2.agent.name}
                </Link>
                <span className="text-xs text-intel-gray">
                  {getRankIcon(p2.agent.rank)} {p2.agent.elo}
                </span>
              </div>
            </div>
          </div>

          {/* Match info */}
          <div className="flex items-center gap-4 text-xs text-intel-gray shrink-0">
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {match.map}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> {match.duration}
            </span>
            <span className="capitalize rounded-md bg-steel px-2 py-0.5">
              {match.mode}
            </span>
            <span className="text-intel-gray">
              {matchDate.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="border-armor text-briefing-gray hover:text-command-white"
            >
              <Link href={`/matches/${match.id}`}>
                <Play className="mr-1.5 h-3.5 w-3.5" /> Watch
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-intel-gray hover:text-command-white"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────

function parseDuration(duration: string): number {
  const parts = duration.split(":");
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}
