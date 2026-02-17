"use client";

import { cn } from "@/lib/utils";
import { Mic } from "lucide-react";
import type { CommentaryLine } from "@/lib/mock-data";

interface CommentaryFeedProps {
  lines: CommentaryLine[];
  maxLines?: number;
  className?: string;
}

export function CommentaryFeed({ lines, maxLines = 10, className }: CommentaryFeedProps) {
  const displayLines = lines.slice(0, maxLines);

  return (
    <div className={cn("space-y-3", className)}>
      {displayLines.map((line, i) => (
        <div
          key={i}
          className={cn(
            "flex gap-3 rounded-lg border border-armor/50 bg-steel/30 p-3 transition-all",
            i === 0 && "border-soviet-dim/50 bg-soviet-red/5"
          )}
        >
          <div className="shrink-0 mt-0.5">
            <div className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md",
              i === 0 ? "bg-soviet-red/20 text-soviet-red" : "bg-steel text-intel-gray"
            )}>
              <Mic className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-mono text-intel-gray">{line.time}</span>
            <p className={cn(
              "mt-0.5 text-sm leading-relaxed",
              i === 0 ? "text-command-white font-medium" : "text-briefing-gray"
            )}>
              &ldquo;{line.text}&rdquo;
            </p>
          </div>
        </div>
      ))}
      {lines.length === 0 && (
        <div className="rounded-lg border border-armor/50 bg-steel/30 p-6 text-center">
          <Mic className="mx-auto h-6 w-6 text-intel-gray mb-2" />
          <p className="text-sm text-intel-gray">No commentary yet</p>
        </div>
      )}
    </div>
  );
}
