# Monte Engine - Agent Handoff Context

> **CRITICAL**: Read this before making ANY changes. This document contains the architectural decisions, phase status, and design philosophy required to continue implementation correctly.

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

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ 1. DATA INGESTION LAYER                                  │
│ Multi-source connectors → RawSourceData → Signals       │
│ (Search, Social, Financial, Notes, Media)               │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 2. SIGNAL EXTRACTION + CONTRADICTION DETECTION           │
│ 5 Extractors → BehavioralSignal[] → Contradictions      │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 3. PERSONA CONSTRUCTION (GraphRAG → Neo4j)               │
│ DimensionMapper → 6 dimensions → GraphBuilder            │
│ PersonaCompressor → Master Persona                     │
│ CloneGenerator → 1,000 stratified clones               │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 4. SIMULATION ENGINE ✅ COMPLETE                         │
│ Decision Graph + World Agents + LLM Fork Evaluator      │
│ Chaos Injector + Batch Orchestrator                    │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ 5. RESULTS LAYER                                        │
│ Probability distributions → API + CLI output           │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Status

### ✅ PHASE 1 - Core Infrastructure (COMPLETE)

**Commit**: `959cbaa`

**What's Done**:

- Fastify API with JWT auth (access + refresh tokens)
- Neo4j 5.x with connection pooling
- Redis for queues and caching
- MinIO for object storage
- BullMQ for job queues (ingestion, persona, simulation)
- Docker Compose setup
- All API routes: auth, users, health, ingestion, persona, simulation, CLI
- Rate limiting, Swagger docs

**Key Files**:

- `src/index.ts` - Fastify server bootstrap
- `src/config/*` - Database connections
- `src/api/routes/*` - All API endpoints
- `src/api/plugins/*` - Auth, rate limiting, swagger

---

### ✅ PHASE 2 - Ingestion Layer (COMPLETE)

**Commit**: `9d0c2d2`

**What's Done**:

- `RawSourceData` and `BehavioralSignal` types
- 5 signal extractors:
  1. `SearchHistoryExtractor` - financial, career, education intent
  2. `SocialBehaviorExtractor` - risk tolerance, anxiety, decision paralysis
  3. `FinancialBehaviorExtractor` - impulse spending, budget struggles
  4. `CognitiveStructureExtractor` - organization level, goal-setting
  5. `MediaConsumptionExtractor` - educational bias, binge patterns
- `ContradictionDetector` - stated vs revealed, temporal, cross-domain
- Composio SDK client (placeholder)
- Real ingestion worker processing

**Key Files**:

- `src/ingestion/types.ts` - Core data types
- `src/ingestion/extractors/*.ts` - 5 extractors
- `src/ingestion/contradictionDetector.ts` - Contradiction detection
- `src/ingestion/queue/workers/index.ts` - Ingestion processing

---

### ✅ PHASE 3 - Persona Construction (COMPLETE)

**Commit**: `1809c2a`

**What's Done**:

- `DimensionMapper` - 6 behavioral dimensions with recency weighting
  - riskTolerance, timePreference, socialDependency
  - learningStyle, decisionSpeed, emotionalVolatility
- `GraphBuilder` - Neo4j graph construction
  - Trait nodes with confidence weights
  - Memory nodes
  - Relationships (CORRELATES_WITH, CONTRADICTS)
- `PersonaCompressor` - Master persona generation
  - Summary generation
  - Risk profile calculation
  - Narrative summary with contradictions
- `CloneGenerator` - 1,000 stratified clones
  - 10% edge cases (5th/95th percentile)
  - 20% outliers (10th/90th percentile)
  - 70% typical (20th-80th percentile)
  - Internal consistency enforcement

**Key Files**:

- `src/persona/dimensionMapper.ts` - Dimension scoring
- `src/persona/graphBuilder.ts` - Neo4j graph writes
- `src/persona/personaCompressor.ts` - Master persona
- `src/persona/cloneGenerator.ts` - 1000 clone generation

**How It Works**:

1. Persona build triggered via `POST /persona`
2. Queues `persona` job
3. Worker fetches all signals for user
4. `DimensionMapper` converts signals to 6 dimensions
5. `GraphBuilder` creates trait/memory nodes in Neo4j
6. `PersonaCompressor` generates narrative summary
7. `CloneGenerator` creates 1000 clones stored in Neo4j

