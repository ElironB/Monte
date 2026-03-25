# Monte Architecture

## Overview

Monte is a self-hosted TypeScript system that turns personal behavioral data into a probabilistic decision model. It ingests raw sources, extracts behavioral signals, compresses them into a master persona, generates clone variants, simulates scenario outcomes, and lets the operator rerun the model after new evidence is collected.

The current shipped architecture includes:

- a Fastify API
- a globally installable Commander CLI
- a bundled dashboard served from the npm package by the Fastify app
- a repo-local Vite + React dashboard in `apps/web` for local development
- BullMQ workers for background jobs
- Neo4j for graph persistence
- Redis for cache, live progress, and queue transport
- MinIO for uploaded source storage
- OpenAI-compatible chat and embedding providers

The primary npm package name is `monte-engine`. A GitHub Packages mirror is also published as `@elironb/monte-engine` so the package can be linked to this repository in GitHub Packages. The installed executable is still `monte`.

## Runtime topology

### API process

`src/server.ts` builds the Fastify app, initializes schema and tracing, starts background workers, mounts the HTTP routes, and serves the bundled dashboard when compiled assets are present. `src/index.ts` is the default runtime entrypoint for that shared bootstrap.

The API mounts route groups for:

- health
- users
- ingestion
- persona
- simulation
- cli
- stream

### CLI process

`src/cli/index.ts` bootstraps the local and globally installable CLI. The CLI stores user config in `~/.monte/config.json`, including the target API URL plus optional provider credentials for global usage when no repo-local `.env` is present.

The agent-facing entrypoint is:

- `monte decide`

The installed server entrypoint is:

- `monte start`

The machine-readable readiness entrypoint is:

- `monte doctor --json`

Bundled starter assets are exposed through:

- `monte example list`
- `monte example path starter`
- `monte example ingest starter`

### Dashboard surface

`apps/web` is the source for the dashboard Monte ships to end users. In the published npm package, the built assets are served by Fastify on the same origin as the API so installed users can start everything with `monte start`. In repo-local development, `apps/web` still runs as a standalone Vite + React client on `http://localhost:3001` and targets the API on `http://localhost:3000` via `VITE_MONTE_API_BASE_URL`.

The dashboard currently organizes:

- persona dimensions and psychology
- simulation launch and history
- live progress via REST plus SSE
- a dedicated Graph tab with a clickable scenario DAG, live clone occupancy, edge flow, and sampled traces
- results, narrative output, and runtime telemetry
- evidence capture and rerun actions
- source and signal previews

### Background jobs

BullMQ queues are defined in `src/ingestion/queue/ingestionQueue.ts`:

- `ingestion`
- `persona`
- `simulation`

These queues separate raw source processing, persona builds, and clone-batch simulation execution.

### Storage

- Neo4j stores users, personas, traits, memories, simulations, clone results, and evidence relationships.
- Redis handles cache lookups, BullMQ transport, live simulation progress snapshots, and live graph snapshots.
- MinIO stores uploaded files and other raw source artifacts.

### Auth model

In open-source and self-hosted mode, auth is intentionally simplified. `src/api/plugins/auth.ts` injects a local user rather than performing hosted authentication.

## End-to-end data flow

1. A user uploads files or prepares connected sources.
2. Ingestion normalizes raw input into `RawSourceData`.
3. Rule-based extractors derive `BehavioralSignal` records.
4. Contradiction detection identifies tension between signals.
5. Persona build maps signals into dimensions, stores trait and memory nodes, and compresses them into a master persona.
6. Clone generation creates a stratified distribution around that persona.
7. Scenario compilation builds a runnable decision graph.
8. Simulation batches execute clones and batch-persist their results.
9. Aggregation reduces the full result set into distributions, decision intelligence, and optional narrative output.
10. Evidence can be recorded against a completed simulation.
11. Evidence-adjusted reruns reuse the scenario with updated causal and belief state.
12. The benchmark harness exercises a seeded corpus to catch regressions.

## Persona system

### Behavioral dimensions

The current behavioral source of truth is `src/persona/dimensionMapper.ts`. Monte currently models 9 dimensions:

- `riskTolerance`
- `timePreference`
- `socialDependency`
- `learningStyle`
- `decisionSpeed`
- `emotionalVolatility`
- `executionGap`
- `informationSeeking`
- `stressResponse`

