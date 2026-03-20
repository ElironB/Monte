# End-to-End Smoke Test

## What it tests

Full pipeline from empty database to final report:
1. Infrastructure startup (Neo4j, Redis, MinIO)
2. API server health
3. Data ingestion (file upload + processing)
4. Persona building (signal extraction → dimension mapping)
5. Simulation execution (clone generation → decision tree)
6. Report generation (markdown output with narrative)

## Prerequisites

- Docker with Compose support
- Node.js 20+
- Valid LLM API key (`OPENROUTER_API_KEY`, `GROQ_API_KEY`, or `LLM_API_KEY`)
- Valid embedding key (`OPENROUTER_API_KEY` or `EMBEDDING_API_KEY`)

## Running

```bash
npm run test:e2e
```

**Expected runtime:** 2-5 minutes (depends on LLM provider speed)

## What success looks like

- All pipeline steps complete without errors
- Final report contains narrative + probability distribution
- Exit code 0

## Troubleshooting

If a step fails:
1. Check `docker compose logs` or `docker-compose logs` for infrastructure errors
2. Check API server logs in `/tmp/monte-e2e-server.log`
3. Run `npm run cli:dev -- doctor` to verify configuration
