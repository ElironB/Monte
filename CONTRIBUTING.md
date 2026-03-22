# Contributing to Monte Engine

Thank you for your interest in contributing! Monte Engine is a self-hostable probabilistic life simulation platform. Below is everything you need to get started.

---

## Quick Start

```bash
git clone https://github.com/ElironB/Monte.git
cd Monte
cp .env.example .env
# Edit .env — set NEO4J_PASSWORD and OPENROUTER_API_KEY (or GROQ_API_KEY + EMBEDDING_API_KEY)
docker-compose up -d neo4j redis minio
npm install
npm run dev
# API at http://localhost:3000, Swagger docs at http://localhost:3000/docs
```

---

## Running Tests

Tests that require Neo4j/MinIO credentials will fail without a running stack. Pure-logic tests (persona, clones, dimensions, benchmarks) run anywhere:

```bash
# Run all tests
npm test

# Run only pure-logic tests (no infra required)
npx vitest run tests/persona tests/clones.test.ts tests/dimensions.test.ts tests/benchmarks
```

---

## Code Style

- **TypeScript only** — all source files must be `.ts`
- **LLM calls** go through the `openai` SDK with a configurable `baseURL`. Never import provider-specific SDKs (`groq-sdk`, `@anthropic-ai/sdk`, etc.)
- **No new npm dependencies** without discussion — the project intentionally keeps deps minimal
- **Pino for server logging** — never use `console.log` in `src/` outside of `src/cli/`
- **Pure synchronous preferred** — avoid async where not needed (see `PsychologyLayer` as an example)
- **All new dimensions are optional** — backward compatibility must be maintained for existing personas

---

## Project Structure

The key areas of the codebase:

| Directory | Purpose |
|---|---|
| `src/ingestion/extractors/` | Rule-based signal extractors (no LLM) |
| `src/persona/` | DimensionMapper → GraphBuilder → PersonaCompressor → PsychologyLayer → CloneGenerator |
| `src/simulation/` | Decision graph, fork evaluator, world agents, result aggregation |
| `src/cli/commands/` | CLI commands — one file per command group |
| `src/api/routes/` | Fastify REST routes |

Read `CONTEXT.md` before making any changes — it documents every architectural decision and what was recently changed.

---

## Pull Requests

1. Fork the repository
2. Create a branch from `main`: `git checkout -b feat/your-feature`
3. Write focused, tested changes
4. Ensure existing tests pass: `npm test`
5. Open a PR against `main` with a clear title and description
6. Reference any related issues

**PR title format**: `feat: ...` / `fix: ...` / `docs: ...` / `refactor: ...`

---

## Reporting Issues

- Include **reproduction steps**, expected vs actual behavior
- Share **logs** and **stack traces** when relevant (`LOG_LEVEL=debug`)
- For **security vulnerabilities**, report privately — do not open a public issue

---

## Key Rules

1. **No hardcoded secrets** — use environment variables, never commit `.env` files
2. **LLM via OpenAI SDK only** — `import OpenAI from 'openai'` with `baseURL` override
3. **Signal extraction is rule-based** — regex/pattern matching, not LLM (cost constraint)
4. **Clones are parameter variants** — 1000 clones on the same 9 dimensions, different values
5. **World agents must use empirical data** — cite sources if adding base rates
6. **No auth in open source** — `request.user.userId` is always `local-user`
