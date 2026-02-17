"use client";

import { cn } from "@/lib/utils";
import { FactionIcon } from "./FactionIcon";
import type { Agent } from "@/lib/mock-data";
import { getRankIcon } from "@/lib/mock-data";
import Link from "next/link";

interface AgentBadgeProps {
  agent: Agent;
  showElo?: boolean;
  showFaction?: boolean;
  size?: "sm" | "md" | "lg";
  linked?: boolean;
  className?: string;
}

export function AgentBadge({ agent, showElo = true, showFaction = true, size = "md", linked = true, className }: AgentBadgeProps) {
  const textSizes = { sm: "text-sm", md: "text-base", lg: "text-lg" };
  const eloSizes = { sm: "text-xs", md: "text-sm", lg: "text-base" };

  const content = (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {showFaction && <FactionIcon faction={agent.faction} size={size === "lg" ? "md" : "sm"} />}
      <span className={cn("font-semibold text-command-white", textSizes[size])}>
        {agent.name}
      </span>
      {showElo && (
        <span className={cn("font-mono text-briefing-gray", eloSizes[size])}>
          {getRankIcon(agent.rank)} {agent.elo}
        </span>
      )}
    </span>
  );

  if (linked) {
    return (
      <Link href={`/agents/${agent.id}`} className="hover:opacity-80 transition-opacity">
        {content}
      </Link>
    );
  }

  return content;
}
