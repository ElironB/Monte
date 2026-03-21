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
│ 5 Extractors + semantic extractor → BehavioralSignal[]  │
│ ContradictionDetector → contradiction graph             │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 3. PERSONA CONSTRUCTION (GraphRAG → Neo4j)               │
│ Signal embeddings + cosine similarity → 6 dimensions    │
│ GraphBuilder → Master Persona → 1,000 stratified clones │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 4. SIMULATION ENGINE                                     │
│ Decision Graph + World Agents + LLM Fork Evaluator      │
│ Chaos Injector + Batch Orchestrator (OpenAI SDK)        │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 5. RESULTS + NARRATIVE LAYER                             │
│ Probability distributions → NarrativeGenerator (LLM)    │
│ → monte report (markdown) → monte compare (A/B)        │
└─────────────────────────────────────────────────────────┘
```

---

## Recent Changes (Open Source Refactoring)

The first four changes were merged into main in March 2026. They reshape Monte from a cloud-first multi-user app to a self-hosted open source tool.

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

**Why**: One SDK, provider-specific env vars, simpler setup. User provides `OPENROUTER_API_KEY` or `GROQ_API_KEY`, and the system auto-resolves `baseURL` plus default models.

**What changed**:
- Replaced `groq-sdk` with `openai` package
- `src/simulation/forkEvaluator.ts` rewritten — single `OpenAI` client with provider-aware config
- `callGroq()` and `callAnthropic()` replaced with single `callLLM()` method
- `src/config/index.ts` now resolves `llm` config from `OPENROUTER_API_KEY`, `GROQ_API_KEY`, or legacy `LLM_*` env vars
- Default models: `openai/gpt-oss-20b` for standard evaluation and `openai/gpt-oss-120b` for reasoning
- Complexity routing preserved: standard model for simple forks, reasoning model for complex ones (>0.6 complexity)
- Heuristic fallback still works when no LLM key is provided

**Provider setup**:
```
# OpenRouter (recommended)
OPENROUTER_API_KEY=sk-or-...
# → auto-sets: baseURL=openrouter, model=openai/gpt-oss-20b, reasoning=openai/gpt-oss-120b

# Groq
GROQ_API_KEY=gsk_...
# → auto-sets: baseURL=groq, model=openai/gpt-oss-20b, reasoning=openai/gpt-oss-120b
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

### 5. Signal Extraction Upgrade (PR #7)

**Why**: Boolean regex ("does keyword X exist?") wasn't enough. Need quantitative signals for accurate persona construction.

**What changed**:
- All 5 extractors (`searchHistory`, `socialBehavior`, `financialBehavior`, `cognitiveStructure`, `mediaConsumption`) upgraded to quantitative analysis
- New shared `src/ingestion/extractors/temporalUtils.ts` module: `analyzeTemporalPatterns()`, `calculateRecurrence()`, `detectTrend()`
- Each extractor now produces: frequency counts, temporal patterns (time-of-day/day-of-week clustering), recurrence scores, co-occurrence tracking, intensity trends
- `DimensionMapper` upgraded with `getSignalStrength()` that factors frequency/recurrence/trend into dimension scoring
- 35+ unit tests covering quantitative behavior

### 6. LLM Narrative Generation (PR #8)

**Why**: Users need to understand simulation results in plain English, not just probability numbers.

**What changed**:
- New `src/simulation/narrativeGenerator.ts` — `NarrativeGenerator` class
- Produces 6-section analysis: executive summary, outcome analysis, behavioral drivers, risk factors, contradiction insights, recommendation
- Uses same OpenAI SDK client (configurable `baseURL`), temperature 0.7, single LLM call
- Rich template-based fallback when no `LLM_API_KEY` is set
- Wired into simulation results API via `?narrative=true` query param on `/simulation/:id/results`

### 7. `monte report` Command (PR #9)

**Why**: Polished markdown output for sharing/archiving simulation results.

**What changed**:
- New `src/cli/commands/report.ts`
- ASCII bar charts, metrics tables, behavioral profile visualization
- Outcome distribution with stratified breakdown by clone category
- Integrates narrative sections from `NarrativeGenerator` when available
- Options: `-o <path>` (output file), `--no-narrative` (skip LLM), `--stdout` (print to terminal)

