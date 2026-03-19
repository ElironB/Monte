# Contributing to Monte Engine

## Development setup

```bash
git clone https://github.com/YOUR_USERNAME/Monte.git
cd Monte
npm install
docker-compose up -d neo4j redis minio
npm run dev
```

## Tests

```bash
npm test
```

## Code style

- TypeScript only.
- Use the `openai` SDK with configurable `baseURL` for LLM calls.
- Do not import provider-specific SDKs.
- Keep changes focused and aligned with existing project structure.

## Pull requests

1. Fork the repository.
2. Create a branch from `main`.
3. Make focused changes with tests when applicable.
4. Open a pull request against `main` with a clear description.

## Reporting issues

- Include reproduction steps, expected behavior, and actual behavior.
- Share logs, stack traces, and environment details when relevant.
- Open security-sensitive reports privately instead of filing a public issue.

## LLM integration rule

LLM calls must go through the OpenAI SDK with a configurable `baseURL`. Never import Groq, Anthropic, OpenAI provider-specific wrappers, or other provider SDKs directly.
