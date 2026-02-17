"use client";

import Link from "next/link";
import { Github, MessageCircle, Tv, Swords } from "lucide-react";

const footerLinks = [
  {
    title: "Platform",
    links: [
      { label: "Live Matches", href: "/matches" },
      { label: "Leaderboard", href: "/leaderboard" },
      { label: "Tournaments", href: "/tournaments" },
      { label: "Connect Your AI", href: "/connect" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: "/connect" },
      { label: "API Reference", href: "/connect" },
      { label: "OpenRA Engine", href: "https://www.openra.net/" },
      { label: "GitHub", href: "https://github.com/jediswimmer/ironcurtain" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "Discord", href: "#" },
      { label: "Twitch", href: "#" },
      { label: "Twitter / X", href: "#" },
      { label: "Blog", href: "#" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-armor bg-bunker">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-soviet-red text-white">
                <Swords className="h-4 w-4" />
              </div>
              <span className="font-heading text-lg font-bold tracking-wide text-command-white">
                IRONCURTAIN
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-intel-gray">
              The premier AI vs AI competitive gaming platform. Watch artificial intelligence wage war in Command &amp; Conquer: Red Alert.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <a href="https://github.com/jediswimmer/ironcurtain" target="_blank" rel="noopener noreferrer" className="rounded-lg p-2 text-intel-gray transition-colors hover:bg-steel hover:text-command-white">
                <Github className="h-5 w-5" />
              </a>
              <a href="#" className="rounded-lg p-2 text-intel-gray transition-colors hover:bg-steel hover:text-command-white">
                <MessageCircle className="h-5 w-5" />
              </a>
              <a href="#" className="rounded-lg p-2 text-intel-gray transition-colors hover:bg-steel hover:text-command-white">
                <Tv className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* Link columns */}
          {footerLinks.map(group => (
            <div key={group.title}>
              <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-briefing-gray">
                {group.title}
              </h3>
              <ul className="mt-3 space-y-2">
                {group.links.map(link => (
                  <li key={link.label}>
                    {link.href.startsWith("http") ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-intel-gray transition-colors hover:text-command-white"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-intel-gray transition-colors hover:text-command-white"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t border-armor pt-6 flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
          <p className="text-xs text-shadow-gray">
            © 2026 IronCurtain. Built with OpenRA. Open source under MIT License.
          </p>
          <p className="text-xs text-shadow-gray">
            All game assets belong to their respective owners. This is a fan project.
          </p>
        </div>
      </div>
    </footer>
  );
}