### 8. `monte generate` Command (PR #10)

**Why**: No real data needed to demo or test. Generate realistic personas from text descriptions.

**What changed**:
- New `src/cli/commands/generate.ts` + `src/persona/syntheticGenerator.ts`
- Natural language description → 5 data files: `search-history.json`, `reddit-posts.json`, `transactions.csv`, `watch-history.json`, `notes/reflections.md`
- 5 parallel LLM calls with retry logic and JSON response parsing
- Generated files match exact ingestion detection formats (auto-detected by `monte ingest`)
- Options: `-o <dir>` (output directory), `--entries <n>` (data points per file), `--timespan <months>`

### 9. `monte compare` Command (PR #11)

**Why**: A/B testing proves personalization works. Show two different personas produce different outcomes.

**What changed**:
- New `src/cli/commands/compare.ts`
- Runs full pipeline (ingest → persona → simulate) for both personas sequentially (handles single-user limitation)
- Side-by-side behavioral profiles, outcome deltas, divergent signal detection
- LLM-generated divergence explanation
- Options: `-s <scenario>`, `-c <clones>`, `-o <path>`, `--no-narrative`, `--stdout`

### 10. Base Rate Registry (PR #13)

**Why**: Hardcoded probability constants with no citations look made-up. A registry with ESMA/BLS/NCES sources says "we did the research."

**What changed**:
- New `src/simulation/baseRateRegistry.ts` — 15+ cited empirical base rates
- Sources: ESMA retail trader study (280k sample), BLS Business Employment Dynamics, NCES Digest of Education Statistics, Case-Shiller Index, AACSB, CIRR
- Query interface: `getBaseRate(scenario, metric, conditions?)`, `getScenarioRates()`, `getDomainRates()`
- `applyPersonaModulation()` — shifts base rate by persona score within ±8% bounds
- World agents (financial, career, education) refactored to query registry instead of inline constants
- `HISTORICAL_DATA` in `base.ts` marked deprecated, backed by registry values

### 11. Kelly Criterion Position Sizing (PR #14)

**Why**: Makes Monte's output actionable — not just "what will happen" but "how much to commit."

**What changed**:
- New `src/simulation/kellyCalculator.ts` — full Kelly with fractional adjustment
- Computed from actual simulation data: success probability from outcome distribution, net odds from mean gain/loss across clones
- Fractional Kelly scaled by loss aversion (derived from `1 - riskTolerance`)
- High risk tolerance → half Kelly, low → quarter Kelly
- Warnings for negative Kelly (negative EV) and >100% Kelly (extreme variance)
- Wired into simulation results when `capitalAtRisk` is provided
- CLI: `--capital-at-risk` flag on `monte simulate run`
- Included in `monte report` output as "Position Sizing" section

### 12. Bayesian Incremental Persona Updates (PR #15)

**Why**: Rebuilding the entire persona from scratch every time destroys evidence accumulation. A belief corroborated by 3 sources across 3 ingestions should carry higher confidence.

**What changed**:
- New `src/persona/bayesianUpdater.ts` — `BayesianUpdater` class
- `processPersona` now branches: first build = full pipeline, subsequent builds = incremental Bayesian update
- Incremental path: fetches only NEW signals (not linked to any persona), runs Bayes' theorem on each dimension
- Evidence classification: corroborating (delta < 0.1), contradicting (delta > 0.3), neutral
- Confidence capped at 0.05–0.95 (no belief is ever certain)
- New evidence caps at 40% influence per update (blend weight)
- Update history tracked on Trait nodes for auditability
- Low confidence flagging when posterior < 0.2 after 3+ evidence updates
- Clone regeneration happens after every update (traits change → clones must reflect them)


### 13. Embedding-based signal semantics

**Why**: Keyword matching missed semantically equivalent signals whenever the vocabulary shifted.

**What changed**:
- New `src/embeddings/embeddingService.ts` wraps OpenAI-compatible embeddings with Redis caching
- New `src/embeddings/dimensionConcepts.ts` stores rich high/low pole descriptions for each behavioral dimension
- During ingestion, each `Signal` is embedded and stored on the Neo4j node as `s.embedding`
- `DimensionMapper` and `BayesianUpdater` now compare signal vectors to dimension concept vectors with cosine similarity
- Neo4j creates a native `signal_embedding` vector index on `Signal.embedding`
- OpenRouter is the default embeddings provider; Groq-only LLM setups must also supply `OPENROUTER_API_KEY` or `EMBEDDING_API_KEY`