Each dimension also carries confidence, source counts, source types, estimated-vs-observed flags, and confidence intervals.

### Persona construction pipeline

The core persona path is:

1. `DimensionMapper` -> semantic mapping from signals into dimension scores
2. `GraphBuilder` -> persistence of traits, memories, and signal links into Neo4j
3. `PersonaCompressor` -> master persona summary and LLM-facing context
4. `PsychologyLayer` -> derived psychology model
5. `CloneGenerator` -> clone sampling and psychology-based modifiers

### Psychology layer

The psychology layer derives:

- Big Five profile
- attachment style
- locus of control
- temporal discounting
- risk flags
- narrative and technical summaries

This layer is synchronous and deterministic relative to the dimension scores. It is not a separate service.

### Clone model

Monte simulates a population rather than a single identity. Clone generation is stratified across edge, central, and typical variants. Clones inherit the master persona but vary according to dimension confidence and contradiction structure. Psychology-derived modifiers can amplify behavior for relevant subsets of clones.

## Simulation system

### Scenario catalog

Monte currently ships 8 scenario types including `custom`:

- `day_trading`
- `startup_founding`
- `career_change`
- `advanced_degree`
- `geographic_relocation`
- `real_estate_purchase`
- `health_fitness_goal`
- `custom`

### Scenario representation

A scenario is compiled into a graph of:

- decision nodes
- event nodes
- outcome nodes

Each compiled scenario also carries:

- an initial `SimulationState`
- an optional `DecisionFrame`
- scenario metadata such as name and timeframe

### State model

Each clone run tracks:

- capital
- health
- happiness
- elapsed time
- scenario-specific metrics
- `beliefState`
- `causalState`

The causal and belief layers are central to how Monte reasons about uncertainty, reversibility, downside, and experiment design.

### Execution, persistence, and aggregation

The runtime path is:

1. compile a scenario
2. execute clones in batches through a node-frontier scheduler
3. batch concurrent LLM decisions for clones waiting on the same decision node inside a worker batch
4. persist each finished batch with a single Neo4j `UNWIND` write
5. aggregate clone results into:
   - histograms
   - outcome distribution
   - stratified breakdown
   - summary statistics
   - decision intelligence
   - optional narrative output
   - rerun comparison data when evidence is present

The runtime optimization matters in three places:

- the scheduler advances clones locally until they block on a decision, so LLM concurrency is spent on fork evaluation rather than whole-clone lifecycles
- decision batching reduces remote LLM round trips without replacing the decision layer with local heuristics
- batch persistence removes the old per-clone Neo4j write tail that made simulations appear stuck near the end

Decision batching is keyed by shared decision node and model mode. Multiple clones waiting on the same fork can be packaged into one structured LLM request, then mapped back to per-clone choices. Worker processes share one provider limiter and one in-flight request limiter for simulation batches, so throughput tuning happens at the process level instead of per-batch ad hoc queues.

If repeated invalid batched payloads force retries and splits, the evaluator now lowers the preferred batch size for the rest of that scenario and mode. This prevents later decision waves from reusing a request size the provider has already demonstrated it cannot handle reliably.

Each `Simulation` also stores `batchSizeUsed` at creation time so progress math and batch accounting remain stable even if `SIMULATION_BATCH_SIZE` changes between creation and polling.

### Live progress architecture

Simulation progress is published to Redis and exposed through `/stream/simulation/:id/progress-rest`. The live payload can include:

- `status`
- `phase`
- `phaseProgress`
- `aggregationStage`
- `progress`
- `completedBatches`
- `currentBatch`
- `processedClones`
- `batchProcessedClones`
- `batchCloneCount`
- `estimatedTimeRemaining`
- `lastUpdated`
- `activeFrontier`
- `waitingDecisions`
- `resolvedDecisions`
- `estimatedDecisionCount`
- `localStepDurationMs`

The graph surface uses:

- `/simulation/:id/graph` for the compiled scenario DAG plus the best available snapshot
- `/stream/simulation/:id/graph` for live SSE updates
- `/stream/simulation/:id/graph-rest` for polling fallback

Current phase model:

- `queued`
- `executing`
- `persisting`
- `aggregating`
- `completed`
- `failed`

