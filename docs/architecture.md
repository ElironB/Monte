# Monte Architecture

## Overview

Monte is a self-hosted TypeScript system that turns personal behavioral data into a probabilistic decision model. The platform ingests raw sources, extracts behavioral signals, compresses them into a master persona, generates clone variants, simulates scenario outcomes, and then lets the user rerun the model after new evidence is collected.

The current shipped architecture includes:

- a Fastify API
- a Commander CLI
- BullMQ workers for background jobs
- Neo4j for graph persistence
- Redis for caching and queue transport
- MinIO for uploaded source storage
- OpenAI-compatible chat and embedding providers

## Runtime topology

### API process

`src/index.ts` bootstraps Fastify, registers plugins, initializes schema/tracing, starts background workers, and mounts route groups for:

- health
- users
- ingestion
- persona
- simulation
- cli
- stream

### Background jobs

BullMQ queues are defined in `src/ingestion/queue/ingestionQueue.ts`:

- `ingestion`
- `persona`
- `simulation`

These queues separate raw source processing, persona builds, and clone-batch simulation execution.

### Storage

- Neo4j stores users, personas, traits, memories, simulations, clone results, and evidence relationships.
- Redis handles cache lookups and BullMQ transport.
- MinIO stores uploaded files and other raw source artifacts.

### Auth model

In open-source/self-hosted mode, auth is intentionally simplified. `src/api/plugins/auth.ts` injects a local user rather than performing hosted authentication.

## End-to-end data flow

1. A user uploads files or prepares connected sources.
2. Ingestion normalizes raw input into `RawSourceData`.
3. Rule-based extractors derive `BehavioralSignal` records.
4. Contradiction detection identifies tension between signals.
5. Persona build maps signals into dimensions, stores trait/memory nodes, and compresses them into a master persona.
6. Clone generation creates a stratified distribution around that persona.
7. Scenario compilation builds a runnable decision graph.
8. Simulation batches execute clones and aggregate outcomes.
9. Decision intelligence proposes experiments and unknowns to resolve.
10. Evidence can be recorded against a completed simulation.
11. Evidence-adjusted reruns reuse the scenario with updated causal/belief state.
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

1. `DimensionMapper` — semantic mapping from signals into dimension scores
2. `GraphBuilder` — persistence of traits, memories, and signal links into Neo4j
3. `PersonaCompressor` — master persona summary and LLM-facing context
4. `PsychologyLayer` — derived psychology model
5. `CloneGenerator` — clone sampling and psychology-based modifiers

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

Monte ships the following scenario types:

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

### Execution and aggregation

The runtime path is:

1. compile a scenario
2. execute clones in batches
3. aggregate clone results into:
   - histograms
   - outcome distribution
   - stratified breakdown
   - summary statistics
   - decision intelligence
   - optional narrative output
   - rerun comparison data when evidence is present

### Outcome semantics

Outcome bucketing is shared logic, not something that should drift independently between the engine and the aggregator. If outcome semantics change, the scenario path, engine path, aggregator path, and benchmark expectations must be kept aligned.

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

The local CLI groups include:

- `simulate`
- `persona`
- `ingest`
- `config`
- `connect`
- `report`
- `generate`
- `compare`
- `doctor`

`connect` exists but is still a WIP integration path.

## Operational invariants

- Fastify is the server framework.
- Self-hosted mode assumes a local user.
- Signal extraction stays rule-based.
- Provider integrations should continue using the `openai` SDK abstraction.
- Benchmark determinism must be preserved.
- Public docs should reflect the shipped code, not stale roadmap language.

## When to audit adjacent systems

If you change:

- dimensions — also audit persona compression, CLI/report display surfaces, docs, and tests
- scenario semantics — also audit aggregation and benchmarks
- evidence logic — also audit simulation route/CLI integration and rerun comparison
- benchmark fixtures — also audit harness tests and docs