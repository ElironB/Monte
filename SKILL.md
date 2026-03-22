# Monte Repository Skill

Use this file to get productive in the Monte codebase quickly.

## Mental model

Monte is a self-hosted decision engine with this core loop:

1. ingest personal data
2. extract behavioral signals and contradictions
3. map signals into a 9-dimension persona
4. derive a psychology layer
5. generate stratified clone variants
6. run scenario simulations
7. surface decision intelligence and experiments
8. record new evidence
9. create evidence-adjusted reruns
10. guard the whole system with a seeded benchmark harness

If you keep that loop in mind, most of the repository will make sense.

## Start here

- `README.md` — public overview and quickstart
- `CONTEXT.md` — durable repo state
- `docs/architecture.md` — deeper architecture
- `AGENTS.md` — repo guardrails for coding agents

## Files that matter most

- `src/index.ts` — API bootstrap
- `src/api/routes/persona.ts` — persona endpoints
- `src/api/routes/simulation.ts` — simulations, evidence, reruns
- `src/cli/commands/simulation.ts` — CLI simulation workflow
- `src/persona/dimensionMapper.ts` — source of truth for behavioral dimensions
- `src/persona/psychologyLayer.ts` — Big Five, attachment, locus, discounting, and risk flags
- `src/persona/cloneGenerator.ts` — stratified clones and psychology modifiers
- `src/simulation/decisionGraph.ts` — built-in scenario graphs and outcome semantics
- `src/simulation/engine.ts` — clone execution
- `src/simulation/resultAggregator.ts` — aggregate outputs
- `src/simulation/evidenceLoop.ts` — evidence deltas and rerun comparison
- `src/benchmarks/fixtures.ts` — seeded fixture corpus
- `src/benchmarks/harness.ts` — benchmark execution and scoring
- `tests/benchmarks/harness.test.ts` — benchmark contract

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
- There are 8 built-in scenarios plus `custom`.
- Signal extraction is rule-based.
- The benchmark harness is part of the product contract, not an optional extra.

## Practical guardrails

- Use the `openai` SDK for model access.
- Do not add provider-specific SDKs unless the architecture is explicitly being changed.
- Do not move source extraction into an LLM step.
- Do not let outcome bucketing diverge between the scenario/engine/aggregator paths.
- Do not replace seeded benchmark randomness with a constant `Math.random`.
- Treat `connect` / Composio as experimental.
- When public behavior changes, keep the main docs synchronized.

## Common task recipes

### If you change a scenario

- update `src/simulation/decisionGraph.ts`
- audit `src/simulation/engine.ts` and `src/simulation/resultAggregator.ts`
- run benchmarks

### If you change evidence behavior

- update `src/simulation/evidenceLoop.ts`
- audit `src/api/routes/simulation.ts`
- audit `src/cli/commands/simulation.ts`
- rerun benchmark and tests

### If you change dimensions or persona logic

- update `src/persona/dimensionMapper.ts` first
- audit graph persistence and compression
- audit CLI/reporting surfaces that may still hardcode a legacy subset of dimensions
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
npm run cli:dev -- doctor
```

## Useful CLI flows

```bash
npm run cli:dev -- ingest ./path/to/data
npm run cli:dev -- persona build
npm run cli:dev -- simulate "should I do this?" --wait
npm run cli:dev -- simulate evidence <simulation-id> --recommendation 1 --result mixed --signal "Observed a partial signal"
npm run cli:dev -- simulate rerun <simulation-id> --wait
```

## Final heuristic

When in doubt, trust the shipped code over older prose, and trust the benchmark harness over intuition.