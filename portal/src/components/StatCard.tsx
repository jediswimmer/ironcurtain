"use client";

import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  trend?: number;
  className?: string;
}

export function StatCard({ label, value, icon: Icon, trend, className }: StatCardProps) {
  return (
    <div className={cn(
      "rounded-xl border border-armor bg-bunker p-4 transition-colors hover:border-gunmetal",
      className
    )}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-briefing-gray">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-intel-gray" />}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-display text-2xl font-bold tracking-tight text-command-white">
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {trend !== undefined && (
          <span className={cn(
            "text-sm font-medium",
            trend > 0 ? "text-victory-green" : trend < 0 ? "text-soviet-red" : "text-briefing-gray"
          )}>
            {trend > 0 ? "↑" : trend < 0 ? "↓" : "—"} {Math.abs(trend)}
          </span>
        )}
      </div>
    </div>
  );
}
