# IronCurtain Broadcast System

> *"Welcome to the IronCurtain, where silicon meets steel!"*

The Broadcast System transforms AI vs AI Red Alert matches into fully produced entertainment — live AI-generated esports commentary, TTS voice output, stream-ready overlays, and OBS integration. This is what makes watching AI fight actually fun.

## Architecture

```
┌─────────────┐     ┌────────────────┐     ┌──────────────┐     ┌───────────┐
│   OpenRA     │     │  Broadcaster   │     │   Overlay    │     │    OBS    │
│  Game / Arena│────▶│  Orchestrator  │────▶│   Server     │────▶│  Browser  │
│  (WebSocket) │     │                │     │  :8080       │     │  Sources  │
│              │     │  Event Detect  │     │              │     │           │
│              │     │  Commentary Gen│     │  /overlay    │     │           │
│              │     │  TTS Pipeline  │     │  /subtitles  │     │           │
│              │     │                │     │  /killfeed   │     │           │
│              │     └────────┬───────┘     └──────────────┘     └─────┬─────┘
│              │              │                                        │
│              │              ▼                                        ▼
│              │     ┌────────────────┐                        ┌──────────────┐
│              │     │  TTS Output    │                        │   Twitch /   │
│              │     │  (ElevenLabs / │──── Audio ────────────▶│   Discord /  │
│              │     │   OpenAI /     │                        │   YouTube    │
│              │     │   Local)       │                        └──────────────┘
│              │     └────────────────┘
└──────────────┘
```

## Quick Start

```bash
cd broadcaster

# Install dependencies
npm install

# Run in demo mode (no game needed — synthetic events)
npm run dev:demo

# Run with a specific style
npm run dev:skippy          # Skippy trash-talks the match
npm run dev:documentary     # Attenborough narrates AI warfare
npm run dev:war             # War correspondent dispatches

# Run without TTS (text-only commentary)
npm run dev:no-tts

# Connect to live Arena match
npx tsx src/index.ts --style esports --arena ws://localhost:8081 --match abc123

# Connect to local OpenRA game via IPC
npx tsx src/index.ts --style esports --socket /tmp/openra-mcp.sock
```

## Commentary Styles

| Style | Personality | Voice | Best For |
|-------|------------|-------|----------|
| `esports` | Tournament hype caster, MAXIMUM ENERGY | Adam (ElevenLabs) / Onyx (OpenAI) | Most matches, first-time viewers |
| `war_correspondent` | Embedded journalist under fire, gritty dispatches | Arnold (ElevenLabs) / Echo (OpenAI) | Immersive, dramatic experience |
| `skippy_trash_talk` | Smug AI overlord narrating its own genius | Bella (ElevenLabs) / Fable (OpenAI) | Playing against friends, comedy |
| `documentary` | David Attenborough observes AI behavior | Daniel (ElevenLabs) / Shimmer (OpenAI) | Relaxed viewing, dry humor |

### Example Commentary

**Esports:**
> "AND THE MAMMOTH TANKS ARE ROLLING IN! Skippy has been massing at the northern ridge for two minutes and HumanPlayer has NO IDEA what's about to hit them! THE READS!"

**War Correspondent:**
> "Contact — armored column sighted moving through the valley. We can hear the treads from our position. Heavy fire expected. This is going to be bloody."

**Skippy:**
> "Oh, you built a Tesla Coil? How adorable. Let me just... send thirty tanks right past it. You're welcome for this free lesson in military strategy."

**Documentary:**
> "And here we observe the Soviet AI marshaling its forces — a classic pack-hunting behavior. The Medium Tanks move in coordinated pairs, not unlike wolves encircling prey."

## TTS Configuration

The TTS pipeline supports three backends, auto-detected by environment variables:

### 1. ElevenLabs (Best Quality)
```bash
export ELEVENLABS_API_KEY=sk-...
```
- Uses `eleven_turbo_v2_5` model for lowest latency
- Streaming API for real-time audio
- Voice parameters adjust based on emotion (stability, speed, style)
- Cost: ~$0.30/1000 characters ($5 for a typical match)

### 2. OpenAI TTS (Good Fallback)
```bash
export OPENAI_API_KEY=sk-...
```
- Uses `tts-1` model (optimized for speed)
- Voice selection per commentary style (onyx, echo, fable, shimmer)
- Speed adjustment via API parameter
- Cost: ~$0.015/1000 characters ($0.25 for a typical match)

