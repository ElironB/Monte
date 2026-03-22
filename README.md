# Monte

> A flight simulator for life decisions.

**Ask Monte questions like:**

- Should I quit my job to start a company?
- Is buying a house right now smart?
- Should I move cities or change careers?

Monte is an open-source, self-hostable decision engine that ingests personal data, builds a behavioral persona, generates clone variants, and runs probabilistic simulations against real decision paths.

Instead of giving you a single prediction, Monte gives you:

- outcome distributions
- decision intelligence
- recommended experiments
- evidence-adjusted reruns as new information comes in

**Data → Signals → Persona → Clones → Simulation → Evidence loop**

## What it is in one screen

- **Not an oracle** — Monte stress-tests decisions instead of claiming to predict the future
- **Behavior-driven** — it uses revealed behavioral signals from your data, not just self-reported preferences
- **Probabilistic** — it returns distributions and scenario spread, not a single yes/no answer
- **Updatable** — you can record real-world evidence and rerun the model after learning something new

## What people use it for

- Stress-testing major life choices before acting
- Comparing how different personas behave under the same scenario
- Giving external tools or agents a decision layer through the API or CLI
- Regression-testing simulation quality with a deterministic benchmark harness

## Quick demo (no real data needed)

Monte ships a synthetic persona generator, so someone landing on the repo can understand the full loop without exporting their own data first:

```bash
npm run cli:dev -- generate "26 year old software engineer who day trades, impulse spender, anxious about career growth"
npm run cli:dev -- ingest ./generated-persona
npm run cli:dev -- persona build
npm run cli:dev -- simulate "should I quit my job and day trade with my savings?" --wait
```

Want to prove the system differentiates between people instead of returning generic advice?

```bash
npm run cli:dev -- generate "conservative 40 year old accountant, disciplined saver, risk-averse" -o ./persona-conservative
npm run cli:dev -- generate "25 year old crypto trader, YOLO mentality, high risk tolerance" -o ./persona-aggressive
```

Then ingest/build/simulate each persona separately, or use `compare` for an A/B-style workflow.

## What Monte does

- Ingests exported files and notes from multiple personal data sources
- Extracts behavioral signals and contradictions
- Maps signals into 9 behavioral dimensions:
  - `riskTolerance`
  - `timePreference`
  - `socialDependency`
  - `learningStyle`
  - `decisionSpeed`
  - `emotionalVolatility`
  - `executionGap`
  - `informationSeeking`
  - `stressResponse`
- Derives a psychology layer with Big Five, attachment style, locus of control, temporal discounting, and risk flags
- Generates a stratified population of clones instead of a single deterministic profile
- Runs decision simulations across 8 built-in scenarios plus a custom scenario
- Produces decision intelligence, experiment recommendations, evidence-adjusted reruns, and optional narrative summaries
- Ships a seeded benchmark harness for regression testing calibration, policy regret, evidence updates, and deterministic stability

## Current product shape

Monte currently ships as a self-hosted TypeScript backend with:

- a Fastify API
- a Commander-based CLI
- BullMQ workers for ingestion, persona builds, and simulation batches
- Neo4j for the persistent graph
- Redis for caching and queue transport
- MinIO for uploaded source storage

In open-source/self-hosted mode, auth is stubbed and requests run as a local user.

## Built-in scenarios

- `day_trading`
- `startup_founding`
- `career_change`
- `advanced_degree`
- `geographic_relocation`
- `real_estate_purchase`
- `health_fitness_goal`
- `custom`

## Quickstart

### Requirements

- Node.js 20+
- Docker and Docker Compose
- At least one chat-capable OpenAI-compatible model key
- An embedding-capable key for persona builds

The simplest setup is `OPENROUTER_API_KEY`, which can cover both chat and embeddings.

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at least:

- `NEO4J_PASSWORD`
- `OPENROUTER_API_KEY` (recommended), or equivalent chat plus embedding keys

### 2. Start dependencies and install packages

```bash
docker compose up -d neo4j redis minio
npm install
```

### 3. Run the API

```bash
npm run dev
```

The API starts on `http://localhost:3000` by default.
Swagger docs are available at `http://localhost:3000/docs`.

### 4. Verify the stack

```bash
npm run cli:dev -- doctor
```

## Typical workflow

### Ingest data

```bash
npm run cli:dev -- ingest ./path/to/data
```

### Build a persona

```bash
npm run cli:dev -- persona build
npm run cli:dev -- persona status
npm run cli:dev -- persona psychology
```

### Run a simulation

```bash
npm run cli:dev -- simulate "should I quit my job and start a company?" --wait
```

### Add evidence and rerun

```bash
npm run cli:dev -- simulate evidence <simulation-id> --recommendation 1 --result positive --signal "Customer interviews converted at 3x the prior rate"
npm run cli:dev -- simulate rerun <simulation-id> --wait
```

## Benchmark harness

The benchmark harness is the main regression check for the simulation layer. It uses a seeded fixture corpus and verifies:

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

## Project map

- `src/index.ts` — Fastify bootstrap and route registration
- `src/api/` — REST routes and plugins
- `src/cli/` — local CLI
- `src/ingestion/` — file ingestion, extractors, contradictions, queues
- `src/persona/` — dimension mapping, graph build, compression, psychology, clone generation
- `src/simulation/` — scenario compilation, state model, engine, aggregation, evidence loop
- `src/benchmarks/` — seeded benchmark harness
- `tests/` — Vitest suites
- `docs/architecture.md` — system architecture
- `SKILL.md` — repo-aware guidance for coding agents
- `AGENTS.md` — agent operating rules for this repository

## Development notes

- Signal extraction is rule-based; do not move extraction into the LLM path.
- Use the `openai` SDK for provider integrations instead of provider-specific SDKs.
- If you change simulation semantics, run the benchmark harness.
- If you change public behavior or architecture, keep `README.md`, `CONTEXT.md`, `AGENTS.md`, `docs/architecture.md`, and `SKILL.md` aligned.
- The `connect` / Composio workflow exists but is still experimental.

## Contributing

See `CONTRIBUTING.md`.