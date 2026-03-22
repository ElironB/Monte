# AGENTS

This repository is a self-hosted Monte backend. Treat the current product as a Fastify API plus local CLI for persona-driven decision simulation, evidence-adjusted reruns, and deterministic benchmark validation.

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
- There are 8 built-in scenarios plus `custom`.
- The simulation stack includes a causal state model, belief state model, experiment recommendations, evidence capture, and evidence-adjusted reruns.
- The benchmark harness is a first-class regression surface and must stay deterministic.

## High-leverage files

- `src/index.ts` — runtime bootstrap
- `src/api/routes/persona.ts` — persona API
- `src/api/routes/simulation.ts` — simulation/evidence/rerun API
- `src/cli/commands/simulation.ts` — simulation CLI
- `src/persona/dimensionMapper.ts` — source of truth for dimensions
- `src/persona/psychologyLayer.ts` — derived psychology model
- `src/persona/cloneGenerator.ts` — stratified clone generation
- `src/simulation/decisionGraph.ts` — scenario graphs and shared outcome semantics
- `src/simulation/engine.ts` — clone execution
- `src/simulation/resultAggregator.ts` — aggregate results
- `src/simulation/evidenceLoop.ts` — evidence adjustments and rerun comparison
- `src/benchmarks/fixtures.ts` — seeded fixture corpus
- `src/benchmarks/harness.ts` — benchmark metrics and execution
- `tests/benchmarks/harness.test.ts` — benchmark assertions

## Guardrails

- Keep signal extraction rule-based.
- Use the `openai` SDK for model providers; do not add provider-specific SDKs.
- Use `pino` and repo logging conventions in server code; avoid `console.log` in `src/` outside the CLI.
- If you change outcome semantics, keep the scenario/engine/aggregation/benchmark path aligned.
- If you change the benchmark harness, preserve seeded per-run randomness.
- Treat `src/persona/dimensionMapper.ts` as the authoritative dimension list. Some display/reporting code still contains legacy hardcoded subsets.
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

For CLI/API setup checks:

```bash
npm run cli:dev -- doctor
```

For docs-only changes, at minimum review the working tree and make sure the major docs stay internally consistent.

## Common workflows

### Persona workflow

```bash
npm run cli:dev -- ingest ./path/to/data
npm run cli:dev -- persona build
npm run cli:dev -- persona status
npm run cli:dev -- persona psychology
```

### Simulation workflow

```bash
npm run cli:dev -- simulate "should I quit my job and start a business?" --wait
npm run cli:dev -- simulate evidence <simulation-id> --recommendation 1 --result positive --signal "Observed a strong signal"
npm run cli:dev -- simulate rerun <simulation-id> --wait
```

### Benchmark workflow

```bash
npm run benchmark:pretty
npm run benchmark -- --output benchmark-suite.json
npm run test:benchmarks
```

## If you are touching specific areas

- Scenario graph changes: update `src/simulation/decisionGraph.ts`, then rerun benchmarks.
- Evidence-loop changes: audit `src/simulation/evidenceLoop.ts`, `src/api/routes/simulation.ts`, `src/cli/commands/simulation.ts`, and benchmark expectations.
- Dimension changes: audit `src/persona/dimensionMapper.ts`, persona graph/compression, CLI/report surfaces, and docs.
- Benchmark changes: update both the harness and its tests.

## Default stance

Prefer small, verifiable changes. When in doubt, align docs with the shipped code rather than older roadmap language.