---

### ✅ PHASE 4 - Simulation Engine (COMPLETE)

**Commit**: `0171a32`

**What's Done**:

#### 1. Decision Graph System ✅

- `src/simulation/decisionGraph.ts` - 8 complete scenarios
- Decision nodes, event nodes, outcome nodes
- day_trading, startup_founding, career_change, advanced_degree, geographic_relocation, real_estate_purchase, health_fitness_goal, custom

#### 2. World Agents (4 total) ✅

- `src/simulation/worldAgents/base.ts` - Base agent with historical data (S&P 500, BLS)
- `src/simulation/worldAgents/financial.ts` - Market returns, inflation, liquidity models
- `src/simulation/worldAgents/career.ts` - Job market, salary growth, burnout
- `src/simulation/worldAgents/education.ts` - Completion rates, ROI models
- `src/simulation/worldAgents/social.ts` - Network effects, relocation costs

#### 3. LLM Fork Evaluator ✅

- `src/simulation/forkEvaluator.ts` - Complexity scoring (0-1)
- Router: Groq (fast/cheap) vs Anthropic (complex)
- Threshold: complexity > 0.6 = Anthropic
- Max 20 Anthropic calls per simulation
- Heuristic fallback when LLM unavailable

#### 4. Chaos Injector ✅

- `src/simulation/chaosInjector.ts`
- Black swan events: medical, market crash, job loss, relationship, natural_disaster
- Behavioral trait modifiers affect probability
- Max 2 events per simulation

#### 5. Batch Orchestrator ✅

- `src/simulation/engine.ts` - SimulationEngine class
- Executes 1000 clones in parallel batches
- Real-time progress tracking via BullMQ
- `src/ingestion/queue/workers/index.ts` - `processSimulation` updated

#### 6. Result Aggregator ✅

- `src/simulation/resultAggregator.ts`
- Histogram generation for all metrics
- Outcome distributions (success/failure/neutral)
- Timeline distributions
- Stratified breakdown by clone category
- Store results in Neo4j Simulation node

**How It Works**:

1. Simulation triggered via `POST /simulation` with scenarioType
2. Queues 10 batches of 100 clones each
3. Worker fetches clones from Neo4j
4. `SimulationEngine` executes each clone through decision graph
5. `ForkEvaluator` uses LLM or heuristic for decision nodes
6. `ChaosInjector` adds random black swan events
7. World agents apply market/career/education/social effects
8. Results aggregated and stored in Neo4j
9. Final batch marks simulation as `completed`

---

### ✅ PHASE 5 - CLI & API Polish (COMPLETE)

**Commit**: `5022c77`

**What's Done**:

- SSE streaming: Real-time simulation progress via Redis pub/sub + `/stream/simulation/:id/progress` endpoint
- OpenTelemetry Tracing: Distributed tracing with Jaeger support via `@opentelemetry/sdk-*` packages
- API Key System: External agent authentication with `Authorization: ApiKey <key>` header, rate limiting per key
- CLI Interface: Full `monte` CLI with `auth`, `persona`, `simulate`, `ingest`, `config` commands
- API Polish: Pagination, filtering, caching for list endpoints (simulation, ingestion, users)

**Key Files**:

- `src/api/plugins/apiKey.ts` - API key authentication plugin
- `src/api/routes/apikeys.ts` - API key management endpoints
- `src/api/routes/stream.ts` - SSE streaming endpoint
- `src/config/tracing.ts` - OpenTelemetry/Jaeger configuration
- `src/cli/*` - Complete CLI implementation (index.ts, api.ts, config.ts, commands/)
- `src/ingestion/queue/workers/index.ts` - Redis progress publishing for SSE

---

### ⏳ PHASE 6 - Extended Sources (NEXT)

**Status**: NOT STARTED

- Gmail integration via Composio
- GitHub integration via Composio
- LinkedIn integration via Composio
- Slack integration via Composio
- Webhook notifications for simulation completion

---

## File Structure

