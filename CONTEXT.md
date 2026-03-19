# Monte Engine - Agent Handoff Context

> **CRITICAL**: Read this before making ANY changes. This document contains the product strategy, architectural decisions, phase status, and what was recently changed.

---

## What Is Monte Engine?

**Monte Engine** is an open-source, self-hostable probabilistic life simulation platform.

### Core Philosophy

- **NOT an oracle** - does not predict the future
- **Flight simulator for life decisions** - stress-tests behavioral tendencies against empirically-grounded world models
- **Returns probability distributions** - not single-point predictions
- **Based on revealed behavioral data** - not self-reported preferences

### Use Cases

1. Individual decision support (quit job? start business? move cities?)
2. LLM agent decision layer - agents call Monte instead of internal reasoning
3. Autonomous agent safety - run simulation before high-stakes actions
4. Research - behavioral patterns at scale

---

## Product Strategy

### Two-phase approach:

1. **Open Source (NOW)** — Self-hosted, single-user. `docker compose up`, everything runs locally. User owns their data, runs simulations on their machine. No cloud dependency for core functionality.

2. **Cloud Version (LATER)** — Hosted API at something like `api.monte.dev`. Users `npm i -g monte`, run `monte login`, and hit hosted infra. Same CLI, different endpoint. Like Resend, Firecrawl, Supabase CLI model.

### Current focus: Ship open source v1

The CLI is already structured for both — `monte config set-api` switches between `localhost:3000` and a future cloud URL. But right now, everything must work self-hosted with zero cloud dependencies.

### What belongs in open source vs cloud:

| Feature | Open Source | Cloud |
|---------|------------|-------|
| Auth system | No auth (local user) | JWT + API keys + multi-user |
| Data ingestion | `monte ingest <dir>` + `monte connect` (Composio) | OAuth connectors via Composio (managed) |
| LLM provider | User provides own key (any OpenAI-compatible) | Managed LLM routing |
| Infrastructure | Docker Compose (Neo4j, Redis, MinIO) | Managed services |
| CLI | Points to localhost | Points to hosted API |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ 1. DATA INGESTION LAYER                                  │
│ CLI: monte ingest <dir> → recursive scan → auto-detect  │
│ API: POST /ingestion/upload → MinIO → BullMQ queue      │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 2. SIGNAL EXTRACTION + CONTRADICTION DETECTION           │
│ 5 Extractors (regex/pattern) → BehavioralSignal[]       │
│ ContradictionDetector → stated vs revealed conflicts    │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 3. PERSONA CONSTRUCTION (GraphRAG → Neo4j)               │
│ DimensionMapper → 6 dimensions → GraphBuilder            │
│ PersonaCompressor → Master Persona                      │
│ CloneGenerator → 1,000 stratified clones                │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 4. SIMULATION ENGINE                                     │
│ Decision Graph + World Agents + LLM Fork Evaluator      │
│ Chaos Injector + Batch Orchestrator (OpenAI SDK)        │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 5. RESULTS LAYER                                         │
│ Probability distributions → API + CLI output            │
└─────────────────────────────────────────────────────────┘
```

---

## Recent Changes (Open Source Refactoring)

These three changes were merged into main in March 2026. They reshape Monte from a cloud-first multi-user app to a self-hosted open source tool.

### 1. Auth System Removed (PR #2)

**Why**: Self-hosted single-user tool doesn't need login.

**What changed**:
- Auth middleware (`src/api/plugins/auth.ts`) is now a passthrough — injects fixed `local-user` ID into every request
- Local user auto-created in Neo4j on server startup (`src/index.ts`)
- Deleted: `src/api/routes/auth.ts`, `src/api/plugins/apiKey.ts`, `src/api/routes/apikeys.ts`, `src/cli/commands/auth.ts`
- Removed: `bcrypt`, `jsonwebtoken` dependencies
- Removed: `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `API_KEY_SALT` env vars
- CLI no longer has `monte auth *` commands
- All `requireAuth()` calls removed from CLI commands
- `request.user.userId` pattern preserved — every route still gets a user context, it's just always the local user

### 2. LLM Unified on OpenAI SDK (PR #3)

**Why**: One SDK, any provider. User provides API key + base URL for whatever they use.

**What changed**:
- Replaced `groq-sdk` with `openai` package
- `src/simulation/forkEvaluator.ts` rewritten — single `OpenAI` client with configurable `baseURL`
- `callGroq()` and `callAnthropic()` replaced with single `callLLM()` method
- `src/config/index.ts` — `groq`/`anthropic` config replaced with unified `llm` block
- New env vars: `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_REASONING_MODEL`
- Old env vars removed: `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- Complexity routing preserved: standard model for simple forks, optional reasoning model for complex ones (>0.6 complexity)
- Heuristic fallback still works when no LLM key provided

**Provider examples**:
```
# Groq
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.1-70b-versatile

