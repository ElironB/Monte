# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Commands

### Development
```bash
npm install                              # Install dependencies
cp .env.example .env                     # Configure environment
docker-compose up -d neo4j redis minio  # Start infrastructure only
docker-compose up -d                     # Start everything (includes API container)
npm run dev                              # Run API with hot-reload (tsx watch)
npm run build                            # Compile TypeScript → dist/
npm start                                # Run compiled server
npm run cli:dev                          # Run CLI without building
npm link                                 # Install `monte` CLI globally (dev)
monte doctor                             # Validate all services + API keys
```

### Testing
```bash
npm test                                                        # Run all tests (vitest)
npx vitest run tests/dimensions.test.ts                        # Run a single test file
npx vitest run tests/persona tests/clones.test.ts tests/dimensions.test.ts tests/benchmarks  # Pure-logic tests (no infra required)
npm run test:e2e                                               # E2E smoke test (requires running stack)
```

Tests live in `tests/`. The vitest config (`vitest.config.ts`) picks up `tests/**/*.test.ts`. Infrastructure-dependent tests (those hitting Neo4j/MinIO) will fail without a running stack — run pure-logic tests when infra isn't available.

### Logging
Set `LOG_LEVEL=debug` in `.env` to get verbose output from the Pino logger.

---

## Architecture

Monte Engine is a 5-layer pipeline:

```
Data Files / Composio
        ↓
1. Ingestion Layer        — BullMQ workers receive uploads, route to extractors
        ↓
2. Signal Extraction      — Rule-based extractors (no LLM) + ContradictionDetector
        ↓
3. Persona Construction   — DimensionMapper → PsychologyLayer → PersonaCompressor → CloneGenerator (Neo4j)
        ↓
4. Simulation Engine      — DecisionGraph + WorldAgents + ForkEvaluator (LLM) + ChaosInjector
        ↓
5. Results + Narrative    — ResultAggregator → NarrativeGenerator (LLM)
```

### Ingestion & Signal Extraction (`src/ingestion/`)
- `monte ingest <dir>` recursively scans a directory, auto-detects file types, and uploads in batches to the API, which queues them via BullMQ.
- Six extractors (`searchHistory`, `socialBehavior`, `financialBehavior`, `cognitiveStructure`, `mediaConsumption`, `aiChatHistory`) are all **rule-based** (regex/pattern + quantitative analysis). No LLM used here.
- `temporalUtils.ts` is a shared module for frequency counting, recurrence scoring, temporal pattern detection, and trend analysis across extractors.
- `ContradictionDetector` finds stated-vs-revealed, temporal, and cross-domain contradictions. Contradictions have a `magnitude` (0–1 from embedding cosine distance) and directly influence persona dimension scores via `DimensionMapper`.
- Each signal is embedded with `openai/text-embedding-3-small` during ingestion and stored on the Neo4j `Signal` node. Redis caches embeddings (signal vectors 7 days, concept vectors 30 days).

### Persona Construction (`src/persona/`)
The pipeline runs in this order:
1. **`DimensionMapper`** — Compares signal embeddings to rich concept descriptions for 9 behavioral dimensions using cosine similarity. Applies contradiction penalties and source reliability weighting. Produces per-dimension scores with confidence intervals.
2. **`PsychologyLayer`** — Pure synchronous post-processor (no LLM, no async, no DB). Maps dimension scores → Big Five (OCEAN), Attachment Style, Locus of Control, Temporal Discounting, and 5 risk flags (`execution_overconfidence`, `social_financial_contamination`, `planning_paralysis`, `stress_capitulation`, `autonomous_drift`).
3. **`PersonaCompressor`** — Builds the `MasterPersona` object, now including `psychologicalProfile` and `llmContextSummary`.
4. **`CloneGenerator`** — Produces 1,000 stratified clones: 10% edge (5th/95th percentile), 20% outlier (10th/90th), 70% typical (20th–80th). Psychology modifiers applied to 20–30% of the clone pool.
5. **`BayesianUpdater`** — First persona build runs the full pipeline; subsequent builds are incremental (only new signals processed), using Bayes' theorem per dimension. Confidence capped at 0.05–0.95; new evidence caps at 40% influence per update.
- Everything is stored in **Neo4j** as a graph (User, Persona, Trait, Signal, Contradiction, Memory nodes).

### Simulation Engine (`src/simulation/`)
- `DecisionGraph` defines 8 scenario types (day_trading, startup_founding, career_change, etc.) as branching decision trees.
- Four `WorldAgents` (financial, career, education, social) inject empirically-cited base rates from `BaseRateRegistry` (sourced from ESMA, BLS, NCES, Case-Shiller). **Never use made-up numbers.**
- `ForkEvaluator` uses the OpenAI SDK (configurable `baseURL`) to evaluate clone decisions at forks. Injects PsychologyLayer risk flags and clone-specific modifiers into the prompt. Uses the standard model for simple forks and the reasoning model for complex forks (>0.6 complexity score).
- `ChaosInjector` adds black swan events.
- `BatchOrchestrator` runs 1,000 clones in parallel batches of 100 (concurrency configurable via `SIMULATION_CONCURRENCY`).
- `KellyCalculator` computes fractional position sizing from actual simulation outcome distributions when `capitalAtRisk` is provided.

### API & CLI (`src/api/`, `src/cli/`)
- Fastify 5.x with Swagger docs at `http://localhost:3000/docs`.
- Auth is a passthrough — no login required. `request.user.userId` is always `"local-user"`. This pattern is intentionally preserved for future cloud multi-user support.
- The CLI uses `commander` and communicates with the API via `src/cli/api.ts`. Config stored in `~/.monte/config.json`.
- `monte config set-api <url>` switches the CLI between local dev and a future hosted endpoint.
- SSE streaming for simulation progress at `GET /stream/simulation/:id/progress`.

### LLM Integration
All LLM calls go through the `openai` npm package with a configurable `baseURL`. **Never import provider-specific SDKs** (`groq-sdk`, `@anthropic-ai/sdk`, etc.). Provider is determined at startup:
- `OPENROUTER_API_KEY` → OpenRouter (recommended; covers both LLM + embeddings)
- `GROQ_API_KEY` → Groq (fast inference; requires separate `EMBEDDING_API_KEY` since Groq has no embeddings)
- Default models: `openai/gpt-oss-20b` (standard), `openai/gpt-oss-120b` (reasoning)
- Model overrides: `LLM_MODEL`, `LLM_REASONING_MODEL`

---

## Key Rules (from CONTRIBUTING.md)

- **TypeScript only** — all source files must be `.ts`
- **LLM via OpenAI SDK only** — `import OpenAI from 'openai'` with `baseURL` override; never use provider SDKs directly
- **Signal extraction is rule-based** — regex/pattern matching + quantitative analysis; never use LLM in extractors (cost constraint)
- **No new npm dependencies** without discussion — the project keeps deps intentionally minimal
- **Pino for server logging** — never `console.log` in `src/` outside of `src/cli/`
- **All new dimensions are optional** — backward compatibility required; existing personas must remain valid
- **World agents must use empirical data** — cite sources when adding base rates to `baseRateRegistry.ts`
- **No auth in open source** — `request.user.userId` is always `"local-user"`; do not add auth back unless building the cloud version
- **Read `CONTEXT.md` before making architectural changes** — it documents every design decision and recent PRs
