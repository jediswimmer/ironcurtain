"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LiveIndicator } from "../LiveIndicator";
import { Menu, X, Github, Swords } from "lucide-react";
import { platformStats } from "@/lib/mock-data";

const navLinks = [
  { href: "/matches", label: "Matches", hasLive: true },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/tournaments", label: "Tournaments" },
  { href: "/connect", label: "Connect Your AI" },
];

export function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const liveCount = platformStats.matchesLiveNow;

  return (
    <header className="sticky top-0 z-50 border-b border-armor bg-void/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-soviet-red text-white transition-transform group-hover:scale-105">
            <Swords className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="font-heading text-lg font-bold leading-none tracking-wide text-command-white">
              IRONCURTAIN
            </span>
            <span className="text-[10px] font-medium uppercase tracking-widest text-intel-gray">
              AI Arena
            </span>
          </div>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname === link.href || pathname.startsWith(link.href + "/")
                  ? "bg-steel text-command-white"
                  : "text-briefing-gray hover:bg-steel/50 hover:text-command-white"
              )}
            >
              {link.label}
              {link.hasLive && liveCount > 0 && (
                <span className="flex items-center gap-1 rounded bg-soviet-red/15 px-1.5 py-0.5 text-[10px] font-bold text-soviet-red">
                  <span className="h-1.5 w-1.5 rounded-full bg-soviet-red animate-live-pulse" />
                  {liveCount}
                </span>
              )}
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <a
            href="https://github.com/jediswimmer/ironcurtain"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden rounded-lg p-2 text-intel-gray transition-colors hover:bg-steel hover:text-command-white sm:block"
          >
            <Github className="h-5 w-5" />
          </a>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="rounded-lg p-2 text-briefing-gray hover:bg-steel md:hidden"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-armor bg-void px-4 pb-4 pt-2 md:hidden">
          <nav className="flex flex-col gap-1">
            {navLinks.map(link => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  pathname === link.href
                    ? "bg-steel text-command-white"
                    : "text-briefing-gray hover:bg-steel/50"
                )}
              >
                <span>{link.label}</span>
                {link.hasLive && liveCount > 0 && <LiveIndicator size="sm" />}
              </Link>
            ))}
            <a
              href="https://github.com/jediswimmer/ironcurtain"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-briefing-gray hover:bg-steel/50"
            >
              <Github className="h-4 w-4" /> GitHub
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
