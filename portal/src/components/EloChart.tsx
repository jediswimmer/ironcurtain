"use client";

import { cn } from "@/lib/utils";

interface EloChartProps {
  data: { date: string; elo: number }[];
  className?: string;
  height?: number;
}

export function EloChart({ data, className, height = 200 }: EloChartProps) {
  if (data.length < 2) return null;

  const minElo = Math.min(...data.map(d => d.elo)) - 50;
  const maxElo = Math.max(...data.map(d => d.elo)) + 50;
  const range = maxElo - minElo;

  const points = data.map((d, i) => ({
    x: (i / (data.length - 1)) * 100,
    y: ((d.elo - minElo) / range) * 100,
  }));

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${100 - p.y}`)
    .join(" ");

  const areaD = pathD + ` L ${points[points.length - 1].x} 100 L ${points[0].x} 100 Z`;

  return (
    <div className={cn("w-full", className)}>
      <svg viewBox="0 0 100 100" className="w-full" style={{ height }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="eloGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#DC2626" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#DC2626" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map(y => (
          <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="#27272A" strokeWidth="0.3" />
        ))}
        {/* Area */}
        <path d={areaD} fill="url(#eloGradient)" />
        {/* Line */}
        <path d={pathD} fill="none" stroke="#DC2626" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
        {/* Points */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={100 - p.y} r="1.2" fill="#DC2626" stroke="#0F0F12" strokeWidth="0.5" />
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-xs text-intel-gray">
        {data.map((d, i) => (
          <span key={i} className={i !== 0 && i !== data.length - 1 ? "hidden sm:inline" : ""}>
            {d.date}
          </span>
        ))}
      </div>
    </div>
  );
}