Progress weighting:

- `queued`: `0`
- `executing`: `0-90`
- `persisting`: `90-96`
- `aggregating`: `97-99`
- `completed`: `100`

Aggregation stages:

- `loading_results`
- `reducing`
- `writing_summary`

The progress route prefers explicit live Redis payloads when they exist and falls back to the persisted simulation state when Redis is unavailable.

### Runtime telemetry

Completed simulations persist runtime telemetry alongside the aggregated results. The telemetry summarizes:

- wall-clock runtime
- execution, persistence, and aggregation timing
- total LLM decision evaluations
- batched vs single LLM call counts
- limiter wait time
- embedding time
- per-node timing hotspots

This gives operators a concrete breakdown of where simulation time is going and makes throughput tuning measurable rather than anecdotal.

New scheduler-oriented telemetry includes:

- decision concurrency
- active frontier and peak active frontier
- peak waiting decisions
- local step time
- batch retry / split / single-fallback counts
- batch vs single prompt and response token splits

### Outcome semantics

Outcome bucketing is shared logic, not something that should drift independently between the engine and the aggregator. If outcome semantics change, the scenario path, engine path, aggregator path, and benchmark expectations must stay aligned.

## Evidence loop

Evidence is a first-class part of the simulation architecture.

### Record evidence

A completed simulation can accept experiment results with:

- an uncertainty label
- a focus metric
- a recommended experiment
- a result (`positive`, `negative`, `mixed`, or `inconclusive`)
- confidence
- observed signal text

### Apply evidence

`src/simulation/evidenceLoop.ts` translates evidence into:

- causal adjustments
- belief adjustments

It then updates:

- the seed simulation state
- the decision frame context
- the unresolved unknown list

### Rerun

Evidence-adjusted reruns persist explicit relationships back to the source simulation and selected evidence set. Results include a rerun comparison that tracks:

- thesis confidence delta
- uncertainty delta
- downside salience delta
- whether the top recommendation changed

## Benchmark harness

The benchmark harness in `src/benchmarks/` is the main regression surface for simulation quality.

### What it measures

- calibration error
- static policy regret
- uncertainty reduction after evidence
- deterministic stability drift

### Current fixture corpus

- `startup_founding_seeded_corpus`
- `real_estate_purchase_carry_costs`
- `day_trading_edge_discipline`

### Determinism model

Determinism is achieved with seeded per-run randomness. This is intentional. A constant global random function would flatten branch behavior and hide regressions.

### Commands

```bash
npm run benchmark:pretty
npm run benchmark -- --output benchmark-suite.json
npm run test:benchmarks
```

## API and CLI surface

### API

The primary API domains are:

- `/health`
- `/ingestion`
- `/persona`
- `/simulation`
- `/cli`
- `/stream`

Swagger documentation is exposed at `/docs`.

### CLI

Installed usage prefers:

- `monte start`
- `monte simulate`
- `monte simulate progress <id> --json`
- `monte simulate results <id> -f json`
- `monte decide "<question>" --mode standard --wait --json`
- `monte doctor --json`
- `monte config set-api http://localhost:3000`
- `monte config set-provider openrouter`
- `monte config set-api-key <key>`
- `monte example ingest starter`

Repo-local development usage prefers:

```bash
npm run dev
npm run web:dev
npm run cli:dev -- simulate "should I do this?" --wait
npm run cli:dev -- decide "should I do this?" --mode standard --wait --json
```

`connect` exists but is still an experimental integration path.

## Operational invariants

- Fastify is the server framework.
- Self-hosted mode assumes a local user.
- Signal extraction stays rule-based.
- Provider integrations should continue using the `openai` SDK abstraction.
- Benchmark determinism must be preserved.
- Public docs should reflect the shipped code, not stale roadmap language.

## When to audit adjacent systems

If you change:

- dimensions -> also audit persona compression, CLI and reporting display surfaces, docs, and tests
- scenario semantics -> also audit aggregation and benchmarks
- evidence logic -> also audit simulation route and CLI integration plus rerun comparison
- package and CLI distribution -> also audit `package.json`, `README.md`, `CONTEXT.md`, `AGENTS.md`, `docs/architecture.md`, and `SKILL.md`
- benchmark fixtures -> also audit harness tests and docs
