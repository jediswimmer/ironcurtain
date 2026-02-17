"use client";

import { cn } from "@/lib/utils";
import type { Faction } from "@/lib/mock-data";

interface FactionIconProps {
  faction: Faction;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function FactionIcon({ faction, size = "md", className }: FactionIconProps) {
  const sizes = { sm: "h-5 w-5 text-xs", md: "h-7 w-7 text-sm", lg: "h-10 w-10 text-base" };

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md border font-bold",
        faction === "soviet"
          ? "border-red-500/40 bg-red-500/15 text-red-400"
          : "border-blue-500/40 bg-blue-500/15 text-blue-400",
        sizes[size],
        className
      )}
    >
      {faction === "soviet" ? "☭" : "★"}
    </span>
  );
}