### 14. P0 Fix: Timestamp Propagation (PR #28)

**Why**: `createSignal()` in `base.ts` defaulted to `new Date().toISOString()` — extraction time, not event time. This meant batch-ingested data from 6 months ago got today's timestamp, completely breaking recency decay in `DimensionMapper`.

**What changed**:
- `base.ts` `createSignal()` now accepts an optional `timestamp` parameter as the 7th argument
- All 5 extractors updated to pass original event timestamps through to `createSignal()`
- `SearchHistoryExtractor`: passes parsed `entry.timestamp` via `getLatestTimestamp()`
- `SocialBehaviorExtractor`: passes `post.timestamp` from parsed social posts
- `FinancialBehaviorExtractor`: passes `transaction.date` from CSV rows
- `CognitiveStructureExtractor`: passes `data.metadata.timestamp` from file metadata
- `MediaConsumptionExtractor`: passes `entry.date` from watch history entries
- Neo4j signal write in workers/index.ts uses `signal.timestamp` instead of server time

### 15. P0 Fix: Contradictions Feed Into DimensionMapper (PR #27)

**Why**: `ContradictionDetector` found contradictions and stored them in Neo4j, but `DimensionMapper` never read them. The most predictive signals in Monte's thesis ("the contradiction IS the signal") had zero influence on persona dimensions.

**What changed**:
- `SignalContradiction` type now includes `magnitude` (0-1, computed from cosine distance) and `affectedDimensions` (which dimensions the contradiction impacts)
- `ContradictionDetector.detect()` now computes magnitude from embedding cosine distance and identifies affected dimensions via concept similarity
- `DimensionMapper` constructor accepts optional `contradictions` array
- New `mapToDimensionsWithContradictions()` method returns both dimension values and per-dimension contradiction penalties
- Contradiction effect: pulls affected dimensions toward 0.5 proportional to magnitude (high contradiction = less certain)
- Signal bias: revealed-side signals get weight boost (up to 1.75x), stated-side signals get penalty (down to 0.5x)
- Neo4j Contradiction nodes store explicit `statedSignalId` and `revealedSignalId` (fixes a bug where lexical ID ordering destroyed role assignment)
- Worker pipeline: fetches contradictions from Neo4j and passes them to DimensionMapper

### 16. AI Chat History Extractor (SCO-034 — In Progress)

**Why**: Past conversations with ChatGPT, Claude, Gemini, and Grok are a rich "Revealed Cognition" data source. What someone privately asks an AI at 2am reveals more about their decision-making than any survey.

**What's being added**:
- New source type `ai_chat` added to types.ts, API Zod schema, CLI auto-detection, and worker registration
- New `AIChatHistoryExtractor` in `src/ingestion/extractors/aiChatHistory.ts`
- Parses 4 export formats: ChatGPT (`conversations.json` with mapping tree), Claude (`conversations.json` with `chat_messages`), Gemini (Google Takeout `MyActivity.json`), Grok (xAI data portal export)
- Extracts user messages only (ignores AI responses)
- 5 signal categories: topic classification (8 domains), emotional tone, decision delegation patterns, repetition/revisiting detection, prompting style analysis
- Source reliability tier: ~0.75-0.80 (between Revealed Preference and Semi-Curated — it's private but the user knows they're talking to AI)

---

## Persona Pipeline: Audit Roadmap

A deep technical audit identified 6 fatal flaws in the persona construction pipeline. P0 items are fixed. Remaining work is prioritized below.

