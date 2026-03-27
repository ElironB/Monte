# Monte Context

This file is a durable orientation document for contributors and coding agents. It should describe the current shipped system, not an old roadmap snapshot.

## One-paragraph summary

Monte is a self-hosted TypeScript decision engine. It ingests exported personal data, extracts rule-based behavioral signals, compresses them into a 9-dimension master persona, derives a psychology layer, exposes an additive agent-personalization surface, generates stratified clone variants, and runs scenario simulations that can be updated with evidence and validated with a seeded benchmark harness. The shipped operator model is a Fastify API that can serve a bundled dashboard plus a globally installable `monte` CLI from the npm package `monte-engine`.

## System snapshot

- Runtime: Fastify API plus Commander CLI, with a bundled same-origin dashboard in the npm package and a repo-local Vite + React dashboard under `apps/web` for development
- Distribution: npm package `monte-engine` as the primary install target, plus a GitHub Packages mirror at `@elironb/monte-engine`; global executable remains `monte`
- CLI config: `~/.monte/config.json` stores the target API URL plus optional provider credentials for the globally installed CLI
- Bundled examples: `examples/personas/starter` ships in the npm package and is surfaced by `monte example`
- Storage: Neo4j for graph data, Redis for cache, queues, and live progress, MinIO for uploaded source blobs
- Dashboard surface: bundled and repo-local UI now include a dedicated Graph tab for clickable scenario DAGs, live clone occupancy, edge flow, and sampled trace overlays
- Personalization surface: the API now exposes `/personalization/profile` and `/personalization/context`, and the CLI now exposes `monte personalize profile` plus `monte personalize context`
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

### 4. Agent personalization

The personalization layer is additive. It reuses the latest ready persona, trait confidence, and derived psychology outputs to return deterministic agent guidance without running a simulation.

Current surfaces:

- `GET /personalization/profile`
- `POST /personalization/context`
- `monte personalize profile`
- `monte personalize context "<task>"`

### 5. Clone generation

Monte does not simulate a single user. It generates a stratified clone population with edge, central, and typical variants. Clone generation also applies psychology-derived modifiers to relevant subsets.

### 6. Simulation

Simulations compile a scenario, execute clone runs through a node-frontier scheduler, batch LLM decisions for clones waiting on the same node, batch-persist clone results with Neo4j `UNWIND` writes, and aggregate:

- histograms
- outcome distribution
- stratified breakdown
- aggregate statistics
- decision frame
- decision intelligence and recommended experiments
- optional narrative output
- rerun comparison when evidence is applied

Each simulation state carries both a `beliefState` and a `causalState`.

The scheduler keeps an active frontier of clones in memory, advances them locally until they hit a decision node or terminal state, groups waiting clones by `(scenario, node, reasoning mode)`, and then spends LLM concurrency on those grouped forks. `SIMULATION_DECISION_CONCURRENCY` caps in-flight LLM requests. `SIMULATION_ACTIVE_FRONTIER` controls how many clones a worker batch keeps active at once.

Batch recovery is adaptive. If a provider repeatedly fails on a large batched decision payload, the evaluator lowers the preferred batch size for the rest of that scenario/mode instead of repeating the same failing request size on later decision waves.

### 7. Live progress

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

Execution payloads can also expose:

- `activeFrontier`
- `waitingDecisions`
- `resolvedDecisions`
- `estimatedDecisionCount`
- `localStepDurationMs`

Completed simulations also carry runtime telemetry that summarizes:

- wall-clock runtime
- execution, persistence, and aggregation timing
- LLM batch vs single-call counts
- decision concurrency and active frontier usage
- batch retry, split, and leaf-fallback counts
- limiter wait time
- embedding time
- slowest decision nodes

### 8. Evidence loop

Completed simulations can accept experiment results. Evidence is translated into causal and belief adjustments, applied to the state and decision frame, and then used to create evidence-adjusted reruns. Reruns compare belief deltas and recommendation changes against the source simulation.

### 9. Benchmark harness

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
- `monte start`
- `monte config set-provider <provider>`
- `monte config set-api-key <key>`
- `monte config set-embedding-key <key>`
- `monte ingest`
- `monte example list`
- `monte example ingest starter`
- `monte persona build`
- `monte personalize profile --json`
- `monte personalize context "<task>" --json`
- `monte simulate`
- `monte simulate progress <id> --json`
- `monte simulate results <id> -f json`
- `monte simulate evidence`
- `monte simulate rerun`
- `monte decide "<question>" --mode fast|standard|deep [--wait] [--json]`

For repo development, the equivalent source-running form is `npm run cli:dev -- ...`.

Repo-local dashboard commands:

- `npm run web:dev`
- `npm run web:build`
- `npm run web:preview`

Installed dashboard command:

- `monte start`

Relevant runtime tuning env vars:

- `SIMULATION_BATCH_SIZE`
- `SIMULATION_DECISION_CONCURRENCY`
- `SIMULATION_ACTIVE_FRONTIER`
- `SIMULATION_CONCURRENCY` (legacy alias for decision concurrency)
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

- `src/server.ts` -> shared Fastify bootstrap plus bundled dashboard serving
- `src/index.ts` -> default runtime entrypoint
- `src/api/routes/` -> HTTP surface
- `src/cli/index.ts` -> CLI bootstrap
- `src/cli/commands/` -> command groups including `decide` and `doctor --json`
- `apps/web/src/App.tsx` -> dashboard shell and route map
- `apps/web/src/lib/api.ts` -> frontend API client against the Fastify routes
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
