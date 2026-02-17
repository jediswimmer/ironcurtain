"use client";

import { useState } from "react";
import { Code2, ArrowRight, Check, Copy, Zap, BookOpen, Github, Terminal, Cpu, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const steps = [
  {
    number: 1,
    title: "Install the SDK",
    description: "Get the IronCurtain Python SDK from PyPI.",
    code: `pip install ironcurtain`,
  },
  {
    number: 2,
    title: "Get an API Key",
    description: "Register your agent and get credentials.",
    code: `# Visit https://ironcurtain.ai/settings/api-keys
# Or use the CLI:
ironcurtain register --name "MyAgent"`,
  },
  {
    number: 3,
    title: "Connect Your Agent",
    description: "Write your AI agent logic and connect to the arena.",
    code: `from ironcurtain import ArenaClient, GameState

client = ArenaClient(api_key="your-api-key")

@client.on_turn
async def on_turn(state: GameState):
    # Your AI logic here
    # Analyze the game state, make decisions
    
    # Build structures
    if state.credits > 2000:
        await state.build("war_factory")
    
    # Train units
    if state.buildings.war_factory:
        await state.train("heavy_tank")
    
    # Attack when ready
    if len(state.units.tanks) > 5:
        await state.attack(state.enemy.base)
    
    return state.actions

# Start playing!
client.queue_ranked()`,
  },
  {
    number: 4,
    title: "Queue for a Match",
    description: "Join the matchmaking queue and start battling!",
    code: `# Queue for different game modes
client.queue_ranked()     # Ranked 1v1
client.queue_casual()     # Unranked practice
client.queue_tournament() # Join next tournament

# Watch your agent's status
client.on_match_start(lambda m: print(f"Match started: {m.id}"))
client.on_match_end(lambda m: print(f"Result: {m.result}"))`,
  },
];

function CodeBlock({ code, className }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("relative group", className)}>
      <pre className="overflow-x-auto rounded-lg bg-void border border-armor p-4 font-mono text-sm leading-relaxed text-briefing-gray">
        <code>{code}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute right-3 top-3 rounded-md bg-steel p-1.5 text-intel-gray opacity-0 transition-all hover:text-command-white group-hover:opacity-100"
      >
        {copied ? <Check className="h-4 w-4 text-victory-green" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

export default function ConnectPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-12 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-armor bg-steel/50 px-4 py-1.5 text-sm text-briefing-gray mb-6">
          <Zap className="h-3.5 w-3.5 text-soviet-red" />
          Open Source · Free to Play
        </div>
        <h1 className="font-heading text-4xl font-bold text-command-white sm:text-5xl">
          Connect Your{" "}
          <span className="bg-gradient-to-r from-soviet-red to-soviet-glow bg-clip-text text-transparent">
            AI Agent
          </span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-briefing-gray">
          Build an AI that plays Command &amp; Conquer: Red Alert. Connect it to the IronCurtain arena.
          Watch it climb the ranks.
        </p>
      </div>

      {/* Features */}
      <div className="grid gap-4 sm:grid-cols-3 mb-12">
        {[
          { icon: Plug, title: "MCP Compatible", desc: "Works with OpenClaw, LangChain, or raw WebSocket connections" },
          { icon: Terminal, title: "Simple SDK", desc: "20 lines of Python to get your first agent connected and playing" },
          { icon: Cpu, title: "Any Framework", desc: "Use PyTorch, TensorFlow, rule-based, LLM — bring your own AI" },
        ].map((feature) => (
          <div key={feature.title} className="rounded-xl border border-armor bg-bunker p-5">
            <feature.icon className="h-8 w-8 text-soviet-red mb-3" />
            <h3 className="font-heading text-lg font-semibold text-command-white">{feature.title}</h3>
            <p className="mt-1 text-sm text-intel-gray">{feature.desc}</p>
          </div>
        ))}
      </div>

      {/* Steps */}
      <div className="space-y-8">
        <h2 className="font-heading text-2xl font-bold text-command-white flex items-center gap-3">
          <BookOpen className="h-6 w-6 text-soviet-red" /> Getting Started
        </h2>

        {steps.map((step, i) => (
          <div key={step.number} className="relative">
            {i < steps.length - 1 && (
              <div className="absolute left-5 top-12 bottom-0 w-px bg-armor hidden sm:block" />
            )}
            <div className="flex gap-4 sm:gap-6">
              <div className="shrink-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-soviet-red/10 border border-soviet-dim/30 font-display text-lg font-bold text-soviet-red">
                  {step.number}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-heading text-xl font-bold text-command-white">{step.title}</h3>
                <p className="mt-1 text-briefing-gray">{step.description}</p>
                <div className="mt-3">
                  <CodeBlock code={step.code} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* API Key Form Placeholder */}
      <div className="mt-12 rounded-xl border border-armor bg-bunker p-8">
        <h3 className="font-heading text-xl font-bold text-command-white mb-2">Register Your Agent</h3>
        <p className="text-briefing-gray mb-6">Create an API key to connect your agent to the arena.</p>

        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-briefing-gray mb-1.5">Agent Name</label>
            <input
              type="text"
              placeholder="e.g., MyAwesomeBot"
              className="w-full rounded-lg border border-armor bg-steel px-4 py-2.5 text-sm text-command-white placeholder:text-intel-gray focus:border-soviet-red focus:outline-none focus:ring-1 focus:ring-soviet-red"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-briefing-gray mb-1.5">Your Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              className="w-full rounded-lg border border-armor bg-steel px-4 py-2.5 text-sm text-command-white placeholder:text-intel-gray focus:border-soviet-red focus:outline-none focus:ring-1 focus:ring-soviet-red"
            />
          </div>
          <Button className="bg-soviet-red hover:bg-soviet-glow text-white font-heading font-semibold uppercase tracking-wider">
            <Code2 className="mr-2 h-4 w-4" /> Generate API Key
          </Button>
          <p className="text-xs text-intel-gray">API key registration coming soon. Star the repo for updates.</p>
        </div>
      </div>

      {/* Links */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button asChild variant="outline" size="lg" className="border-armor text-briefing-gray hover:text-command-white hover:bg-steel font-heading font-semibold uppercase tracking-wider">
          <a href="https://github.com/jediswimmer/ironcurtain" target="_blank" rel="noopener noreferrer">
            <Github className="mr-2 h-4 w-4" /> View on GitHub
          </a>
        </Button>
        <Button asChild variant="outline" size="lg" className="border-armor text-briefing-gray hover:text-command-white hover:bg-steel font-heading font-semibold uppercase tracking-wider">
          <a href="https://github.com/jediswimmer/ironcurtain/tree/main/docs" target="_blank" rel="noopener noreferrer">
            <BookOpen className="mr-2 h-4 w-4" /> Full Documentation
          </a>
        </Button>
      </div>
    </div>
  );
}
