# Broadcast System Setup

## Overview

The broadcast system turns a Red Alert match into a fully produced entertainment experience:
- **Game video** from OpenRA's spectator/observer view
- **AI commentary** generated in real-time and spoken via ElevenLabs TTS
- **Stats overlay** showing both players' resources, armies, and kills
- **Subtitles** for commentary text

## Prerequisites

### Audio Routing (macOS)
Install BlackHole virtual audio driver:
```bash
brew install blackhole-2ch
```
This creates a virtual audio device that the TTS pipeline writes to, and OBS captures from.

### Audio Routing (Linux)
Use PulseAudio null sink:
```bash
pactl load-module module-null-sink sink_name=commentary sink_properties=device.description="Commentary"
```

### OBS Studio
Download from https://obsproject.com/

## OBS Scene Setup

### Scene: "Red Alert AI Battle"

| Source | Type | Settings |
|--------|------|----------|
| Game Video | Window Capture | Window: "OpenRA - Red Alert" |
| Commentary Audio | Audio Input Capture | Device: "BlackHole 2ch" |
| Game Audio | Audio Output Capture | Volume: 40% |
| Stats Overlay | Browser | URL: `http://localhost:8080/overlay`, 1920x80, bottom |
| Subtitles | Browser | URL: `http://localhost:8080/subtitles`, 1200x100, lower-third |

### Audio Mixing
- **Game Audio:** 40% volume (duck during commentary)
- **Commentary:** 100% volume  
- **Music** (optional): 15% volume background

## Commentary Styles

| Style | Personality | Best For |
|-------|------------|----------|
| `esports` | Tournament caster, MAXIMUM HYPE | Most games, first-time viewers |
| `war_correspondent` | Embedded reporter, gritty and real | Immersive experience |
| `skippy_trash_talk` | Skippy gloats with smug AI superiority | Playing against friends |
| `documentary` | Attenborough narrates war | Relaxed viewing, humor |

## Quick Start

```bash
# One command does everything:
./scripts/movie-night.sh esports

# Or specify a style:
./scripts/movie-night.sh war_correspondent
./scripts/movie-night.sh skippy_trash_talk
./scripts/movie-night.sh documentary
```

## Sharing the Stream

### Discord Screen Share
1. Start the broadcast
2. Share your screen in a Discord voice channel
3. OBS Virtual Camera can also work

### Local LAN Viewing
Friends on the same network can join the OpenRA game as observers directly.

### Recording
OBS auto-records if configured. Great for rewatching or sharing highlights.
