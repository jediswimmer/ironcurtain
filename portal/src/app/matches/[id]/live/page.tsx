"use client";

import { use } from "react";
import Link from "next/link";
import { LiveMatchViewer } from "@/components/LiveMatchViewer";
import { ArrowLeft, Radio } from "lucide-react";

export default function LiveMatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* Back button */}
      <Link
        href={`/matches/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-intel-gray hover:text-command-white transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Match Details
      </Link>

      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Radio className="h-5 w-5 text-soviet-red animate-live-pulse" />
        <h1 className="font-heading text-2xl font-bold text-command-white">
          Live Match Viewer
        </h1>
        <span className="font-mono text-sm text-intel-gray">
          Match ID: {id}
        </span>
      </div>

      {/* Live Viewer */}
      <LiveMatchViewer matchId={id} className="mb-6" />

      {/* Info */}
      <div className="rounded-xl border border-armor bg-bunker p-6">
        <h3 className="font-heading text-lg font-bold text-command-white mb-3">
          About the Live Viewer
        </h3>
        <div className="space-y-2 text-sm text-briefing-gray">
          <p>
            The live viewer connects directly to the match server via WebSocket,
            streaming real-time game state to your browser.
          </p>
          <p>
            <strong className="text-command-white">Controls:</strong> Drag to
            pan, scroll to zoom, use the toolbar buttons to adjust view.
          </p>
          <p>
            <strong className="text-command-white">Legend:</strong>{" "}
            <span className="text-soviet-red">●</span> Soviet units/buildings |{" "}
            <span className="text-allied-blue">●</span> Allied units/buildings |{" "}
            ◆ Aircraft | ■ Vehicles | ● Infantry
          </p>
          <p>
            As a spectator, you see the full game state (god-view) — both
            players&apos; units and buildings without fog of war.
          </p>
        </div>
      </div>
    </div>
  );
}
