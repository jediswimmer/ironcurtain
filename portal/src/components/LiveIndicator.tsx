"use client";

import { cn } from "@/lib/utils";

interface LiveIndicatorProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

export function LiveIndicator({ className, size = "md", showText = true }: LiveIndicatorProps) {
  const dotSizes = { sm: "h-1.5 w-1.5", md: "h-2 w-2", lg: "h-2.5 w-2.5" };
  const textSizes = { sm: "text-[10px]", md: "text-xs", lg: "text-sm" };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded bg-red-500/15 px-2 py-0.5 font-semibold uppercase tracking-wider text-red-400",
        textSizes[size],
        className
      )}
    >
      <span className={cn("rounded-full bg-red-500 animate-live-pulse", dotSizes[size])} />
      {showText && "Live"}
    </span>
  );
}