# OpenRouter (single key for everything)
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=meta-llama/llama-3.1-70b-instruct

# OpenAI
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

### 3. Directory-Based Ingestion (PR #4)

**Why**: Users dump files in a folder and run one command. No manual source registration.

**What changed**:
- `src/cli/commands/ingestion.ts` rewritten — `monte ingest <path>` recursively scans directories
- Auto-detects source type by extension + content peeking:
  - `.md`, `.txt` → `notes`
  - `.json` → inspects content: `search_history`, `watch_history`, `social_media`, `financial`, or `files`
  - `.csv` → checks headers for financial keywords, otherwise `files`
  - `.pdf`, `.docx`, images → `files`
- Skips hidden files, `node_modules`, `.git`, etc.
- Groups files by detected type, uploads in batches of 10
- `src/api/routes/ingestion.ts` — accepts all extractor sourceTypes + optional `sourceType` in upload
- Removed: `monte ingest add` and `monte ingest upload` commands
- Kept: `monte ingest status`, `monte ingest list`, `monte ingest delete`

### 4. Composio Platform Connections

**Why**: Users can optionally connect live platforms (Google, Reddit, Spotify, etc.) via Composio OAuth for richer data.

**What's new**:
- `monte connect` — interactive multi-select of platforms, generates OAuth links
- `monte connect confirm` — verifies all pending connections are active
- `monte connect status` — shows currently connected platforms
- Uses Composio CLI (`composio link <app> --no-wait`) under the hood
- Connections stored in `~/.monte/connections.json`
- Completely optional — users can skip and only use `monte ingest <dir>` for file-based data

---

## Implementation Status

### ✅ PHASE 1 - Core Infrastructure (COMPLETE)
- Fastify API with passthrough auth (no login, auto-creates local user)
- Neo4j 5.x, Redis 7, MinIO (S3-compatible), BullMQ job queues
- Docker Compose for all services
- Rate limiting, Swagger docs at `/docs`

### ✅ PHASE 2 - Ingestion Layer (COMPLETE)
- 5 signal extractors (regex/pattern-based, no LLM cost):
  1. `SearchHistoryExtractor` — finance, career, education, relocation, health intent
  2. `SocialBehaviorExtractor` — risk tolerance, anxiety, decision paralysis
  3. `FinancialBehaviorExtractor` — impulse spending, budget struggles, investment
  4. `CognitiveStructureExtractor` — organization, goal-setting, self-reflection
  5. `MediaConsumptionExtractor` — educational bias, binge patterns
- `ContradictionDetector` — stated vs revealed, temporal, cross-domain
- Composio SDK client (placeholder — not functional, for future cloud version)

### ✅ PHASE 3 - Persona Construction (COMPLETE)
- `DimensionMapper` — 6 behavioral dimensions with recency weighting
- `GraphBuilder` — Neo4j graph with Trait nodes, Memory nodes, relationships
- `PersonaCompressor` — master persona with narrative summary
- `CloneGenerator` — 1,000 stratified clones (10% edge, 20% outlier, 70% typical)

### ✅ PHASE 4 - Simulation Engine (COMPLETE)
- 8 decision graph scenarios (day_trading, startup, career_change, etc.)
- 4 World Agents with empirical data (Financial, Career, Education, Social)
- LLM Fork Evaluator via OpenAI SDK (any provider via baseURL)
- Chaos Injector (black swan events)
- Batch Orchestrator (1000 clones in parallel batches of 100)
- Result Aggregator (histograms, outcome distributions, stratified breakdown)

### ✅ PHASE 5 - CLI & API Polish (COMPLETE)
- SSE streaming for simulation progress
- OpenTelemetry tracing with Jaeger
- Full `monte` CLI: `ingest`, `persona`, `simulate`, `config`
- Directory-based ingestion (`monte ingest <dir>`)
- Pagination, filtering, caching on list endpoints

### 🔄 PHASE 6 - Platform Connections (IN PROGRESS)
- Interactive `monte connect` command with multi-select platform picker
- Composio OAuth integration for: Google, Reddit, Spotify, GitHub, Notion, Slack, LinkedIn, Twitter
- `monte connect confirm` to verify connections
- Connection status tracking in `~/.monte/connections.json`
- Optional — file-based ingestion (`monte ingest <dir>`) still works independently
- Requires `COMPOSIO_API_KEY` (free at composio.dev)

---

## File Structure

