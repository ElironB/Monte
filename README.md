# Monte Engine

Probabilistic life simulation platform.

## Quick Start

```bash
cp .env.example .env
docker-compose up -d neo4j redis minio
npm install
npm run dev
```

## API

- `POST /auth/register` - Register
- `POST /auth/login` - Login
- `GET /auth/me` - Current user
- `GET /persona` - Get persona
- `POST /persona` - Build persona
- `GET /simulation` - List simulations
- `POST /simulation` - Create simulation
- `GET /health/ready` - Health check

## Architecture

- Fastify + TypeScript
- Neo4j (graph database)
- Redis (queues/cache)
- MinIO (object storage)
- BullMQ (job queues)
