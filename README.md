# Monte

> A flight simulator for hard decisions.

Monte is a self-hosted decision engine that ingests personal data, builds a behavioral persona, generates stratified clones, and runs probabilistic simulations against real decision paths. Instead of a single prediction, it returns distributions, decision intelligence, recommended experiments, and evidence-adjusted reruns.

**Core loop:** Data -> Signals -> Persona -> Clones -> Simulation -> Evidence loop

## What Monte gives you

- Outcome distributions instead of a single yes/no answer
- A persona built from revealed behavioral signals, not just self-reported traits
- Decision intelligence with dominant uncertainties and recommended experiments
- Evidence capture plus reruns after the world gives you new information
- A deterministic benchmark harness for regression-testing the simulation layer

## Current product shape

Monte currently ships as:

- a Fastify API
- a globally installable Commander CLI
- BullMQ workers for ingestion, persona builds, and simulation batches
- Neo4j for graph persistence
- Redis for cache, live progress, and queue transport
- MinIO for uploaded source storage

In self-hosted OSS mode, auth is stubbed to a local injected user.

## Quickstart

### Requirements

- Node.js 20+
- Docker and Docker Compose
- A chat-capable OpenAI-compatible model key
- An embedding-capable key for persona builds

The simplest setup is `OPENROUTER_API_KEY`, which can cover both chat and embeddings.

### 1. Configure the environment

```bash
cp .env.example .env
```

Set at least:

- `NEO4J_PASSWORD`
- `OPENROUTER_API_KEY`, or equivalent chat plus embedding keys

Optional runtime tuning:

- `SIMULATION_BATCH_SIZE`
- `SIMULATION_CONCURRENCY`
- `SIMULATION_WORKER_CONCURRENCY`
- `LLM_RPM_LIMIT`

### 2. Start dependencies and install packages

```bash
docker compose up -d neo4j redis minio
npm install
```

### 3. Run the Monte API

```bash
npm run dev
```

The API starts on `http://localhost:3000` by default. Swagger docs are available at `http://localhost:3000/docs`.

### 4. Install the global CLI

```bash
npm install -g monte-engine
monte config set-api http://localhost:3000
```

### 5. Verify the stack

```bash
monte doctor
monte doctor --json
```

## Global CLI Install

The published npm package is `monte-engine`, but the executable on your `PATH` is `monte`.

```bash
npm install -g monte-engine
monte config set-api http://localhost:3000
monte doctor
```

For local development inside this repo, use the source-running variant instead:

```bash
npm run cli:dev -- doctor
```

## Agent Integration

Monte is designed to be usable as a CLI step inside external agent systems like Claude Code, OpenClaw, or Hermes. The agent-facing entrypoint is `monte decide`.

Preflight:

```bash
monte config set-api http://localhost:3000
monte doctor --json
```

One-shot decision:

```bash
monte decide "should I quit my job to start a company?" --mode standard --wait --json
```

Async flow:

```bash
monte decide "should I move to Berlin for this job?" --mode fast --json
monte simulate progress <simulation-id> --json
monte simulate results <simulation-id> -f json
```

`monte decide --json` returns a single JSON object. Without `--wait`, it returns the queued simulation plus recommended polling commands. With `--wait`, it also returns a condensed decision bundle and the raw aggregated results payload.

## Quick Demo

Monte ships a synthetic persona generator, so you can exercise the full loop without exporting your own data first.

```bash
monte generate "26 year old software engineer who day trades, impulse spender, anxious about career growth"
monte ingest ./generated-persona
monte persona build
monte decide "should I quit my job and day trade with my savings?" --mode standard --wait
```

You can also compare sharply different personas:

```bash
monte generate "conservative 40 year old accountant, disciplined saver, risk-averse" -o ./persona-conservative
monte generate "25 year old crypto trader, YOLO mentality, high risk tolerance" -o ./persona-aggressive
```

Then ingest, build, and simulate each separately, or use `compare` for an A/B workflow.

## Progress Reporting

Simulation progress is phase-aware. Instead of appearing stuck at `95-99%`, Monte now surfaces the active phase:

- `queued`
- `executing`
- `persisting`
- `aggregating`
- `completed`
- `failed`

During execution, progress covers `0-90%`. Persistence covers `90-96%`. Aggregation uses stable end markers at `97-99%` so long-tail work is explained rather than looking frozen.

Example:

```bash
monte simulate "should I buy this house?" --wait
monte simulate progress <simulation-id> --json
```

## Common CLI Workflows

### Persona workflow

```bash
monte ingest ./path/to/data
monte persona build
monte persona status
monte persona psychology
```

### Simulation workflow

```bash
monte simulate "should I quit my job and start a business?" --wait
monte simulate evidence <simulation-id> --recommendation 1 --result positive --signal "Customer interviews converted at 3x the prior rate"
monte simulate rerun <simulation-id> --wait
```

### Development workflow inside this repo

```bash
npm run cli:dev -- ingest ./path/to/data
npm run cli:dev -- persona build
npm run cli:dev -- decide "should I do this?" --mode standard --wait --json
```

## Built-in Scenario Types

Monte currently ships 8 scenario types including `custom`:

- `day_trading`
- `startup_founding`
- `career_change`
- `advanced_degree`
- `geographic_relocation`
- `real_estate_purchase`
- `health_fitness_goal`
- `custom`

## Benchmark Harness

The benchmark harness is a first-class regression surface for the simulation stack. It verifies:

- calibration error
- static policy regret
- uncertainty reduction after evidence
- deterministic stability drift

Commands:

```bash
npm run benchmark:pretty
npm run benchmark -- --output benchmark-suite.json
npm run test:benchmarks
```

Current fixture corpus:

- `startup_founding_seeded_corpus`
- `real_estate_purchase_carry_costs`
- `day_trading_edge_discipline`

## Project Map

- `src/index.ts` -> Fastify bootstrap and route registration
- `src/api/` -> HTTP routes and plugins
- `src/cli/` -> CLI bootstrap, config, and commands
- `src/ingestion/` -> ingestion, extractors, contradictions, queues
- `src/persona/` -> dimension mapping, graph build, compression, psychology, clone generation
- `src/simulation/` -> scenario compilation, engine, aggregation, evidence loop, progress helpers
- `src/benchmarks/` -> seeded benchmark harness
- `tests/` -> Vitest suites
- `docs/architecture.md` -> system architecture
- `CONTEXT.md` -> durable repo state
- `SKILL.md` -> repo-aware coding guidance
- `AGENTS.md` -> agent operating rules for this repository

## Development Notes

- Signal extraction is rule-based; do not route extraction through an LLM.
- Use the `openai` SDK for provider integrations.
- If simulation semantics change, rerun the benchmark harness.
- If architecture or commands change, keep `README.md`, `CONTEXT.md`, `AGENTS.md`, `docs/architecture.md`, and `SKILL.md` aligned.
- `connect` / Composio exists but is still experimental.
