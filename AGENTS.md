# AGENTS

This repository is a self-hosted Monte backend. Treat the current product as a Fastify API that can serve a bundled dashboard plus a globally installable and repo-local CLI for persona-driven decision simulation, evidence-adjusted reruns, machine-readable agent workflows, and deterministic benchmark validation.

## Read first

1. `README.md`
2. `CONTEXT.md`
3. `docs/architecture.md`
4. `SKILL.md`

## Repo facts you should not get wrong

- The API framework is Fastify, not Express.
- Open-source mode uses injected local auth via `src/api/plugins/auth.ts`.
- The persona model is 9-dimensional:
  - `riskTolerance`
  - `timePreference`
  - `socialDependency`
  - `learningStyle`
  - `decisionSpeed`
  - `emotionalVolatility`
  - `executionGap`
  - `informationSeeking`
  - `stressResponse`
- Monte currently ships 8 scenario types including `custom`.
- The simulation stack includes a causal state model, belief state model, experiment recommendations, evidence capture, evidence-adjusted reruns, phase-aware live progress, and batched clone-result persistence.
- Monte now also uses a node-frontier scheduler, batches concurrent LLM decisions by decision node, and stores runtime telemetry on completed simulations.
- The batched evaluator can now learn smaller preferred batch sizes after repeated provider-side batch failures; do not remove that adaptive recovery without replacing the performance guardrail.
- The benchmark harness is a first-class regression surface and must stay deterministic.
- The npm package is `monte-engine`; the installed executable is `monte`.
- A GitHub Packages mirror is published as `@elironb/monte-engine` for repository-linked package visibility.
- The globally installed CLI can store provider credentials in `~/.monte/config.json`.
- A bundled starter persona is shipped in `examples/personas/starter` and exposed by `monte example`.
- The npm package now ships a bundled dashboard that Fastify can serve on the same origin as the API.
- A repo-local dashboard still lives in `apps/web`, runs on port `3001` by default, and talks to the Fastify API on port `3000` through `VITE_MONTE_API_BASE_URL`.

## High-leverage files

- `src/server.ts` -> shared runtime bootstrap and bundled dashboard serving
- `src/index.ts` -> default runtime entrypoint
- `src/api/routes/persona.ts` -> persona API
- `src/api/routes/simulation.ts` -> simulation, evidence, and rerun API
- `src/api/routes/stream.ts` -> progress REST and SSE
- `apps/web/src/App.tsx` -> dashboard shell and route map
- `apps/web/src/lib/api.ts` -> frontend API client
- `apps/web/src/pages/` -> overview, persona, simulation, live run, results, evidence, and sources views
- `src/cli/commands/simulation.ts` -> simulation CLI
- `src/cli/commands/decide.ts` -> agent-first decision CLI
- `src/cli/commands/doctor.ts` -> readiness CLI
- `src/persona/dimensionMapper.ts` -> source of truth for dimensions
- `src/persona/psychologyLayer.ts` -> derived psychology model
- `src/persona/cloneGenerator.ts` -> stratified clone generation
- `src/simulation/decisionGraph.ts` -> scenario graphs and shared outcome semantics
- `src/simulation/engine.ts` -> clone execution
- `src/simulation/resultAggregator.ts` -> aggregate results
- `src/simulation/resultPersistence.ts` -> batched clone-result persistence
- `src/simulation/runtimeTelemetry.ts` -> runtime telemetry rollup
- `src/simulation/evidenceLoop.ts` -> evidence adjustments and rerun comparison
- `src/simulation/progress.ts` -> phase-aware progress math
- `src/benchmarks/fixtures.ts` -> seeded fixture corpus
- `src/benchmarks/harness.ts` -> benchmark metrics and execution
- `tests/benchmarks/harness.test.ts` -> benchmark assertions

## Guardrails

