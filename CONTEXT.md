# Monte Context

This file is a durable orientation document for contributors and coding agents. It should describe the current shipped system, not an old roadmap snapshot.

## One-paragraph summary

Monte is a self-hosted TypeScript decision engine. It ingests exported personal data, extracts rule-based behavioral signals, compresses them into a 9-dimension master persona, derives a psychology layer, generates stratified clone variants, and runs scenario simulations that can be updated with evidence and validated with a seeded benchmark harness. The shipped operator model is a Fastify API plus a globally installable `monte` CLI from the npm package `monte-engine`.

## System snapshot

- Runtime: Fastify API plus Commander CLI
- Distribution: npm package `monte-engine`, global executable `monte`
- CLI config: `~/.monte/config.json`
- Storage: Neo4j for graph data, Redis for cache, queues, and live progress, MinIO for uploaded source blobs
- Background execution: BullMQ queues and workers for ingestion, persona builds, and simulation batches
- Auth model: self-hosted OSS mode injects `local-user`; there is no hosted auth flow in the current repo
- API docs: `/docs`
- Benchmark status: deterministic seeded harness is part of the regression surface

## Core pipeline

### 1. Ingestion

Raw files are uploaded and typed as sources such as `search_history`, `watch_history`, `social_media`, `financial`, `notes`, `files`, `ai_chat`, or `composio`.

Extraction is rule-based. The ingestion layer produces:

- `BehavioralSignal`
- `SignalContradiction`

### 2. Persona construction

Signals are embedded and mapped into 9 behavioral dimensions:

- `riskTolerance`
- `timePreference`
- `socialDependency`
- `learningStyle`
- `decisionSpeed`
- `emotionalVolatility`
- `executionGap`
- `informationSeeking`
- `stressResponse`

The persona pipeline then:

- stores trait and memory nodes in Neo4j
- compresses them into a `MasterPersona`
- derives psychology outputs via `PsychologyLayer`
- prepares LLM-facing summary context for simulation

### 3. Psychology layer

The psychology layer derives:

- Big Five
- attachment style
- locus of control
- temporal discounting
- risk flags
- narrative and technical summaries

### 4. Clone generation

Monte does not simulate a single user. It generates a stratified clone population with edge, central, and typical variants. Clone generation also applies psychology-derived modifiers to relevant subsets.

### 5. Simulation

Simulations compile a scenario, execute clone runs, batch LLM decisions for clones waiting on the same node, batch-persist clone results with Neo4j `UNWIND` writes, and aggregate:

- histograms
- outcome distribution
- stratified breakdown
- aggregate statistics
- decision frame
- decision intelligence and recommended experiments
- optional narrative output
- rerun comparison when evidence is applied

Each simulation state carries both a `beliefState` and a `causalState`.

### 6. Live progress

Simulation progress is phase-aware and published through Redis-backed live payloads plus a REST fallback. Current phases:

- `queued`
- `executing`
- `persisting`
- `aggregating`
- `completed`
- `failed`

Overall progress is weighted:

- `queued`: `0`
- `executing`: `0-90`
- `persisting`: `90-96`
- `aggregating`: `97-99`
- `completed`: `100`

Aggregation may expose sub-stages:

- `loading_results`
- `reducing`
- `writing_summary`

Completed simulations also carry runtime telemetry that summarizes:

- wall-clock runtime
- execution, persistence, and aggregation timing
- LLM batch vs single-call counts
- limiter wait time
- embedding time
- slowest decision nodes

### 7. Evidence loop

Completed simulations can accept experiment results. Evidence is translated into causal and belief adjustments, applied to the state and decision frame, and then used to create evidence-adjusted reruns. Reruns compare belief deltas and recommendation changes against the source simulation.

### 8. Benchmark harness

The benchmark harness is deterministic and seeded. It evaluates a built-in corpus across:

- calibration error
- static policy regret
- uncertainty reduction after evidence
- deterministic stability drift

Primary fixtures:

- `startup_founding_seeded_corpus`
- `real_estate_purchase_carry_costs`
- `day_trading_edge_discipline`

## CLI surface

Primary user-facing commands:

- `monte doctor`
- `monte doctor --json`
- `monte ingest`
- `monte persona build`
- `monte simulate`
- `monte simulate progress <id> --json`
- `monte simulate results <id> -f json`
- `monte simulate evidence`
- `monte simulate rerun`
- `monte decide "<question>" --mode fast|standard|deep [--wait] [--json]`

For repo development, the equivalent source-running form is `npm run cli:dev -- ...`.

Relevant runtime tuning env vars:

- `SIMULATION_BATCH_SIZE`
- `SIMULATION_CONCURRENCY`
- `SIMULATION_WORKER_CONCURRENCY`
- `SIMULATION_DECISION_BATCH_SIZE`
- `SIMULATION_DECISION_BATCH_FLUSH_MS`
- `LLM_RPM_LIMIT`

## Built-in scenario types

Monte currently ships 8 scenario types including `custom`:

- `day_trading`
- `startup_founding`
- `career_change`
- `advanced_degree`
- `geographic_relocation`
- `real_estate_purchase`
- `health_fitness_goal`
- `custom`

## Important invariants

- The API is Fastify, not Express.
- The behavioral source of truth is the 9-dimension map in `src/persona/dimensionMapper.ts`.
- Self-hosted OSS mode uses injected local auth via `src/api/plugins/auth.ts`.
- Signal extraction is rule-based; do not route extraction through an LLM.
- Outcome classification must stay shared across the scenario, engine, aggregation, and benchmark path.
- Benchmark determinism must remain seeded per run and per clone.
- If simulation semantics change, run `npm run build`, `npm test -- --run`, `npm run test:benchmarks`, and `npm run benchmark:pretty`.
- If package or CLI distribution behavior changes, also run `npm pack`.
- If architecture or commands change, keep `README.md`, `CONTEXT.md`, `AGENTS.md`, `docs/architecture.md`, and `SKILL.md` in sync.

## Main entrypoints

- `src/index.ts` -> Fastify bootstrap
- `src/api/routes/` -> HTTP surface
- `src/cli/index.ts` -> CLI bootstrap
- `src/cli/commands/` -> command groups including `decide` and `doctor --json`
- `src/persona/` -> persona pipeline
- `src/simulation/` -> simulation engine, evidence loop, progress, and result persistence
- `src/benchmarks/` -> regression harness
- `tests/benchmarks/` -> benchmark assertions

## Useful commands

```bash
npm run dev
npm run build
npm test -- --run
npm run test:benchmarks
npm run benchmark:pretty
npm pack
monte doctor
monte decide "should I do this?" --mode standard --wait --json
npm run cli:dev -- doctor
```

## Notes for future changes

- The external-agent path is CLI-first. `monte decide` is the current agent entrypoint; there is no separate agent-only HTTP API in this repo.
- `connect` / Composio exists but remains experimental.
- Some reporting surfaces still contain legacy hardcoded dimension subsets; treat `src/persona/dimensionMapper.ts` as authoritative if you touch dimension-facing output.
- The benchmark harness is part of the simulation contract, not optional documentation.