```
Monte/
├── src/
│   ├── index.ts                    # Fastify bootstrap + local user creation
│   ├── api/
│   │   ├── plugins/
│   │   │   ├── auth.ts            # Passthrough auth (injects local-user)
│   │   │   ├── rateLimit.ts       # Rate limiting
│   │   │   └── schema.ts          # Swagger/OpenAPI
│   │   └── routes/
│   │       ├── users.ts           # User CRUD
│   │       ├── health.ts          # Health checks
│   │       ├── ingestion.ts       # Data sources + file upload
│   │       ├── persona.ts         # Build/manage personas
│   │       ├── simulation.ts      # Run simulations
│   │       ├── cli.ts             # CLI-optimized endpoints
│   │       └── stream.ts          # SSE streaming
│   ├── config/
│   │   ├── index.ts               # Env validation (Zod) — no auth config
│   │   ├── neo4j.ts               # Neo4j driver
│   │   ├── neo4j-schema.ts        # Constraints/indexes
│   │   ├── redis.ts               # Redis client
│   │   ├── minio.ts               # MinIO client
│   │   └── tracing.ts             # OpenTelemetry setup
│   ├── ingestion/
│   │   ├── types.ts               # RawSourceData, BehavioralSignal
│   │   ├── contradictionDetector.ts
│   │   ├── composio/
│   │   │   └── client.ts          # Placeholder (not functional)
│   │   ├── extractors/
│   │   │   ├── base.ts            # Abstract extractor
│   │   │   ├── searchHistory.ts
│   │   │   ├── socialBehavior.ts
│   │   │   ├── financialBehavior.ts
│   │   │   ├── cognitiveStructure.ts
│   │   │   └── mediaConsumption.ts
│   │   └── queue/
│   │       ├── ingestionQueue.ts  # BullMQ queues
│   │       └── workers/
│   │           └── index.ts       # Ingestion + persona + simulation workers
│   ├── persona/
│   │   ├── dimensionMapper.ts     # 6 behavioral dimensions
│   │   ├── graphBuilder.ts        # Neo4j graph writes
│   │   ├── personaCompressor.ts   # Master persona generation
│   │   └── cloneGenerator.ts      # 1000 stratified clones
│   ├── simulation/
│   │   ├── types.ts               # All simulation types
│   │   ├── decisionGraph.ts       # 8 scenario definitions
│   │   ├── engine.ts              # SimulationEngine class
│   │   ├── forkEvaluator.ts       # OpenAI SDK, configurable baseURL
│   │   ├── chaosInjector.ts       # Black swan events
│   │   ├── resultAggregator.ts    # Distribution calculation
│   │   └── worldAgents/
│   │       ├── base.ts            # Base agent + S&P 500/BLS data
│   │       ├── financial.ts       # Market returns, inflation
│   │       ├── career.ts          # Job market, burnout
│   │       ├── education.ts       # Completion rates, ROI
│   │       └── social.ts          # Network effects
│   ├── cli/
│   │   ├── index.ts               # Commander.js entry point
│   │   ├── api.ts                 # API client (no auth headers)
│   │   ├── config.ts              # ~/.monte config (no auth storage)
│   │   └── commands/
│   │       ├── connect.ts         # monte connect (Composio platform linking)
│   │       ├── ingestion.ts       # monte ingest <dir>, status, list, delete
│   │       ├── persona.ts         # monte persona status/build/history/traits
│   │       ├── simulation.ts      # monte simulate run/list/progress/results
│   │       └── config.ts          # monte config show/set-api/set-defaults
│   └── utils/
│       ├── logger.ts              # Pino logging
│       └── errors.ts              # Error classes
├── tests/
├── docs/
│   └── monte.txt                  # Full PRD (read for product context)
├── docker-compose.yml             # Neo4j, Redis, MinIO, API
├── Dockerfile                     # Multi-stage Node.js build
├── package.json                   # Dependencies (openai, NOT groq-sdk)
├── tsconfig.json                  # TypeScript config
└── .env.example                   # Template (no auth vars)
```

### Files that NO LONGER EXIST (deleted in open source refactoring):
- `src/api/routes/auth.ts` — register/login/refresh/me endpoints
- `src/api/plugins/apiKey.ts` — API key auth plugin
- `src/api/routes/apikeys.ts` — API key management
- `src/cli/commands/auth.ts` — CLI auth commands

---

## Key Design Decisions

### 1. No Authentication (Self-Hosted)
Single local user (`local-user`) auto-created on startup. Auth plugin is a passthrough. `request.user.userId` pattern preserved for Neo4j query isolation — makes it easy to add multi-user auth back for the cloud version.

### 2. LLM via OpenAI SDK + configurable baseURL
One `openai` package, swap providers by changing `LLM_BASE_URL`. No provider-specific SDKs. Complexity routing: standard model for simple forks, optional reasoning model for complex ones (>0.6 score). Heuristic fallback when no LLM key.

