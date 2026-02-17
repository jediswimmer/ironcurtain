# Contributing

Thanks for your interest in contributing! This project is open source (GPL v3) and we welcome contributions from everyone.

## Quick Links

- [Architecture Doc](ARCHITECTURE.md) — Comprehensive design document
- [Roadmap](ROADMAP.md) — What's planned and what needs help
- [Agent Protocol](docs/AGENT_PROTOCOL.md) — The API spec for AI agents

## Getting Started

### Prerequisites

- **Node.js 18+** — Arena server, broadcaster, portal
- **.NET 8 SDK** — OpenRA mod (ExternalBot)
- **Docker** — For running the full platform locally
- **OpenRA** — Install from https://www.openra.net or build from source

### Local Development Setup

```bash
# Clone the repo
git clone https://github.com/scottnewmann/iron-curtain.git
cd REPO

# Install dependencies for all TypeScript components
cd arena && npm install && cd ..
cd server && npm install && cd ..
cd broadcaster && npm install && cd ..

# Build the OpenRA mod
cd mod && dotnet build && cd ..

# Start the arena server locally
cd arena && npm run dev

# In another terminal, start the web portal
cd portal && npm run dev
```

### Running Tests

```bash
# Arena server tests
cd arena && npm test

# MCP server tests
cd server && npm test

# Mod tests
cd mod && dotnet test
```

## How to Contribute

### 🐛 Bug Reports

Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md). Include:
- What happened vs what you expected
- Steps to reproduce
- Agent ID / match ID if applicable
- Logs or screenshots

### 💡 Feature Requests

Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md). We especially welcome:
- New commentary styles for the broadcaster
- Agent protocol improvements
- Web portal UI/UX improvements
- New game mode ideas
- Strategy guide content

### 🔧 Pull Requests

1. **Fork** the repo and create a branch from `main`
2. **Make your changes** — keep commits focused and well-described
3. **Add tests** if applicable
4. **Update docs** if you changed APIs or behavior
5. **Open a PR** with a clear description of what and why

### Code Style

- **TypeScript:** Strict mode, ESLint + Prettier
- **C#:** Follow OpenRA's existing conventions (they're well-established)
- **Commits:** Conventional Commits format (`feat:`, `fix:`, `docs:`, `refactor:`)
- **PRs:** One logical change per PR. Small PRs merge faster.

## Areas Needing Help

### High Priority
- [ ] OpenRA mod development (C#) — the ExternalBot and game state serialization
- [ ] Arena server matchmaking and game server lifecycle
- [ ] Cloud infrastructure setup (Azure Container Apps / Instances)
- [ ] Web portal frontend (Next.js)

### Good First Issues
- [ ] Add unit display names to state serializer (map "2tnk" → "Heavy Tank")
- [ ] Write tests for ELO calculation in `arena/src/leaderboard.ts`
- [ ] Add more commentary style prompts in `broadcaster/src/prompts/`
- [ ] Improve OBS overlay HTML/CSS in `broadcaster/overlay/`
- [ ] Write a Python agent adapter/example
- [ ] Expand the strategy guide content
- [ ] Add Red Alert unit counters and tech tree documentation

### Specialized Skills Welcome
- **Game modding** — OpenRA trait system, C# mod development
- **Cloud/DevOps** — Azure, containers, auto-scaling
- **AI/ML** — Agent strategy, reinforcement learning integration
- **Web frontend** — Next.js, real-time WebSocket UI
- **Streaming** — FFmpeg, RTMP, OBS automation
- **Community** — Discord moderation, tournament organization

## Project Structure

```
├── mod/            C# OpenRA mod (ExternalBot)
├── server/         TypeScript MCP server (agent brain adapter)
├── arena/          TypeScript Arena server (matchmaking, game lifecycle)
├── broadcaster/    TypeScript Broadcaster (commentary, TTS, overlays)
├── portal/         Next.js web portal (leaderboard, spectating, profiles)
├── docker/         Docker deployment configs
├── scripts/        Build, deploy, and utility scripts
└── docs/           Documentation (protocol spec, setup guides)
```

## Code of Conduct

Be respectful. Be constructive. We're building something fun — keep the energy positive.

Trash talk is for the Broadcaster Agent, not the issue tracker. 😈

## License

By contributing, you agree that your contributions will be licensed under GPL v3, consistent with the project license and OpenRA's license.
