"use client";

import { cn } from "@/lib/utils";
import { Monitor, Radio } from "lucide-react";

interface StreamEmbedProps {
  streamUrl?: string;
  className?: string;
  showControls?: boolean;
}

export function StreamEmbed({ streamUrl, className, showControls = false }: StreamEmbedProps) {
  // For now, show a placeholder. When real streams exist, embed Twitch/HLS.
  return (
    <div className={cn("relative aspect-video overflow-hidden rounded-xl bg-steel border border-armor", className)}>
      <div className="absolute inset-0 bg-grid-pattern opacity-20" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <div className="rounded-full bg-bunker p-4 border border-armor">
          <Monitor className="h-8 w-8 text-intel-gray" />
        </div>
        <div className="text-center">
          <p className="font-heading text-lg font-semibold text-briefing-gray">Stream Preview</p>
          <p className="text-sm text-intel-gray">Live game footage will appear here</p>
        </div>
      </div>
      {streamUrl && (
        <div className="absolute bottom-3 left-3">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-soviet-red/90 px-2.5 py-1 text-xs font-semibold text-white">
            <Radio className="h-3 w-3" />
            Streaming
          </span>
        </div>
      )}
    </div>
  );
}