- Keep signal extraction rule-based.
- Use the `openai` SDK for model providers; do not add provider-specific SDKs.
- Use `pino` and repo logging conventions in server code; avoid `console.log` in `src/` outside the CLI.
- If you change outcome semantics, keep the scenario, engine, aggregation, and benchmark path aligned.
- If you change the benchmark harness, preserve seeded per-run randomness.
- Treat `src/persona/dimensionMapper.ts` as the authoritative dimension list. Some display and reporting code still contains legacy hardcoded subsets.
- `connect` / Composio support is experimental. Do not document it as a fully supported ingestion path.
- When architecture or user-facing commands change, update `README.md`, `CONTEXT.md`, `AGENTS.md`, `docs/architecture.md`, and `SKILL.md` together.

## Validation checklist

For code changes that touch behavior:

```bash
npm run build
npm test -- --run
npm run test:benchmarks
npm run benchmark:pretty
```

For package or CLI distribution changes:

```bash
npm pack
```

For CLI and API setup checks:

```bash
npm run cli:dev -- doctor
monte doctor --json
```

For dashboard changes:

```bash
npm run web:build
monte start
```

For docs-only changes, at minimum review the working tree and make sure the major docs stay internally consistent.

## Common workflows

### Persona workflow

Repo-local:

```bash
npm run cli:dev -- ingest ./path/to/data
npm run cli:dev -- persona build
npm run cli:dev -- persona status
npm run cli:dev -- persona psychology
```

Installed CLI:

```bash
monte example ingest starter
monte ingest ./path/to/data
monte persona build
monte persona status
monte persona psychology
```

### Simulation workflow

Repo-local:

```bash
npm run cli:dev -- simulate "should I quit my job and start a business?" --wait
npm run cli:dev -- simulate evidence <simulation-id> --recommendation 1 --result positive --signal "Observed a strong signal"
npm run cli:dev -- simulate rerun <simulation-id> --wait
```

Installed CLI:

```bash
monte simulate "should I quit my job and start a business?" --wait
monte simulate progress <simulation-id> --json
monte simulate results <simulation-id> -f json
```

### Dashboard workflow

```bash
monte start
```

Repo-local development with live frontend edits:

```bash
npm run dev
npm run web:dev
```

### Agent workflow

```bash
monte config set-api http://localhost:3000
monte config set-provider openrouter
monte config set-api-key <key>
monte example ingest starter
monte doctor --json
monte decide "should I make this move?" --mode standard --wait --json
```

### Benchmark workflow

```bash
npm run benchmark:pretty
npm run benchmark -- --output benchmark-suite.json
npm run test:benchmarks
```

## If you are touching specific areas

- Scenario graph changes: update `src/simulation/decisionGraph.ts`, then rerun benchmarks.
- Evidence-loop changes: audit `src/simulation/evidenceLoop.ts`, `src/api/routes/simulation.ts`, `src/cli/commands/simulation.ts`, `src/cli/commands/decide.ts`, and benchmark expectations.
- Progress or wait-loop changes: audit `src/simulation/progress.ts`, `src/api/routes/stream.ts`, `src/ingestion/queue/workers/index.ts`, and `src/cli/commands/simulation.ts`.
- Throughput changes: audit `src/simulation/forkEvaluator.ts`, `src/simulation/engine.ts`, `src/simulation/runtimeTelemetry.ts`, `src/ingestion/queue/workers/index.ts`, and the CLI results output together.
- Throughput config changes: keep `SIMULATION_DECISION_CONCURRENCY`, `SIMULATION_ACTIVE_FRONTIER`, `SIMULATION_DECISION_BATCH_SIZE`, and the legacy `SIMULATION_CONCURRENCY` alias documented consistently.
- Dimension changes: audit `src/persona/dimensionMapper.ts`, persona graph and compression, CLI and report surfaces, and docs.
- Benchmark changes: update both the harness and its tests.
- Package and install changes: audit `package.json`, CLI entrypoints, and the major docs together.

## Default stance

Prefer small, verifiable changes. When in doubt, align docs with the shipped code rather than older roadmap language.
