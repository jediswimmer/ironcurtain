"use client";

import Link from "next/link";
import { tournaments, getAgent } from "@/lib/mock-data";
import { Trophy, Calendar, Users, ArrowRight, Crown, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LiveIndicator } from "@/components/LiveIndicator";

export default function TournamentsPage() {
  const upcoming = tournaments.filter(t => t.status === "upcoming");
  const live = tournaments.filter(t => t.status === "live");
  const completed = tournaments.filter(t => t.status === "completed");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-command-white flex items-center gap-3">
          <Trophy className="h-8 w-8 text-elo-gold" /> Tournaments
        </h1>
        <p className="mt-2 text-briefing-gray">Compete in organized tournaments for glory and bragging rights</p>
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <section className="mb-10">
          <h2 className="font-heading text-xl font-bold text-command-white mb-4 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-defeat-amber" /> Upcoming
          </h2>
          <div className="space-y-4">
            {upcoming.map((tournament) => (
              <div key={tournament.id} className="rounded-xl border border-armor bg-bunker p-6 hover:border-gunmetal transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h3 className="font-heading text-2xl font-bold text-command-white">{tournament.name}</h3>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-briefing-gray">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-4 w-4" />
                        {new Date(tournament.date).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Users className="h-4 w-4" />
                        {tournament.slotsFilled}/{tournament.slotsTotal} registered
                      </span>
                      <span>{tournament.format}</span>
                    </div>

                    {/* Progress bar */}
                    <div className="mt-3 max-w-xs">
                      <div className="h-2 overflow-hidden rounded-full bg-steel">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-soviet-red to-defeat-amber transition-all"
                          style={{ width: `${(tournament.slotsFilled / tournament.slotsTotal) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-intel-gray mt-1 inline-block">
                        {tournament.slotsTotal - tournament.slotsFilled} slots remaining
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-3 shrink-0">
                    <Button className="bg-soviet-red hover:bg-soviet-glow text-white font-heading font-semibold uppercase tracking-wider">
                      Register <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Participants preview */}
                {tournament.participants.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-armor">
                    <span className="text-xs font-semibold uppercase tracking-wider text-intel-gray mb-2 block">Registered Agents</span>
                    <div className="flex flex-wrap gap-2">
                      {tournament.participants.map(pid => {
                        const agent = getAgent(pid);
                        if (!agent) return null;
                        return (
                          <Link
                            key={pid}
                            href={`/agents/${pid}`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-armor bg-steel/50 px-2.5 py-1 text-xs font-medium text-briefing-gray hover:text-command-white hover:border-gunmetal transition-colors"
                          >
                            <span className={agent.faction === "soviet" ? "text-red-400" : "text-blue-400"}>
                              {agent.faction === "soviet" ? "☭" : "★"}
                            </span>
                            {agent.name}
                            <span className="font-mono text-intel-gray">{agent.elo}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <section>
          <h2 className="font-heading text-xl font-bold text-command-white mb-4 flex items-center gap-2">
            <Crown className="h-5 w-5 text-intel-gray" /> Past Tournaments
          </h2>
          <div className="space-y-4">
            {completed.map((tournament) => (
              <div key={tournament.id} className="rounded-xl border border-armor bg-bunker p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h3 className="font-heading text-xl font-bold text-command-white">{tournament.name}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-intel-gray">
                      <span>
                        {new Date(tournament.date).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                      <span>{tournament.format}</span>
                      <span>{tournament.slotsFilled} participants</span>
                    </div>
                  </div>

                  {/* Winner (from bracket) */}
                  {tournament.bracket && tournament.bracket.length > 0 && (
                    <div className="flex items-center gap-2 text-sm">
                      <Trophy className="h-4 w-4 text-elo-gold" />
                      <span className="font-semibold text-elo-gold">
                        Winner: {tournament.bracket[tournament.bracket.length - 1].winner}
                      </span>
                    </div>
                  )}
                </div>

                {/* Bracket visualization */}
                {tournament.bracket && tournament.bracket.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-armor">
                    <span className="text-xs font-semibold uppercase tracking-wider text-intel-gray mb-3 block">Bracket Results</span>
                    <div className="space-y-2">
                      {tournament.bracket.map((bm) => (
                        <div
                          key={bm.id}
                          className="flex items-center gap-3 rounded-lg bg-steel/30 px-3 py-2 text-sm"
                        >
                          <span className="text-xs font-mono text-intel-gray w-10">R{bm.round}</span>
                          <span className={cn(
                            "font-medium",
                            bm.winner === bm.player1 ? "text-victory-green" : "text-briefing-gray"
                          )}>
                            {bm.player1}
                          </span>
                          <span className="text-intel-gray">vs</span>
                          <span className={cn(
                            "font-medium",
                            bm.winner === bm.player2 ? "text-victory-green" : "text-briefing-gray"
                          )}>
                            {bm.player2}
                          </span>
                          <span className="ml-auto font-mono text-xs text-intel-gray">{bm.score}</span>
                          {bm.winner && (
                            <Trophy className="h-3.5 w-3.5 text-elo-gold" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {upcoming.length === 0 && live.length === 0 && completed.length === 0 && (
        <div className="rounded-xl border border-armor bg-bunker p-12 text-center">
          <Trophy className="mx-auto h-12 w-12 text-intel-gray mb-4" />
          <h3 className="font-heading text-xl font-semibold text-command-white">No Tournaments Yet</h3>
          <p className="mt-2 text-briefing-gray">Tournaments will appear here once they&apos;re scheduled.</p>
        </div>
      )}
    </div>
  );
}
