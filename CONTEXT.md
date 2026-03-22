# Monte Context

This file is a durable orientation document for contributors and coding agents. It should describe the current shipped system, not an old roadmap snapshot.

## One-paragraph summary

Monte is a self-hosted TypeScript decision engine. It ingests exported personal data, extracts behavioral signals, compresses them into a 9-dimension master persona, derives a psychology layer, generates stratified clone variants, and runs scenario simulations that can be updated with new evidence and validated with a seeded benchmark harness.

## System snapshot

- Runtime: Fastify API plus Commander CLI
- Storage: Neo4j for graph data, Redis for cache/queues, MinIO for uploaded source blobs
- Background execution: BullMQ queues/workers for ingestion, persona builds, and simulation batches
- Auth model: open-source/self-hosted mode injects `local-user`; there is no hosted auth flow in the current repo
- API docs: `/docs`
- Benchmark status: the Phase 3 seeded benchmark harness is implemented and part of the normal regression surface

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
- narrative/technical summaries

### 4. Clone generation

Monte does not simulate a single “user.” It generates a stratified clone population with edge, central, and typical variants. Clone generation also applies psychology-derived modifiers to relevant subsets.

### 5. Simulation

Simulations compile a scenario, execute clone runs, and aggregate:

- histograms
- outcome distribution
- stratified breakdown
- aggregate statistics
- decision frame
- decision intelligence / recommended experiments
- optional narrative output
- rerun comparison when evidence is applied

Each simulation state carries both:

- a `beliefState`
- a `causalState`

Those two layers are the backbone of the evidence loop.

### 6. Evidence loop

Completed simulations can accept experiment results. Evidence is translated into causal/belief adjustments, applied to the state and decision frame, and then used to create evidence-adjusted reruns. Reruns compare belief deltas and recommendation changes against the source simulation.

### 7. Benchmark harness

The benchmark harness is deterministic and seeded. It currently evaluates a built-in corpus across:

- calibration error
- static policy regret
- uncertainty reduction after evidence
- deterministic stability drift

Primary fixtures:

- `startup_founding_seeded_corpus`
- `real_estate_purchase_carry_costs`
- `day_trading_edge_discipline`

## Built-in scenarios

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
- Outcome classification must stay shared across the scenario/engine/aggregator path instead of drifting into multiple definitions.
- Benchmark determinism must remain seeded per run/clone. Do not replace it with a constant global `Math.random`.
- If simulation semantics change, run `npm run build`, `npm test -- --run`, `npm run test:benchmarks`, and `npm run benchmark:pretty`.
- If architecture or commands change, keep `README.md`, `CONTEXT.md`, `AGENTS.md`, `docs/architecture.md`, and `SKILL.md` in sync.

## Main entrypoints

- `src/index.ts` — Fastify bootstrap
- `src/api/routes/` — HTTP surface
- `src/cli/index.ts` — CLI bootstrap
- `src/cli/commands/` — command groups
- `src/persona/` — persona pipeline
- `src/simulation/` — simulation engine and evidence loop
- `src/benchmarks/` — regression harness
- `tests/benchmarks/` — benchmark assertions

## Useful commands

```bash
npm run dev
npm run build
npm test -- --run
npm run test:benchmarks
npm run benchmark:pretty
npm run cli:dev -- doctor
npm run cli:dev -- ingest ./path/to/data
npm run cli:dev -- persona build
npm run cli:dev -- simulate "should I do this?" --wait
```

## Notes for future changes

- The `connect` / Composio workflow exists but is still WIP.
- Some legacy display/reporting code still hardcodes a smaller dimension subset for presentation; treat `src/persona/dimensionMapper.ts` as authoritative if you touch dimension-facing output.
- The benchmark harness is not optional documentation; it is part of the simulation contract.