### 3. File-Based Data Ingestion
`monte ingest <dir>` — recursive scan, auto-detect source types. No OAuth connectors for open source. Users export their data (Google Takeout, Obsidian vault, bank CSVs) and feed it in. Composio connector exists as placeholder for cloud version.

### 4. Signal Extraction is Rule-Based
Regex/pattern matching, NOT LLM. Too expensive to use LLM for extraction. LLM only used in simulation phase for fork evaluation.

### 5. Stratified Clone Sampling
1000 clones: 10% edge (5th/95th), 20% outlier (10th/90th), 70% typical (20th-80th). Internal consistency enforcement between dimensions.

### 6. World Agents Use Empirical Data
Historical S&P 500 returns, BLS job market data, education completion rates. NOT made-up numbers.

### 7. Composio for Platform Connections (Optional)
Users can optionally connect live platforms via `monte connect`. Uses Composio CLI under the hood (`composio link --no-wait`). Completely optional — `monte ingest <dir>` works without any platform connections. Requires `COMPOSIO_API_KEY` from composio.dev (free tier available).

---

## Environment Variables

```bash
# Infrastructure (required)
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password123
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# LLM (required for simulation — heuristic fallback if missing)
LLM_API_KEY=                    # Any OpenAI-compatible provider
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.1-70b-versatile
LLM_REASONING_MODEL=            # Optional: separate model for complex forks

# Optional
COMPOSIO_API_KEY=               # Optional: for platform connections (free at composio.dev)
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
OTEL_ENABLED=false
```

**No auth env vars needed.** No `JWT_SECRET`, no `REFRESH_TOKEN_SECRET`, no `API_KEY_SALT`.

---

## CLI Reference

```bash
# Connect platforms (optional)
monte connect                     # Interactive platform picker + OAuth links
monte connect confirm             # Verify pending connections
monte connect status              # Show connected platforms

# Ingest data
monte ingest ./my-data            # Scan directory, auto-detect, upload
monte ingest status               # Show all source statuses
monte ingest list                 # List data sources
monte ingest delete <id> --force  # Delete a source

# Build persona
monte persona build               # Build from ingested data
monte persona status              # Check build status
monte persona traits              # View behavioral dimensions
monte persona history             # Version history

# Run simulations
monte simulate run -s day_trading --wait    # Run and wait for results
monte simulate list                         # List all simulations
monte simulate progress <id>                # Check progress
monte simulate results <id> -f json         # Get results (table or json)
monte simulate scenarios                    # List available scenarios

# Config
monte config show                 # Show current config
monte config set-api <url>        # Change API endpoint
monte config set-defaults -s day_trading -c 1000
```

---

## Quick Start

```bash
cd /home/Monte
cp .env.example .env
# Edit .env — set NEO4J_PASSWORD, LLM_API_KEY, LLM_BASE_URL
docker-compose up -d neo4j redis minio
npm install
npm run dev
# Server at http://localhost:3000, docs at http://localhost:3000/docs
```

---

## Performance Targets (from PRD)

| Metric                | Target             |
| --------------------- | ------------------ |
| 1000-clone simulation | < 90 seconds (p95) |
| Persona build         | < 5 minutes        |
| API response          | < 200ms (p95)      |
| LLM calls per sim     | < 100              |
| Same-input variance   | < 5% outcome shift |
| Neo4j queries         | < 50ms             |
| Concurrent sims       | >= 10              |
| Cold start            | < 2 minutes        |

---

## Critical Notes

1. **Signal extraction is rule-based** (regex/pattern matching) — NOT using LLM for extraction. LLM only used for fork evaluation in simulation.
2. **Clones are parameter variants** — same structure, different values on 6 dimensions. NOT different personalities.
3. **World agents must use empirical data** — historical returns, base rates from research. NOT made-up numbers.
4. **Contradictions are IMPORTANT** — revealed vs stated behavior discrepancies drive simulation accuracy.
5. **Simulation returns distributions** — always histograms/probabilities, never single numbers.
6. **No auth in open source** — `request.user.userId` is always `local-user`. Don't add auth back unless building the cloud version.
7. **LLM is provider-agnostic** — OpenAI SDK with `baseURL`. Never import provider-specific SDKs.
8. **TypeScript errors** — use `// @ts-nocheck` sparingly if ioredis types cause issues (already used in redis.ts).
9. **Composio is optional** — `monte connect` enhances data but isn't required. File-based ingestion works standalone.

---

**Last Updated**: March 2026 — Open source refactoring complete, Composio platform connections added
**Status**: Phases 1-5 complete. Phase 6 (platform connections) in progress.
**Next**: Ship open source v1 — end-to-end testing, documentation polish, sample data files.