### ✅ P0 — COMPLETED
- **Timestamp propagation** (PR #28): Extractors now pass original event timestamps, not extraction time
- **Contradictions → DimensionMapper** (PR #27): Contradictions now influence persona dimensions with magnitude-weighted bias

### P1 — High Priority (Next)
| Change | Effort | Description |
|--------|--------|-------------|
| Add 3 new dimensions | Large | `executionGap` (plan vs action gap), `informationSeeking` (over-research vs minimal-info action), `stressResponse` (panic vs steady) |
| Source reliability weighting | Medium | Tier system: Plaid (0.95) > YouTube completion (0.80) > Search (0.75) > Reddit posts (0.60) > Twitter (0.40) |
| Multi-anchor concept descriptions | Medium | Replace keyword lists with 3-5 contextual sentences per pole + negative anchors as relevance gate |
| Per-dimension confidence intervals | Medium | Track signal count, source diversity, and communicate uncertainty to simulation engine |

### P2 — Medium Priority
| Change | Effort | Description |
|--------|--------|-------------|
| Temporal-aware embeddings | Small | Prepend `[late_night, weekend]` context before embedding — same content at 3am vs 2pm produces different vectors |
| Adaptive recency decay | Small | Different half-lives per source: Plaid 180d, search 30d, social 45d, notes 120d, watch 21d |
| Sequential pattern detection | Large | Sliding windows (24h/72h/7d/30d), research cluster detection, decision trajectory mapping |
| Contradiction magnitude + convergence | Medium | Track whether contradictions are resolving or deepening; persistent contradictions are stable personality features |

### P3 — Lower Priority
| Change | Effort | Description |
|--------|--------|-------------|
| Cycle detection | Medium | Autocorrelation at 7/14/30/90 day periods to detect recurring behavioral patterns |
| Drift detection | Large | Sliding window comparison (90-day vs full history), automatic strategy selection (incremental vs full rebuild) |
| Benchmark suite | Large | Split-half reliability (r > 0.7), cross-source coherence, discriminability index (d' > 1.5) |
| Behavioral epoch detection | Large | Changepoint detection to partition signal history into behavioral eras |

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

### ✅ PHASE 6 - Platform Connections (COMPLETE)
- Interactive `monte connect` command with multi-select platform picker
- Composio OAuth integration for: Google, Reddit, Spotify, GitHub, Notion, Slack, LinkedIn, Twitter
- `monte connect confirm` to verify connections
- Connection status tracking in `~/.monte/connections.json`
- Optional — file-based ingestion (`monte ingest <dir>`) still works independently
- Requires `COMPOSIO_API_KEY` (free at composio.dev)

### ✅ PHASE 7 - YC Readiness Features (COMPLETE)
- **Signal extraction upgrade** (PR #7): All 5 extractors upgraded from boolean regex to quantitative analysis
  - Frequency counting, temporal pattern detection (time-of-day, day-of-week clustering)
  - Recurrence scoring, co-occurrence tracking, intensity trend analysis
  - New shared `temporalUtils.ts` module with `analyzeTemporalPatterns()`, `calculateRecurrence()`, `detectTrend()`
  - DimensionMapper upgraded with `getSignalStrength()` factoring frequency/recurrence/trend
  - 35+ unit tests covering quantitative behavior
- **LLM narrative generation** (PR #8): `NarrativeGenerator` class producing 6-section natural language analysis
  - Executive summary, outcome analysis, behavioral drivers, risk factors, contradiction insights, recommendation
  - Uses same OpenAI SDK client (configurable baseURL), temperature 0.7, single call
  - Rich template-based fallback when no LLM key is set
  - Wired into simulation results API via `?narrative=true` query param
- **`monte report` command** (PR #9): Polished markdown report generation
  - ASCII bar charts, metrics tables, behavioral profile visualization
  - Outcome distribution with stratified breakdown by clone category
  - Integrates narrative sections when available
  - Options: `-o <path>`, `--no-narrative`, `--stdout`
- **`monte generate` command** (PR #10): LLM-powered synthetic persona generation
  - Natural language input → 5 data files (search-history.json, reddit-posts.json, transactions.csv, watch-history.json, notes/reflections.md)
  - 5 parallel LLM calls with retry logic and response parsing
  - Generated files match exact ingestion detection formats
  - Options: `-o <dir>`, `--entries <n>`, `--timespan <months>`
- **`monte compare` command** (PR #11): A/B persona comparison
  - Runs full pipeline for both personas sequentially (handles single-user limitation)
  - Side-by-side behavioral profiles, outcome deltas, divergent signal detection
  - LLM-generated divergence explanation
  - Options: `-s <scenario>`, `-c <clones>`, `-o <path>`, `--no-narrative`, `--stdout`

### ✅ PHASE 8 - Decision Theory (COMPLETE)
- **Base Rate Registry**: 15+ empirically-cited base rates (ESMA, BLS, NCES, Case-Shiller) with query interface and persona modulation
- **Kelly Criterion**: Position sizing from actual simulation data, fractional Kelly adjusted by behavioral risk tolerance
- **Bayesian Updates**: Incremental persona refinement — evidence accumulates across ingestions instead of full rebuild

### 🔄 PHASE 9 - Persona Pipeline Hardening (IN PROGRESS)
- **P0 fixes complete**: Timestamp propagation (PR #28), contradictions feeding into DimensionMapper (PR #27)
- **AI chat history extractor** (SCO-034): New `ai_chat` source type for ChatGPT/Claude/Gemini/Grok exports
- **Pending**: P1 items (new dimensions, source reliability, multi-anchor concepts, confidence intervals)

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
│   │   │   ├── aiChatHistory.ts   # AI chat exports (ChatGPT, Claude, Gemini, Grok)
│   │   │   ├── searchHistory.ts
│   │   │   ├── socialBehavior.ts
│   │   │   ├── financialBehavior.ts
│   │   │   ├── cognitiveStructure.ts
│   │   │   ├── mediaConsumption.ts
│   │   │   ├── semanticExtractor.ts  # LLM-based fallback extraction
│   │   │   └── temporalUtils.ts   # Shared temporal analysis utilities
│   │   └── queue/
│   │       ├── ingestionQueue.ts  # BullMQ queues
│   │       └── workers/
│   │           └── index.ts       # Ingestion + persona + simulation workers
│   ├── persona/
│   │   ├── dimensionMapper.ts     # 6 behavioral dimensions
│   │   ├── graphBuilder.ts        # Neo4j graph writes
│   │   ├── personaCompressor.ts   # Master persona generation
│   │   ├── cloneGenerator.ts      # 1000 stratified clones
│   │   ├── bayesianUpdater.ts     # Incremental persona updates via Bayes
│   │   └── syntheticGenerator.ts  # LLM synthetic persona data generation
│   ├── simulation/
│   │   ├── types.ts               # All simulation types
│   │   ├── decisionGraph.ts       # 8 scenario definitions
│   │   ├── engine.ts              # SimulationEngine class
│   │   ├── baseRateRegistry.ts    # Empirical base rates with citations
│   │   ├── forkEvaluator.ts       # OpenAI SDK, configurable baseURL
│   │   ├── kellyCalculator.ts     # Kelly criterion position sizing
│   │   ├── chaosInjector.ts       # Black swan events
│   │   ├── resultAggregator.ts    # Distribution calculation
│   │   ├── narrativeGenerator.ts  # LLM narrative analysis for results
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
│   │       ├── compare.ts         # monte compare (A/B persona comparison)
│   │       ├── generate.ts        # monte generate (synthetic persona generation)
│   │       ├── report.ts          # monte report (markdown report generation)
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

### 2. LLM via OpenAI SDK + provider-specific env vars
One `openai` package under the hood. Users set `OPENROUTER_API_KEY` or `GROQ_API_KEY` — the system auto-resolves the baseURL. Default models: `openai/gpt-oss-20b` (standard) and `openai/gpt-oss-120b` (reasoning/complex forks). Legacy `LLM_API_KEY` + `LLM_BASE_URL` still works but isn't documented.

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

### 8. Signal Extraction is Quantitative
Extractors parse structured data (JSON entries, CSV rows) to count frequencies, detect temporal patterns, and track trends. Not just "does keyword X exist" — measures "how often, when, and is it increasing." Shared `temporalUtils.ts` module provides `analyzeTemporalPatterns()`, `calculateRecurrence()`, `detectTrend()` across all 5 extractors.

### 9. Persona mapping is embedding-based
Signals are embedded with `openai/text-embedding-3-small`, stored on Neo4j `Signal` nodes, and compared against rich dimension concept embeddings with cosine similarity. No keyword fallback in `DimensionMapper` or `BayesianUpdater`; if embeddings are unavailable, persona builds should fail fast with a clear configuration error.

### 10. Output is Natural Language
Simulation results are interpreted by `NarrativeGenerator` into 6-section narrative analysis. Users get "your impulsive spending patterns suggest..." not just "success: 34.2%". Works with any OpenAI-compatible LLM, falls back to rich templates when no key is set.

### 11. Synthetic Personas for Testing
`monte generate` creates realistic behavioral data from a text description. No real data needed to demo or test. Generated files match exact ingestion formats.

### 12. AI Chat History is "Revealed Cognition"
What someone asks an AI privately at 2am is categorically different from what they post publicly. The `ai_chat` source type handles exports from ChatGPT, Claude, Gemini, and Grok — extracting topic interests, emotional tone, decision delegation patterns, and repetition/revisiting behavior from user messages only. AI responses are ignored.

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

# LLM (required)
OPENROUTER_API_KEY=             # Recommended: one key for LLM + embeddings
# OR
GROQ_API_KEY=                   # Groq fast inference for chat completions only
# Optional overrides:
LLM_MODEL=openai/gpt-oss-20b   # Default standard model
LLM_REASONING_MODEL=openai/gpt-oss-120b  # Default reasoning model

# Embeddings (required unless OPENROUTER_API_KEY is set)
# EMBEDDING_API_KEY=
# EMBEDDING_BASE_URL=https://openrouter.ai/api/v1
# EMBEDDING_MODEL=openai/text-embedding-3-small

# Optional
COMPOSIO_API_KEY=               # Enables `monte connect` OAuth platform integrations via Composio
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
OTEL_ENABLED=false
```

**No auth env vars needed.** No `JWT_SECRET`, no `REFRESH_TOKEN_SECRET`, no `API_KEY_SALT`.

---

## CLI Reference

```bash
# Generate synthetic personas (no real data needed)
monte generate "<description>"    # Create test persona from natural language
monte generate "..." -o ./out     # Custom output directory
monte generate "..." --entries 100 --timespan 12

# Compare personas (A/B testing)
monte compare <dir-a> <dir-b> -s <scenario>
monte compare ./a ./b -s day_trading -o comparison.md

# Reports
monte report <id>                 # Generate markdown report with narrative
monte report <id> --no-narrative  # Data-only report
monte report <id> --stdout        # Print to terminal

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
monte simulate delete <id> --force          # Delete simulation

# Config
monte config show                 # Show current config
monte config set-api <url>        # Change API endpoint
monte config set-defaults -s day_trading -c 1000
monte config dir                  # Show config directory
```

---

## Quick Start

```bash
cd /home/Monte
cp .env.example .env
# Edit .env — set NEO4J_PASSWORD and OPENROUTER_API_KEY, or use GROQ_API_KEY plus EMBEDDING_API_KEY for Groq-only setups
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

1. **Signal extraction is quantitative** — regex/pattern matching upgraded to frequency counting, temporal detection, trend analysis. LLM used for fork evaluation, narrative generation, and synthetic persona generation.
2. **Clones are parameter variants** — same structure, different values on 6 dimensions. NOT different personalities.
3. **World agents must use empirical data** — historical returns, base rates from research. NOT made-up numbers.
4. **Contradictions are IMPORTANT** — revealed vs stated behavior discrepancies drive simulation accuracy.
5. **Simulation returns distributions** — always histograms/probabilities, never single numbers.
6. **No auth in open source** — `request.user.userId` is always `local-user`. Don't add auth back unless building the cloud version.
7. **LLM is provider-aware but SDK-agnostic** — OpenAI SDK with provider-specific env vars (`OPENROUTER_API_KEY` / `GROQ_API_KEY`). Never import provider-specific SDKs.
8. **TypeScript errors** — use `// @ts-nocheck` sparingly if ioredis types cause issues (already used in redis.ts).
9. **Composio is optional** — `monte connect` enhances data but isn't required. File-based ingestion works standalone.
10. **AI chat data is user-messages-only** — never analyze AI responses. The behavioral signal is what the human asked, not what the AI said.
11. **Contradictions now have magnitude** — `SignalContradiction.magnitude` (0-1) computed from embedding cosine distance. Stored on Neo4j Contradiction nodes with explicit `statedSignalId`/`revealedSignalId`.

---

**Last Updated**: March 2026 — Persona pipeline P0 fixes complete, AI chat extractor added
**Status**: Phases 1-8 complete. Phase 9 (persona hardening) in progress.
**Next**: P1 pipeline improvements (new dimensions, source reliability, multi-anchor concepts).
