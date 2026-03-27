import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';

import { config } from './config/index.js';
import { initializeSchema } from './config/neo4j-schema.js';
import { validateStartupConfig } from './config/validator.js';
import { closeNeo4j, runWriteSingle } from './config/neo4j.js';
import { closeRedis } from './config/redis.js';
import { initializeTracing, shutdownTracing } from './config/tracing.js';
import { logger } from './utils/logger.js';
import { closeQueues } from './ingestion/queue/ingestionQueue.js';
import { stopWorkers, startWorkers } from './ingestion/queue/workers/index.js';

import authPlugin from './api/plugins/auth.js';
import rateLimitPlugin from './api/plugins/rateLimit.js';
import schemaPlugin from './api/plugins/schema.js';

import userRoutes from './api/routes/users.js';
import healthRoutes from './api/routes/health.js';
import ingestionRoutes from './api/routes/ingestion.js';
import personaRoutes from './api/routes/persona.js';
import personalizationRoutes from './api/routes/personalization.js';
import simulationRoutes from './api/routes/simulation.js';
import cliRoutes from './api/routes/cli.js';
import streamRoutes from './api/routes/stream.js';

import { getErrorResponse } from './utils/errors.js';

const RESERVED_ROUTE_PREFIXES = ['/health', '/users', '/ingestion', '/persona', '/personalization', '/simulation', '/cli', '/stream', '/docs'];

const LOCAL_USER_ID = 'local-user';
const LOCAL_USER_EMAIL = 'local@monte.localhost';

let tracingInitialized = false;
let shutdownHandlersRegistered = false;

export interface CreateMonteServerOptions {
  enableDashboard?: boolean;
}

export interface StartMonteServerOptions extends CreateMonteServerOptions {
  host?: string;
  port?: number;
  registerSignalHandlers?: boolean;
}

export interface CreatedMonteServer {
  app: FastifyInstance;
  dashboardRoot: string | null;
}

export interface StartedMonteServer extends CreatedMonteServer {
  close: () => Promise<void>;
}

function ensureTracingInitialized(): void {
  if (!tracingInitialized) {
    initializeTracing();
    tracingInitialized = true;
  }
}

function resolveBundledDashboardRoot(): string | null {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const dashboardRoot = path.resolve(currentDir, '../apps/web/dist');

  return existsSync(path.join(dashboardRoot, 'index.html')) ? dashboardRoot : null;
}

function isReservedPath(pathname: string): boolean {
  return RESERVED_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function shouldServeDashboard(request: FastifyRequest): boolean {
  if (request.method !== 'GET') {
    return false;
  }

  const pathname = request.url.split('?')[0] ?? '/';
  if (pathname.includes('.') || isReservedPath(pathname)) {
    return false;
  }

  const acceptHeader = request.headers.accept;
  return acceptHeader === undefined || acceptHeader.includes('text/html') || acceptHeader.includes('*/*');
}

async function ensureLocalUser(): Promise<void> {
  await runWriteSingle(
    `MERGE (u:User {id: $userId})
     ON CREATE SET u.email = $email, u.name = 'Local User', u.createdAt = datetime(), u.updatedAt = datetime()
     RETURN u.id as id`,
    { userId: LOCAL_USER_ID, email: LOCAL_USER_EMAIL }
  );
}

export async function createMonteServer(options: CreateMonteServerOptions = {}): Promise<CreatedMonteServer> {
  ensureTracingInitialized();

  const app = Fastify({ logger: false, trustProxy: true });
  const dashboardRoot = options.enableDashboard === false ? null : resolveBundledDashboardRoot();

  await app.register(helmet);
  await app.register(cors, { origin: config.server.nodeEnv === 'development', credentials: true });

  await app.register(authPlugin);
  await app.register(rateLimitPlugin);
  await app.register(schemaPlugin);

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(userRoutes, { prefix: '/users' });
  await app.register(ingestionRoutes, { prefix: '/ingestion' });
  await app.register(personaRoutes, { prefix: '/persona' });
  await app.register(personalizationRoutes, { prefix: '/personalization' });
  await app.register(simulationRoutes, { prefix: '/simulation' });
  await app.register(cliRoutes, { prefix: '/cli' });
  await app.register(streamRoutes, { prefix: '/stream' });

  if (dashboardRoot) {
    await app.register(fastifyStatic, {
      root: dashboardRoot,
      prefix: '/',
      wildcard: false,
    });
  }

  app.setErrorHandler((error, request, reply) => {
    const { message, code, statusCode } = getErrorResponse(error);
    logger.error({ err: error, request: { method: request.method, url: request.url } }, 'Request error');
    reply.status(statusCode).send({ error: message, code, requestId: request.id });
  });

  app.setNotFoundHandler((request, reply) => {
    if (dashboardRoot && shouldServeDashboard(request)) {
      return reply.type('text/html').sendFile('index.html');
    }

    return reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND', path: request.url });
  });

  return { app, dashboardRoot };
}

async function closeResources(app: FastifyInstance): Promise<void> {
  await app.close();
  await stopWorkers();
  await closeQueues();
  await shutdownTracing();
  await closeNeo4j();
  await closeRedis();
}

function registerShutdownHandlers(close: () => Promise<void>): void {
  if (shutdownHandlersRegistered) {
    return;
  }

  shutdownHandlersRegistered = true;

  const handleSignal = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');

    try {
      await close();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err, signal }, 'Failed to shut down cleanly');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => {
    void handleSignal('SIGTERM');
  });

  process.on('SIGINT', () => {
    void handleSignal('SIGINT');
  });
}

export async function startMonteServer(options: StartMonteServerOptions = {}): Promise<StartedMonteServer> {
  const { app, dashboardRoot } = await createMonteServer(options);
  const host = options.host ?? '0.0.0.0';
  const port = options.port ?? config.server.port;
  let closed = false;

  const close = async () => {
    if (closed) {
      return;
    }

    closed = true;
    await closeResources(app);
  };

  try {
    await initializeSchema();
    await validateStartupConfig();
    await ensureLocalUser();

    startWorkers();
    await app.listen({ port, host });

    logger.info({ port, host }, 'Monte Engine started');
    logger.info(`API documentation available at http://localhost:${port}/docs`);

    if (dashboardRoot) {
      logger.info(`Monte dashboard available at http://localhost:${port}`);
    } else {
      logger.warn('Bundled dashboard assets not found; serving API only');
    }

    if (options.registerSignalHandlers !== false) {
      registerShutdownHandlers(close);
    }

    return { app, dashboardRoot, close };
  } catch (err) {
    try {
      await close();
    } catch (closeError) {
      logger.error({ err: closeError }, 'Failed to release resources after startup failure');
    }

    throw err;
  }
}
