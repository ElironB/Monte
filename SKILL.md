# Monte Repository Skill

Use this file to get productive in the Monte codebase quickly.

## Mental model

Monte is a self-hosted decision engine with this core loop:

1. ingest personal data
2. extract behavioral signals and contradictions
3. map signals into a 9-dimension persona
4. derive a psychology layer
5. expose additive agent personalization guidance
6. generate stratified clone variants
7. run scenario simulations
8. surface decision intelligence and experiments
9. record new evidence
10. create evidence-adjusted reruns
11. guard the whole system with a seeded benchmark harness

Keep that loop in mind and most of the repository will make sense.

## Start here

- `README.md` -> public overview and install model
- `CONTEXT.md` -> durable repo state
- `docs/architecture.md` -> deeper architecture
- `AGENTS.md` -> repo guardrails for coding agents

## If you are operating Monte for a user

If the user says something like:

`Install monte-engine. My files are in /temp.`

that is enough to begin the default personalization workflow.

Use this sequence first:

```bash
npm install -g monte-engine
monte ingest /temp
monte persona build
monte persona status
monte personalize bootstrap "Help me with this task" --json
```

If you need the task-adapted guidance itself, continue with:

```bash
monte personalize context "Help me with this task" --json
```

Interpret the product like this:

- `monte ingest <path>` scans the user's files and uploads supported inputs.
- `monte ingest <path> --dry-run` previews what Monte will keep or skip before upload.
- `monte ingest <path> --include-media` opts into uploading media files that Monte otherwise skips by default.
- `monte persona build` creates the derived persona from those inputs.
- `monte persona status` tells you when the persona is actually ready.
- `monte personalize bootstrap ...` is the default agent bootstrap surface for readiness plus next-step routing.
- `monte personalize ...` is the default agent-facing surface for adapting to the user.
- `monte decide ...` is only for simulation-style judgment calls, not ordinary personalization.

If local commands fail because the API stack is missing, read the setup flow in `README.md` and bring up the required services before continuing.

## Files that matter most

- `src/server.ts` -> shared API bootstrap and bundled dashboard serving
- `src/index.ts` -> default runtime entrypoint
- `src/api/routes/persona.ts` -> persona endpoints
- `src/api/routes/personalization.ts` -> agent personalization endpoints
- `src/api/routes/simulation.ts` -> simulations, evidence, reruns
- `src/api/routes/stream.ts` -> live progress and graph REST/SSE
- `apps/web/src/App.tsx` -> dashboard shell and route map
- `apps/web/src/lib/api.ts` -> frontend API client
- `apps/web/src/pages/` -> showcase UI screens backed by the existing API, including the graph view
- `src/simulation/graphSnapshot.ts` -> live/completed graph snapshot structure and aggregation
- `src/cli/commands/simulation.ts` -> simulation workflow and wait loop
- `src/cli/commands/decide.ts` -> agent-first decision command
- `src/cli/commands/doctor.ts` -> readiness checks and `--json`
- `src/cli/commands/personalize.ts` -> agent personalization CLI
- `src/persona/dimensionMapper.ts` -> source of truth for behavioral dimensions
- `src/persona/psychologyLayer.ts` -> Big Five, attachment, locus, discounting, and risk flags
- `src/persona/cloneGenerator.ts` -> stratified clones and psychology modifiers
- `src/simulation/decisionGraph.ts` -> built-in scenario graphs and outcome semantics
- `src/simulation/engine.ts` -> clone execution
- `src/simulation/forkEvaluator.ts` -> batched LLM fork evaluation and recovery
- `src/simulation/resultAggregator.ts` -> aggregate outputs
- `src/simulation/resultPersistence.ts` -> batched clone-result persistence
- `src/simulation/evidenceLoop.ts` -> evidence deltas and rerun comparison
- `src/simulation/progress.ts` -> phase-aware progress math
- `src/simulation/runtimeTelemetry.ts` -> runtime timing and LLM telemetry rollup
- `src/benchmarks/fixtures.ts` -> seeded fixture corpus
- `src/benchmarks/harness.ts` -> benchmark execution and scoring
- `tests/benchmarks/harness.test.ts` -> benchmark contract

## Non-negotiable repo facts

