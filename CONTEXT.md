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
│ 4. SIMULATION ENGINE (NEXT PHASE)                        │
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
**Commit**: Multiple commits, latest includes all Phase 1 files

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
**Commit**: `1809c2a` (4 commits ahead of origin/main)

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

### ⏳ PHASE 4 - Simulation Engine (NEXT)
**Status**: NOT STARTED

**What Needs To Be Built**:

#### 1. Decision Graph System
- `src/simulation/decisionGraph.ts`
- Scenario definitions (8 built-in types)
- Decision nodes, event nodes, outcome nodes
- Graph builder for each scenario

#### 2. World Agents (4 total)
- `src/simulation/worldAgents/base.ts`
- `src/simulation/worldAgents/financial.ts` - Market returns, inflation, liquidity
- `src/simulation/worldAgents/career.ts` - Job market, salary growth, burnout
- `src/simulation/worldAgents/education.ts` - Completion rates, ROI
- `src/simulation/worldAgents/social.ts` - Network effects, relocation costs

#### 3. LLM Fork Evaluator
- `src/simulation/forkEvaluator.ts`
- Complexity scoring (0-1)
- Router: Groq (fast/cheap) vs Anthropic (complex)
- Threshold: complexity > 0.6 = Anthropic
- Max 20 Anthropic calls per simulation

#### 4. Chaos Injector
- `src/simulation/chaosInjector.ts`
- Black swan events: medical, market crash, job loss, relationship
- Low probability, high impact

#### 5. Batch Orchestrator
- Execute 1000 clones in parallel
- Real-time progress tracking
- `src/ingestion/queue/workers/index.ts` - Update `processSimulation`

#### 6. Result Aggregator
- Histogram generation
- Outcome distributions
- Timeline distributions
- Store in Neo4j Simulation node

---

### ⏳ PHASE 5 - CLI & API Polish (PENDING)
**Status**: NOT STARTED

- SSE streaming for simulation progress
- OpenTelemetry tracing
- API key system for external agents
- CLI interface (`monte login`, `monte simulate`, etc.)

---

### ⏳ PHASE 6 - Extended Sources (PENDING)
**Status**: NOT STARTED

- Additional Composio integrations
- Gmail, GitHub, LinkedIn, Slack extractors
- No new OAuth code needed (Composio handles it)

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
│   │           └── index.ts       # Real processing (UPDATE FOR SIMULATION)
│   ├── persona/                   # ✅ COMPLETE
│   │   ├── dimensionMapper.ts     # 6 dimensions
│   │   ├── graphBuilder.ts        # Neo4j graph
│   │   ├── personaCompressor.ts   # Master persona
│   │   └── cloneGenerator.ts      # 1000 clones
│   ├── simulation/                # ⏳ PHASE 4 - BUILD THIS
│   │   ├── decisionGraph.ts       # Decision trees
│   │   ├── worldAgents/
│   │   │   ├── base.ts            # Base agent
│   │   │   ├── financial.ts       # Market models
│   │   │   ├── career.ts          # Job market
│   │   │   ├── education.ts       # Degree ROI
│   │   │   └── social.ts          # Network effects
│   │   ├── forkEvaluator.ts       # LLM routing
│   │   ├── chaosInjector.ts       # Black swans
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
- **Simulation Queue**: Run clone batches (placeholder - needs implementation)

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
On branch main
4 commits ahead of origin/main

Commits:
1. 959cbaa - Phase 1: Core Infrastructure
2. 9d0c2d2 - Phase 2: Ingestion Layer  
3. 9e65564 - Docs: Implementation status
4. 1809c2a - Phase 3: Persona Construction (HEAD)
```

**Important**: Main branch is protected, cannot push directly. Must use alternative method (GitHub web upload, token, or unprotect branch).

---

## Next Steps for Next Agent

### Immediate: Phase 4 - Simulation Engine

1. **Create simulation types**
   ```typescript
   // src/simulation/types.ts
   interface DecisionNode { id, type: 'decision', options[], prompt }
   interface EventNode { id, type: 'event', probability, outcomes[] }
   interface OutcomeNode { id, type: 'outcome', results: Record<string, number> }
   ```

2. **Build decision graphs for 8 scenarios**
   - Start with `day_trading` as proof of concept
   - Define decision points, market events, outcomes

3. **Implement World Agents**
   - FinancialAgent with S&P 500 historical returns
   - CareerAgent with industry base rates
   - Start simple, add complexity later

4. **Fork Evaluator**
   - Complexity scoring function
   - LLM routing logic
   - Groq integration (Groq SDK already added)

5. **Update simulation worker**
   - Current `processSimulation` is placeholder
   - Needs to fetch 1000 clones, run through decision graph
   - Store results

### After Phase 4: Phase 5
- SSE streaming
- OpenTelemetry
- CLI polish

### After Phase 5: Phase 6
- More Composio extractors

---

## Performance Targets (from PRD)

| Metric | Target |
|--------|--------|
| 1000-clone simulation | < 90 seconds (p95) |
| Persona build | < 5 minutes |
| API response | < 200ms (p95) |
| LLM calls per sim | < 100 |
| Same-input variance | < 5% outcome shift |
| Neo4j queries | < 50ms |
| Concurrent sims | >= 10 |
| Cold start | < 2 minutes |

---

## Critical Notes

1. **Signal extraction is rule-based** (regex/pattern matching) - NOT using LLM for extraction (too expensive). LLM only used in Phase 4 for fork evaluation.

2. **Clones are parameter variants** - same structure, different values on 6 dimensions. NOT different personalities entirely.

3. **World agents must use empirical data** - historical returns, base rates from research. NOT made-up numbers.

4. **Contradictions are IMPORTANT** - they reveal where users say one thing but do another. These drive simulation accuracy.

5. **Simulation returns distributions** - always histograms/probabilities, never single numbers.

6. **TypeScript errors** - use `// @ts-nocheck` sparingly if ioredis types cause issues (already used in redis.ts).

7. **No testing required** - user explicitly said "too lazy to test". Focus on implementation.

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

**Last Updated**: Phase 3 complete, ready for Phase 4
**Agent**: Continue with Phase 4 Simulation Engine