```
Monte/
├── src/
│   ├── index.ts                    # Fastify bootstrap
│   ├── api/
│   │   ├── plugins/
│   │   │   ├── auth.ts            # JWT + refresh tokens
│   │   │   ├── rateLimit.ts       # Rate limiting
│   │   │   └── schema.ts          # Swagger/OpenAPI
│   │   └── routes/
│   │       ├── auth.ts            # Register/login/refresh
│   │       ├── users.ts           # CRUD
│   │       ├── health.ts          # Health checks
│   │       ├── ingestion.ts       # Data sources, upload
│   │       ├── persona.ts         # Build/management
│   │       ├── simulation.ts      # Run simulations
│   │       └── cli.ts             # Agent endpoints
│   ├── config/
│   │   ├── index.ts               # Env validation (Zod)
│   │   ├── neo4j.ts               # Neo4j driver
│   │   ├── redis.ts               # Redis client
│   │   ├── minio.ts               # MinIO client
│   │   └── neo4j-schema.ts        # Constraints setup
│   ├── ingestion/
│   │   ├── types.ts               # RawSourceData, BehavioralSignal
│   │   ├── contradictionDetector.ts # Contradiction detection
│   │   ├── composio/
│   │   │   └── client.ts          # SDK integration (placeholder)
│   │   ├── extractors/
│   │   │   ├── base.ts            # Abstract extractor
│   │   │   ├── searchHistory.ts   # Search intent
│   │   │   ├── socialBehavior.ts  # Risk, anxiety
│   │   │   ├── financialBehavior.ts # Spending patterns
│   │   │   ├── cognitiveStructure.ts # Notes analysis
│   │   │   └── mediaConsumption.ts # Watch patterns
│   │   └── queue/
│   │       ├── ingestionQueue.ts  # BullMQ setup
│   │       └── workers/
│   │           └── index.ts       # Real processing
│   ├── persona/                   # ✅ COMPLETE
│   │   ├── dimensionMapper.ts     # 6 dimensions
│   │   ├── graphBuilder.ts        # Neo4j graph
│   │   ├── personaCompressor.ts   # Master persona
│   │   └── cloneGenerator.ts      # 1000 clones
│   ├── simulation/                # ✅ COMPLETE
│   │   ├── decisionGraph.ts       # 8 scenarios
│   │   ├── worldAgents/
│   │   │   ├── base.ts            # Base agent + historical data
│   │   │   ├── financial.ts       # Market models
│   │   │   ├── career.ts          # Job market
│   │   │   ├── education.ts       # Degree ROI
│   │   │   └── social.ts          # Network effects
│   │   ├── forkEvaluator.ts       # LLM routing
│   │   ├── chaosInjector.ts       # Black swans
│   │   ├── engine.ts              # Simulation execution
│   │   └── resultAggregator.ts    # Distributions
│   └── utils/
│       ├── logger.ts              # Pino logging
│       └── errors.ts                # Error classes
├── tests/
│   ├── setup.ts                   # Test config
│   └── auth.test.ts               # Auth tests
├── docs/
│   └── monte.md                   # Implementation status
├── docker-compose.yml             # Neo4j, Redis, MinIO
├── Dockerfile                     # Production build
├── package.json                 # Dependencies
└── tsconfig.json                # TypeScript config
```

---

## Key Design Decisions

### 1. Authentication

- JWT for access tokens (15 min expiry)
- Separate refresh tokens via JWT (different secret, 30 day expiry)
- NOT using Paseto (removed due to package issues)

### 2. Database Schema

**Neo4j Nodes**:

- `User` - id, email, passwordHash, name
- `Persona` - id, version, buildStatus, summary, etc.
- `DataSource` - id, sourceType, status, metadata
- `Signal` - id, type, value, confidence, evidence
- `Trait` - id, name, value, confidence (from dimensions)
- `Memory` - id, type, content, timestamp
- `Clone` - id, parameters (JSON), percentile, category
- `Simulation` - id, name, status, results (JSON)
- `Contradiction` - id, type, description, severity

**Relationships**:

- `(User)-[:HAS_PERSONA]->(Persona)`
- `(User)-[:HAS_DATA_SOURCE]->(DataSource)`
- `(DataSource)-[:HAS_SIGNAL]->(Signal)`
- `(Persona)-[:HAS_TRAIT]->(Trait)`
- `(Persona)-[:HAS_MEMORY]->(Memory)`
- `(Persona)-[:HAS_CLONE]->(Clone)`
- `(Persona)-[:DERIVED_FROM]->(Signal)`
- `(Trait)-[:CORRELATES_WITH]->(Trait)`
- `(Trait)-[:CONTRADICTS]->(Trait)`
- `(Signal)-[:CONTRADICTS]->(Contradiction)`

### 3. Queue System

- **Ingestion Queue**: Process uploaded files → extract signals
- **Persona Queue**: Build graph + generate 1000 clones
- **Simulation Queue**: Run clone batches (100 clones/batch) → aggregate results

### 4. Stratified Sampling (Clones)

- Must cover edge cases, not just average
- 10% at extremes (5th, 95th percentile)
- 20% at outliers (10th, 90th percentile)
- 70% typical (20th-80th percentile)
- Internal consistency enforcement

### 5. LLM Routing (Phase 4)

- Groq (Llama 3) for bulk/simple forks
- Anthropic (Claude) for complex/high-stakes forks
- Complexity score 0-1
- Threshold: >0.6 = Anthropic
- Hard cap: 20 Anthropic calls per simulation

---

## Environment Variables

```bash
# Required
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=<min 8 chars>
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=<min 1 char>
MINIO_SECRET_KEY=<min 1 char>
JWT_SECRET=<min 32 chars>
REFRESH_TOKEN_SECRET=<min 32 chars>

# Phase 2+ (optional for now)
GROQ_API_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
COMPOSIO_API_KEY=

# Server
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

---

## Current Git Status

```
On branch phase5-complete
1 commit ahead of origin/main

Commits:
1. 959cbaa - Phase 1: Core Infrastructure
2. 9d0c2d2 - Phase 2: Ingestion Layer
3. 9e65564 - Docs: Implementation status
4. 1809c2a - Phase 3: Persona Construction
5. 0171a32 - Phase 4: Simulation Engine
6. 5022c77 - Phase 5: CLI & API Polish (HEAD)
```

**Note**: Branch `phase5-complete` pushed to origin. Create PR via GitHub to merge into main.

---

## Next Steps for Next Agent

### Immediate: Phase 6 - Extended Sources

1. **Gmail Integration**
   - Email patterns analysis (communication frequency, response times)
   - Sentiment extraction from email content
   - Professional network analysis

2. **GitHub Integration**
   - Commit patterns (consistency, timing)
   - Code review behavior
   - Project diversity analysis

3. **LinkedIn Integration**
   - Career progression patterns
   - Network size and engagement
   - Job change frequency

4. **Slack Integration**
   - Communication style analysis
   - Response patterns
   - Collaboration metrics

5. **Webhook Notifications**
   - Simulation completion webhooks
   - Real-time notifications to external systems
   - Configurable event filters

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

1. **Signal extraction is rule-based** (regex/pattern matching) - NOT using LLM for extraction (too expensive). LLM only used in Phase 4 for fork evaluation.

2. **Clones are parameter variants** - same structure, different values on 6 dimensions. NOT different personalities entirely.

3. **World agents must use empirical data** - historical returns, base rates from research. NOT made-up numbers.

4. **Contradictions are IMPORTANT** - they reveal where users say one thing but do another. These drive simulation accuracy.

5. **Simulation returns distributions** - always histograms/probabilities, never single numbers.

6. **TypeScript errors** - use `// @ts-nocheck` sparingly if ioredis types cause issues (already used in redis.ts).

---

## Quick Commands

```bash
# Run locally
cd /home/Monte
cp .env.example .env
# Edit .env with real values
docker-compose up -d neo4j redis minio
npm install
npm run dev

# Build
npm run build

# Commit (when push available)
git add -A
git commit -m "Phase X: Description"

# Check status
git log --oneline -5
git status
```

---

## Questions?

If unclear on ANYTHING in this document:

1. Read `docs/monte.md` for implementation details
2. Check `src/ingestion/types.ts` for data types
3. Look at completed phases for patterns
4. When in doubt, follow the PRD philosophy: probability distributions over point estimates

---

**Last Updated**: Phase 5 complete, ready for Phase 6
**Agent**: Continue with Phase 5 CLI & API Polish