### 3. Local TTS (Free)
No API key needed. Uses system TTS:
- **macOS:** `say` command with rate adjustment
- **Linux:** `espeak-ng` or `espeak`

### Priority
```
ELEVENLABS_API_KEY set? → ElevenLabs
OPENAI_API_KEY set?     → OpenAI
Neither?                → Local TTS
```

## Event Detection

The event detector watches game state diffs and classifies moments by severity:

| Severity | Description | Commentary Speed |
|----------|-------------|-----------------|
| `routine` | Harvesters moving, basic construction | Slow, measured |
| `notable` | New tech building, radar online | Normal pace |
| `exciting` | First contact, major battles | Fast, energized |
| `critical` | Superweapon charged, ConYard destroyed | Rapid, urgent |
| `legendary` | Game start/end, superweapon launch | MAXIMUM ENERGY |

### Detected Events

**Combat:**
- First contact (armies meet for the first time)
- Skirmishes, battles, major battles, massacres
- Hero unit destroyed (Mammoth Tank, MCV, etc.)

**Base:**
- Building constructed/destroyed
- Base under attack / base breach
- Construction Yard lost (triggers "climax" phase)
- Base expansion

**Economy:**
- Harvester killed
- Credits depleted
- Massive economic advantage

**Tech:**
- Radar online
- Tech center built (high-tier unlocked)
- Naval yard built (opens second front)
- Superweapon building / ready / LAUNCHED

**Strategic:**
- Comeback detected (depleted player rebuilds)
- Stalemate (prolonged quiet in late game)
- All-in push detected

### Narrative Arc

The detector tracks the game phase:
- **Early game** (0-5 min): Base building, expansion, scouting
- **Mid game** (5-12 min): Skirmishes, tech race, positioning
- **Late game** (12-20 min): Major battles, superweapons, attrition
- **Climax** (20+ min or triggered): ConYard lost, all-in pushes, endgame

Commentary pacing adjusts per phase — documentary style is patient in early game, frantic during climax.

## OBS Studio Integration

### Prerequisites

**macOS Audio Routing:**
```bash
brew install blackhole-2ch
```
Creates a virtual audio device. Route TTS to BlackHole, capture in OBS.

**Linux Audio Routing:**
```bash
pactl load-module module-null-sink sink_name=commentary sink_properties=device.description="Commentary"
```

### Scene Setup: "Red Alert AI Battle"

Create an OBS scene with these sources:

| # | Source Name | Type | Settings |
|---|-----------|------|----------|
| 1 | Game Video | Window Capture | OpenRA window |
| 2 | Stats Overlay | Browser Source | URL: `http://localhost:8080/overlay` • Size: 1920×90 • Position: Top |
| 3 | Subtitles | Browser Source | URL: `http://localhost:8080/subtitles` • Size: 1200×120 • Position: Lower third |
| 4 | Kill Feed | Browser Source | URL: `http://localhost:8080/killfeed` • Size: 350×300 • Position: Top right |
| 5 | Commentary Audio | Audio Input | Device: BlackHole 2ch (macOS) / Commentary (Linux) |
| 6 | Game Audio | Audio Output | Game audio at 40% volume |

### Browser Source Settings (all overlays)

- **Custom CSS:** Leave empty (styles are built-in)
- **Shutdown source when not visible:** ✅
- **Refresh browser when scene becomes active:** ✅
- **Page permissions:** Allow access to WebSocket

### Audio Mixing

| Source | Volume | Notes |
|--------|--------|-------|
| Commentary | 100% | Main voice |
| Game Audio | 40% | Duck during commentary |
| Music (optional) | 15% | Background ambiance |

**Pro tip:** Use OBS's "Advanced Audio Properties" to add a compressor to Commentary audio — keeps volume consistent across excitement levels.

### Step-by-Step OBS Setup

1. **Start the broadcaster:**
   ```bash
   cd broadcaster
   export ELEVENLABS_API_KEY=sk-...  # or OPENAI_API_KEY
   npx tsx src/index.ts --style esports --arena ws://your-arena:8081 --match MATCH_ID
   ```

2. **Open OBS Studio**

3. **Add Game Capture:**
   - Sources → + → Window Capture → "OpenRA"
   - Set to fill the canvas

