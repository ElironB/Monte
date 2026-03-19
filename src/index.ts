import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';

import { config } from './config/index.js';
import { initializeSchema } from './config/neo4j-schema.js';
import { closeNeo4j } from './config/neo4j.js';
import { closeRedis } from './config/redis.js';
import { initializeTracing, shutdownTracing } from './config/tracing.js';
import { logger } from './utils/logger.js';
import { closeQueues } from './ingestion/queue/ingestionQueue.js';
import { stopWorkers, startWorkers } from './ingestion/queue/workers/index.js';

import authPlugin from './api/plugins/auth.js';
import rateLimitPlugin from './api/plugins/rateLimit.js';
import schemaPlugin from './api/plugins/schema.js';
import apiKeyPlugin from './api/plugins/apiKey.js';

import authRoutes from './api/routes/auth.js';
import userRoutes from './api/routes/users.js';
import healthRoutes from './api/routes/health.js';
import ingestionRoutes from './api/routes/ingestion.js';
import personaRoutes from './api/routes/persona.js';
import simulationRoutes from './api/routes/simulation.js';
import cliRoutes from './api/routes/cli.js';
import apiKeyRoutes from './api/routes/apikeys.js';
import streamRoutes from './api/routes/stream.js';

import { getErrorResponse } from './utils/errors.js';

// Initialize OpenTelemetry tracing
initializeTracing();

const app = Fastify({ logger: false, trustProxy: true });

await app.register(helmet);
await app.register(cors, { origin: config.server.nodeEnv === 'development', credentials: true });

await app.register(authPlugin);
await app.register(apiKeyPlugin);
await app.register(rateLimitPlugin);
await app.register(schemaPlugin);

await app.register(healthRoutes, { prefix: '/health' });
await app.register(authRoutes, { prefix: '/auth' });
await app.register(userRoutes, { prefix: '/users' });
await app.register(ingestionRoutes, { prefix: '/ingestion' });
await app.register(personaRoutes, { prefix: '/persona' });
await app.register(simulationRoutes, { prefix: '/simulation' });
await app.register(cliRoutes, { prefix: '/cli' });
await app.register(apiKeyRoutes, { prefix: '/api-keys' });
await app.register(streamRoutes, { prefix: '/stream' });

app.setErrorHandler((error, request, reply) => {
  const { message, code, statusCode } = getErrorResponse(error);
  logger.error({ err: error, request: { method: request.method, url: request.url } }, 'Request error');
  reply.status(statusCode).send({ error: message, code, requestId: request.id });
});

app.setNotFoundHandler((request, reply) => {
  reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND', path: request.url });
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down...');
  await app.close();
  await stopWorkers();
  await closeQueues();
  await shutdownTracing();
  await closeNeo4j();
  await closeRedis();
  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function start() {
  try {
    await initializeSchema();
    startWorkers();
    await app.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info({ port: config.server.port }, 'Monte Engine started');
    logger.info(`API documentation available at http://localhost:${config.server.port}/docs`);
  } catch (err) {
    logger.error({ err }, 'Failed to start');
    process.exit(1);
  }
}

start();