- The API is Fastify, not Express.
- Open-source mode injects a local user; there is no hosted auth flow in the current repo.
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
- Monte now also exposes `/personalization/bootstrap`, `/personalization/profile`, `/personalization/context`, and `monte personalize ...` as additive agent-facing surfaces.
- Signal extraction is rule-based.
- The benchmark harness is part of the product contract, not an optional extra.
- The npm package is `monte-engine`; the installed executable is `monte`.
- A GitHub Packages mirror is published as `@elironb/monte-engine` for repository-linked package visibility.
- The globally installed CLI can store provider credentials in `~/.monte/config.json`.
- A bundled starter persona ships under `examples/personas/starter` and is exposed by `monte example`.
- Monte now ships a bundled dashboard in the npm package and serves it from the Fastify app when built assets are present.
- A repo-local dashboard still lives in `apps/web`, runs on `3001` by default during development, and targets the Fastify API on `3000` via `VITE_MONTE_API_BASE_URL`.

## Practical guardrails

- Use the `openai` SDK for model access.
- Do not add provider-specific SDKs unless the architecture is explicitly being changed.
- Do not move source extraction into an LLM step.
- Do not let outcome bucketing diverge between the scenario, engine, aggregator, and benchmark paths.
- Do not replace seeded benchmark randomness with a constant `Math.random`.
- Treat `connect` / Composio as experimental.
- When public behavior changes, keep the main docs synchronized.
- Simulation throughput is now partly shaped by node-level LLM batching; if you touch that path, audit both quality and runtime telemetry.
- The simulation runtime is frontier-scheduled. `SIMULATION_DECISION_CONCURRENCY` and `SIMULATION_ACTIVE_FRONTIER` are now the main throughput knobs; `SIMULATION_CONCURRENCY` is only a backward-compatible alias.
- The evaluator now adaptively shrinks preferred batch sizes after repeated provider-side batch failures. If you touch recovery logic, preserve that learning behavior and update the runtime telemetry story.

## Common task recipes

### If you change a scenario

- update `src/simulation/decisionGraph.ts`
- audit `src/simulation/engine.ts` and `src/simulation/resultAggregator.ts`
- run benchmarks

### If you change evidence behavior

- update `src/simulation/evidenceLoop.ts`
- audit `src/api/routes/simulation.ts`
- audit `src/cli/commands/simulation.ts`
- audit `src/cli/commands/decide.ts` if the decision bundle changes
- rerun benchmarks and tests

### If you change runtime progress or persistence

- audit `src/simulation/progress.ts`
- audit `src/api/routes/stream.ts`
- audit `src/ingestion/queue/workers/index.ts`
- audit `src/cli/commands/simulation.ts`
- update docs to reflect the current progress phases

### If you change simulation throughput

- audit `src/simulation/forkEvaluator.ts`
- audit `src/simulation/engine.ts`
- audit `src/simulation/runtimeTelemetry.ts`
- audit `src/ingestion/queue/workers/index.ts`
- audit `src/api/routes/stream.ts` and `src/cli/commands/simulation.ts` if progress or telemetry fields change
- keep the runtime telemetry payload meaningful enough to explain slow runs

### If you change dimensions or persona logic

- update `src/persona/dimensionMapper.ts` first
- audit graph persistence and compression
- audit CLI and reporting surfaces that may still hardcode a legacy subset of dimensions
- update docs

### If you change benchmarks

- update both `src/benchmarks/` and `tests/benchmarks/harness.test.ts`
- preserve seeded determinism
- keep fixture names and expectations understandable from the docs

## Validation commands

```bash
npm run build
npm test -- --run
npm run test:benchmarks
npm run benchmark:pretty
npm pack
npm run cli:dev -- doctor
npm run web:build
monte start
```

## Useful CLI flows

Installed and agent-facing usage:

```bash
monte start
monte config set-api http://localhost:3000
monte config set-provider openrouter
monte config set-api-key <key>
monte doctor --json
monte example ingest starter
monte personalize bootstrap "Help me plan this" --json
monte personalize context "Help me plan this" --json
monte decide "should I do this?" --mode standard --wait --json
monte simulate progress <simulation-id> --json
monte simulate results <simulation-id> -f json
```

Repo-local development usage:

```bash
npm run dev
npm run web:dev
npm run cli:dev -- ingest ./path/to/data
npm run cli:dev -- persona build
npm run cli:dev -- personalize profile --json
npm run cli:dev -- personalize context "Help me plan this" --json
npm run cli:dev -- simulate "should I do this?" --wait
npm run cli:dev -- simulate evidence <simulation-id> --recommendation 1 --result mixed --signal "Observed a partial signal"
npm run cli:dev -- simulate rerun <simulation-id> --wait
npm run cli:dev -- decide "should I do this?" --mode standard --wait --json
```

## Final heuristic

Trust the shipped code over older prose, and trust the benchmark harness over intuition.