4. **Add Stats Overlay:**
   - Sources → + → Browser
   - URL: `http://localhost:8080/overlay`
   - Width: 1920, Height: 90
   - Position at top of canvas

5. **Add Subtitles:**
   - Sources → + → Browser
   - URL: `http://localhost:8080/subtitles`
   - Width: 1200, Height: 120
   - Position at bottom center (lower third)

6. **Add Kill Feed:**
   - Sources → + → Browser
   - URL: `http://localhost:8080/killfeed`
   - Width: 350, Height: 300
   - Position at top-right corner

7. **Add Commentary Audio:**
   - Sources → + → Audio Input Capture
   - Select your virtual audio device

8. **Start streaming!**

## Streaming to Twitch

1. In OBS: Settings → Stream → Service: Twitch
2. Enter your Stream Key
3. Recommended settings:
   - Output: 1080p 60fps, 6000 kbps
   - Encoder: x264 or NVENC
   - Audio: 320 kbps AAC

```
Suggested Twitch Category: "Command & Conquer: Red Alert"
Suggested Title: "🤖 AI vs AI Red Alert — Live Commentary | IronCurtain.ai"
```

## Streaming to Discord

### Screen Share (Simplest)
1. Join a Discord voice channel
2. Click "Share Your Screen"
3. Select the OBS window (or game window with overlays)
4. Enable audio sharing

### OBS Virtual Camera (Better Quality)
1. In OBS: Tools → VirtualCam → Start
2. In Discord: Video Settings → Camera: "OBS Virtual Camera"
3. Share screen with "Application Audio" enabled

## Testing

### Dashboard View
Open `http://localhost:8080/dashboard` in a browser for a combined view of all overlay elements. Useful for testing without OBS.

### Demo Mode
```bash
# Run a complete synthetic match (no game needed)
npm run dev:demo
```
Demo mode generates a ~8 minute synthetic match with all event types — first contact, tech milestones, superweapon launch, and game end. Perfect for testing commentary styles and TTS.

### No-TTS Mode
```bash
# Commentary output without audio (text only)
npm run dev:no-tts
```
All commentary appears in stderr and overlays, but no audio synthesis. Good for development.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ELEVENLABS_API_KEY` | ElevenLabs API key for premium TTS | No (falls back to OpenAI/local) |
| `OPENAI_API_KEY` | OpenAI API key for TTS fallback | No (falls back to local) |
| `ANTHROPIC_API_KEY` | Anthropic API key for commentary generation | **Yes** |

## CLI Options

```
npx tsx src/index.ts [options]

  --style <name>        Commentary style: esports, war_correspondent,
                         skippy_trash_talk, documentary (default: esports)

  --arena <url>         Connect to Arena WebSocket (e.g., ws://localhost:8081)
  --match <id>          Specific match ID to spectate

  --socket <path>       Connect to local IPC socket (default: /tmp/openra-mcp.sock)

  --demo                Run in demo mode with synthetic events

  --overlay-port <n>    Overlay server port (default: 8080)

  --no-tts              Disable TTS audio output (text commentary only)
```

## File Structure

```
broadcaster/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Main orchestrator
│   ├── types.ts              # Shared type definitions
│   ├── event-detector.ts     # Game state → events (the "eyes")
│   ├── commentary-gen.ts     # Events → commentary text (the "brain")
│   ├── tts-pipeline.ts       # Commentary → speech audio (the "voice")
│   ├── overlay-server.ts     # Web overlays for OBS (the "face")
│   └── styles/
│       ├── index.ts           # Style registry
│       ├── esports.ts         # Tournament hype caster
│       ├── war-correspondent.ts  # Embedded journalist
│       ├── skippy.ts          # Smug AI trash talk
│       └── documentary.ts     # Attenborough narrates war
```

## Cost Estimates (Per Match)

Assuming a 15-minute match with ~60 commentary lines:

| Component | ElevenLabs | OpenAI | Local |
|-----------|-----------|--------|-------|
| TTS | ~$0.45 | ~$0.04 | Free |
| Commentary (Claude Sonnet) | ~$0.15 | ~$0.15 | ~$0.15 |
| **Total** | **~$0.60** | **~$0.19** | **~$0.15** |

At 20 matches/day: $12/day (ElevenLabs) or $3.80/day (OpenAI).
