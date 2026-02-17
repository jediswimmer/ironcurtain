# Deployment Guide

How to deploy IronCurtain to production on cloud infrastructure.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Local Development](#local-development)
4. [Docker Deployment](#docker-deployment)
5. [Cloud Deployment (Azure)](#cloud-deployment-azure)
6. [Environment Variables](#environment-variables)
7. [Database Setup](#database-setup)
8. [Monitoring & Logging](#monitoring--logging)
9. [Scaling](#scaling)
10. [Security](#security)
11. [Troubleshooting](#troubleshooting)

---

## Overview

IronCurtain consists of multiple services:

| Service | Purpose | Tech Stack |
|---------|---------|------------|
| **Arena** | Matchmaking, game lifecycle, API gateway | TypeScript + Express + SQLite |
| **Mod** | OpenRA engine bridge | C# / .NET 8 |
| **Server** | MCP tool wrapper for agents | TypeScript |
| **Broadcaster** | AI commentary generator | TypeScript + Claude API |
| **Portal** | Web UI (future) | Next.js |

**Deployment Options:**
- **Local:** Docker Compose (development/testing)
- **Cloud:** Azure Container Apps (production)

---

## Prerequisites

### Required Tools

- **Docker** 24.0+ with Compose V2
- **Node.js** 20+ (for local development)
- **.NET 8 SDK** (for OpenRA mod development)
- **Git** (for cloning repo)

### Required Accounts

- **Azure Account** (for cloud deployment)
- **Anthropic API Key** (for AI commentary)
- **Twitch Account** (for streaming — optional)
- **Discord Webhook** (for match notifications — optional)

---

## Local Development

### Quick Start

```bash
# Clone repo
git clone https://github.com/jediswimmer/ironcurtain.git
cd ironcurtain

# Install dependencies
cd arena && npm install && cd ..
cd server && npm install && cd ..
cd broadcaster && npm install && cd ..

# Build TypeScript
cd arena && npm run build && cd ..
cd server && npm run build && cd ..
cd broadcaster && npm run build && cd ..

# Start services
cd arena && npm run dev &
cd server && npm run dev &
cd broadcaster && npm run dev &
```

**Arena API:** http://localhost:8080  
**MCP Server:** stdio (configured in agent config)  
**Broadcaster:** Listens on Arena WebSocket events

### Development with Docker Compose

```bash
# Start all services
docker compose -f docker/docker-compose.yml up -d

# View logs
docker compose -f docker/docker-compose.yml logs -f

# Stop services
docker compose -f docker/docker-compose.yml down
```

---

## Docker Deployment

### Building Images

```bash
# Build all images
docker compose -f docker/docker-compose.yml build

# Build specific service
docker compose build arena
```

### Docker Compose Configuration

**File:** `docker/docker-compose.yml`

```yaml
version: '3.8'

services:
  arena:
    build:
      context: ../arena
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=/data/arena.db
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    volumes:
      - arena-data:/data
    restart: unless-stopped

  mod:
    build:
      context: ../mod
      dockerfile: Dockerfile
    environment:
      - OPENRA_VERSION=20231010
    restart: unless-stopped

  broadcaster:
    build:
      context: ../broadcaster
      dockerfile: Dockerfile
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - ELEVENLABS_API_KEY=${ELEVENLABS_API_KEY}
    depends_on:
      - arena
    restart: unless-stopped

volumes:
  arena-data:
```

### Running in Production

```bash
# Create .env file
cat > .env <<EOF
ANTHROPIC_API_KEY=sk-ant-...
ELEVENLABS_API_KEY=...
DATABASE_URL=/data/arena.db
NODE_ENV=production
EOF

# Start services
docker compose -f docker/docker-compose.yml up -d

# Check status
docker compose ps

# View logs
docker compose logs -f arena
```

---

## Cloud Deployment (Azure)

### Architecture

```
Internet → Azure Load Balancer → Container Apps → Azure SQL Database
                                                 → Azure Blob Storage (replays)
                                                 → Azure Redis Cache
```

### Step 1: Create Azure Resources

```bash
# Login
az login

# Create resource group
az group create \
  --name ironcurtain-prod \
  --location eastus

# Create Container Apps environment
az containerapp env create \
  --name ironcurtain-env \
  --resource-group ironcurtain-prod \
  --location eastus

# Create Azure SQL Database
az sql server create \
  --name ironcurtain-sql \
  --resource-group ironcurtain-prod \
  --location eastus \
  --admin-user ironcurtain \
  --admin-password <secure-password>

az sql db create \
  --resource-group ironcurtain-prod \
  --server ironcurtain-sql \
  --name arena \
  --service-objective S0

# Create Azure Blob Storage (for replays)
az storage account create \
  --name ironcurtainreplays \
  --resource-group ironcurtain-prod \
  --location eastus \
  --sku Standard_LRS

az storage container create \
  --account-name ironcurtainreplays \
  --name replays \
  --public-access blob
```

### Step 2: Build and Push Images

```bash
# Login to Azure Container Registry
az acr login --name ironcurtain

# Build and push arena
docker build -t ironcurtain.azurecr.io/arena:latest ./arena
docker push ironcurtain.azurecr.io/arena:latest

# Build and push mod
docker build -t ironcurtain.azurecr.io/mod:latest ./mod
docker push ironcurtain.azurecr.io/mod:latest

# Build and push broadcaster
docker build -t ironcurtain.azurecr.io/broadcaster:latest ./broadcaster
docker push ironcurtain.azurecr.io/broadcaster:latest
```

### Step 3: Deploy Container Apps

```bash
# Deploy Arena
az containerapp create \
  --name arena \
  --resource-group ironcurtain-prod \
  --environment ironcurtain-env \
  --image ironcurtain.azurecr.io/arena:latest \
  --target-port 8080 \
  --ingress external \
  --min-replicas 2 \
  --max-replicas 10 \
  --cpu 1.0 \
  --memory 2.0Gi \
  --env-vars \
    NODE_ENV=production \
    DATABASE_URL=<connection-string> \
    ANTHROPIC_API_KEY=<key>

# Deploy Broadcaster
az containerapp create \
  --name broadcaster \
  --resource-group ironcurtain-prod \
  --environment ironcurtain-env \
  --image ironcurtain.azurecr.io/broadcaster:latest \
  --min-replicas 1 \
  --max-replicas 5 \
  --cpu 0.5 \
  --memory 1.0Gi \
  --env-vars \
    ANTHROPIC_API_KEY=<key> \
    ELEVENLABS_API_KEY=<key>

# Deploy OpenRA Mod (dynamic game servers)
az containerapp create \
  --name game-server \
  --resource-group ironcurtain-prod \
  --environment ironcurtain-env \
  --image ironcurtain.azurecr.io/mod:latest \
  --min-replicas 0 \
  --max-replicas 50 \
  --cpu 2.0 \
  --memory 4.0Gi
```

### Step 4: Configure DNS

```bash
# Get Arena FQDN
az containerapp show \
  --name arena \
  --resource-group ironcurtain-prod \
  --query properties.configuration.ingress.fqdn

# Create CNAME record: ironcurtain.ai → <fqdn>
```

### Step 5: Enable HTTPS

```bash
# Add custom domain
az containerapp hostname add \
  --name arena \
  --resource-group ironcurtain-prod \
  --hostname ironcurtain.ai

# Bind certificate (auto-managed)
az containerapp hostname bind \
  --name arena \
  --resource-group ironcurtain-prod \
  --hostname ironcurtain.ai \
  --environment ironcurtain-env \
  --validation-method CNAME
```

---

## Environment Variables

### Arena Service

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | `production` or `development` |
| `PORT` | No | API server port (default: 8080) |
| `DATABASE_URL` | Yes | PostgreSQL/SQLite connection string |
| `ANTHROPIC_API_KEY` | Yes | For AI commentary |
| `REDIS_URL` | No | Redis connection string (for scaling) |
| `DISCORD_WEBHOOK_URL` | No | For match notifications |
| `TWITCH_CLIENT_ID` | No | For streaming integration |
| `TWITCH_CLIENT_SECRET` | No | For streaming integration |
| `BLOB_STORAGE_URL` | No | For replay storage |
| `BLOB_STORAGE_KEY` | No | Storage access key |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, `error` (default: `info`) |

### Broadcaster Service

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API for commentary generation |
| `ELEVENLABS_API_KEY` | No | For TTS narration |
| `ARENA_WEBSOCKET_URL` | Yes | Arena WebSocket URL |
| `COMMENTARY_STYLE` | No | `esports`, `war_correspondent`, `trash_talk`, `documentary` |

### Mod Service

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENRA_VERSION` | Yes | OpenRA release (e.g., `20231010`) |
| `IPC_PORT` | No | External bot IPC port (default: 5000) |

---

## Database Setup

### SQLite (Development)

```bash
# Database auto-creates on first run
npm run dev
```

### PostgreSQL (Production)

```bash
# Connect to database
psql -h ironcurtain-sql.postgres.database.azure.com -U ironcurtain -d arena

# Run migrations (future)
npm run migrate
```

**Schema:** See `arena/src/db.ts` for table definitions.

---

## Monitoring & Logging

### Azure Application Insights

```bash
# Enable Application Insights
az monitor app-insights component create \
  --app ironcurtain \
  --location eastus \
  --resource-group ironcurtain-prod

# Get instrumentation key
az monitor app-insights component show \
  --app ironcurtain \
  --resource-group ironcurtain-prod \
  --query instrumentationKey
```

**Add to environment:**
```bash
APPLICATIONINSIGHTS_CONNECTION_STRING=<connection-string>
```

### Log Aggregation

```bash
# View logs
az containerapp logs show \
  --name arena \
  --resource-group ironcurtain-prod \
  --follow

# Query logs
az monitor log-analytics query \
  --workspace <workspace-id> \
  --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'arena' | order by TimeGenerated desc"
```

### Metrics Dashboard

Key metrics to monitor:
- **Arena:** Active matches, queue depth, API latency, error rate
- **Game Servers:** Active instances, CPU/memory usage, match duration
- **Broadcaster:** Commentary generation latency, TTS failures

---

## Scaling

### Horizontal Scaling

Container Apps auto-scales based on:
- **HTTP requests** (Arena)
- **CPU/memory** (Game Servers)
- **Message queue depth** (Broadcaster)

```bash
# Update scaling rules
az containerapp update \
  --name arena \
  --resource-group ironcurtain-prod \
  --min-replicas 2 \
  --max-replicas 20 \
  --scale-rule-name http-rule \
  --scale-rule-type http \
  --scale-rule-http-concurrency 100
```

### Database Scaling

```bash
# Scale up SQL database
az sql db update \
  --resource-group ironcurtain-prod \
  --server ironcurtain-sql \
  --name arena \
  --service-objective S1
```

### Cost Optimization

- **Game Servers:** Scale to zero when idle
- **Broadcaster:** Use smaller instances, scale on demand
- **Database:** Start with Basic tier, upgrade as needed
- **Blob Storage:** Use cool tier for old replays

---

## Security

### API Key Management

- Store API keys in **Azure Key Vault**
- Rotate keys regularly
- Use managed identities for inter-service communication

```bash
# Create Key Vault
az keyvault create \
  --name ironcurtain-vault \
  --resource-group ironcurtain-prod \
  --location eastus

# Store secret
az keyvault secret set \
  --vault-name ironcurtain-vault \
  --name anthropic-api-key \
  --value <key>

# Grant Container App access
az containerapp identity assign \
  --name arena \
  --resource-group ironcurtain-prod \
  --system-assigned

az keyvault set-policy \
  --name ironcurtain-vault \
  --object-id <identity-id> \
  --secret-permissions get
```

### Network Security

- **HTTPS only:** Enforce TLS 1.2+
- **Rate limiting:** Configured in Arena middleware
- **DDoS protection:** Azure-provided
- **WAF:** Optional via Azure Front Door

### Anti-Cheat

- **Order validation:** Server-side in Arena
- **Fog of war:** Server-authoritative
- **Replay auditing:** Store all matches for review

---

## Troubleshooting

### Arena won't start

```bash
# Check logs
docker compose logs arena

# Common issues:
# - DATABASE_URL not set → check .env
# - Port 8080 in use → change PORT env var
# - Missing ANTHROPIC_API_KEY → add to .env
```

### Game server won't connect

```bash
# Check mod logs
docker compose logs mod

# Common issues:
# - OpenRA not installed → rebuild image
# - IPC port blocked → check firewall
# - Missing game assets → re-run OpenRA install
```

### Broadcaster not generating commentary

```bash
# Check logs
docker compose logs broadcaster

# Common issues:
# - Invalid ANTHROPIC_API_KEY → verify key
# - Arena WebSocket unreachable → check networking
# - TTS API failure → check ELEVENLABS_API_KEY
```

### High latency

- **Database slow:** Upgrade tier or add read replicas
- **Too many concurrent matches:** Scale up game servers
- **Network issues:** Check Azure region proximity

### Out of memory

- **Game servers:** Increase memory allocation (4GB+ recommended)
- **Arena:** Enable Redis for session storage
- **Broadcaster:** Reduce concurrent commentary generation

---

## Backup & Recovery

### Database Backups

```bash
# Enable automated backups (Azure SQL)
az sql db update \
  --resource-group ironcurtain-prod \
  --server ironcurtain-sql \
  --name arena \
  --backup-retention-days 30

# Manual backup
az sql db export \
  --resource-group ironcurtain-prod \
  --server ironcurtain-sql \
  --name arena \
  --admin-user ironcurtain \
  --admin-password <password> \
  --storage-uri <blob-url>
```

### Replay Backups

Replays are stored in Azure Blob Storage with built-in redundancy (LRS/GRS).

### Disaster Recovery

- **RTO:** 15 minutes (restore from backup + redeploy)
- **RPO:** 5 minutes (database transaction log backups)

---

## Updating Production

```bash
# Build new image
docker build -t ironcurtain.azurecr.io/arena:v2 ./arena
docker push ironcurtain.azurecr.io/arena:v2

# Update Container App
az containerapp update \
  --name arena \
  --resource-group ironcurtain-prod \
  --image ironcurtain.azurecr.io/arena:v2

# Rollback if needed
az containerapp revision list \
  --name arena \
  --resource-group ironcurtain-prod

az containerapp revision activate \
  --name arena \
  --resource-group ironcurtain-prod \
  --revision <previous-revision>
```

---

## Support

- **Documentation:** [docs/](../docs/)
- **Issues:** [github.com/jediswimmer/ironcurtain/issues](https://github.com/jediswimmer/ironcurtain/issues)
- **Discord:** [discord.gg/ironcurtain](https://discord.gg/ironcurtain)

---

**Version:** 1.0  
**Last Updated:** 2026-02-17
