import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getRedisClient } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';
import { runQuerySingle } from '../../config/neo4j.js';
import {
  asSimulationAggregationStage,
  asSimulationProgressPhase,
  calculateExecutionPhaseProgress,
  createProgressSnapshot,
  deriveSimulationPhase,
} from '../../simulation/progress.js';
import { config } from '../../config/index.js';
import type { SimulationGraphSnapshot } from '../../simulation/types.js';

interface SSEClient {
  id: string;
  simulationId: string;
  reply: FastifyReply;
}

const progressClients = new Map<string, SSEClient>();
const graphClients = new Map<string, SSEClient>();

export function getSimulationProgressKey(simulationId: string): string {
  return `sim:${simulationId}:progress`;
}

export function getSimulationGraphKey(simulationId: string): string {
  return `sim:${simulationId}:graph`;
}

function getSimulationProcessedClonesKey(simulationId: string): string {
  return `sim:${simulationId}:processedClones`;
}

function getNumberField(payload: Record<string, unknown> | null, key: string): number | undefined {
  const value = payload?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getStringField(payload: Record<string, unknown> | null, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === 'string' ? value : undefined;
}

function writeSsePayload(reply: FastifyReply, payload: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function setupSseHeaders(request: FastifyRequest, reply: FastifyReply): void {
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
  const origin = request.headers.origin;
  if (config.server.nodeEnv === 'development' && origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers.Vary = 'Origin';
  }

  reply.raw.writeHead(200, headers);
}

function registerSseClient(
  request: FastifyRequest,
  reply: FastifyReply,
  simulationId: string,
  clients: Map<string, SSEClient>,
): string {
  setupSseHeaders(request, reply);
  const clientId = `${request.user.userId}-${simulationId}-${Date.now()}`;
  const client: SSEClient = {
    id: clientId,
    simulationId,
    reply,
  };
  clients.set(clientId, client);

  const pingInterval = setInterval(() => {
    try {
      writeSsePayload(reply, { type: 'ping' });
    } catch {
      clearInterval(pingInterval);
      clients.delete(clientId);
    }
  }, 30000);

  request.raw.on('close', () => {
    clearInterval(pingInterval);
    clients.delete(clientId);
    logger.info({ clientId, simulationId }, 'SSE client disconnected');
  });

  return clientId;
}

async function findAuthorizedSimulation(
  request: FastifyRequest,
  simulationId: string,
): Promise<{
  id: string;
  status: string;
  progress?: number;
  completedBatches?: number;
  cloneCount: number;
  batchSizeUsed?: number | null;
  error?: string;
} | null> {
  return runQuerySingle<{
    id: string;
    status: string;
    progress?: number;
    completedBatches?: number;
    cloneCount: number;
    batchSizeUsed?: number | null;
    error?: string;
  }>(
    `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)-[:HAS_SIMULATION]->(s:Simulation {id: $simId})
     RETURN s.id as id,
            s.status as status,
            s.progress as progress,
            s.completedBatches as completedBatches,
            s.cloneCount as cloneCount,
            s.batchSizeUsed as batchSizeUsed,
            s.error as error`,
    { userId: request.user.userId, simId: simulationId },
  );
}

export function buildProgressResponse(options: {
  simulationId: string;
  simulation: {
    status: string;
    progress?: number;
    completedBatches?: number;
    cloneCount: number;
    batchSizeUsed?: number | null;
    error?: string;
  };
  parsed: Record<string, unknown> | null;
  processedClones?: number;
}) {
  const { simulationId, simulation, parsed, processedClones } = options;
  const status = getStringField(parsed, 'status') ?? simulation.status;
  const phase = asSimulationProgressPhase(getStringField(parsed, 'phase')) ?? deriveSimulationPhase(status);
  const aggregationStage = asSimulationAggregationStage(getStringField(parsed, 'aggregationStage'));
  const liveProcessedClones = typeof processedClones === 'number' && Number.isFinite(processedClones)
    ? processedClones
    : undefined;
  const phaseProgress = getNumberField(parsed, 'phaseProgress')
    ?? (phase === 'executing' && typeof liveProcessedClones === 'number'
      ? calculateExecutionPhaseProgress(liveProcessedClones, simulation.cloneCount)
      : phase === 'completed'
        ? 100
        : phase === 'queued'
          ? 0
          : undefined);
  const snapshot = typeof phaseProgress === 'number'
    ? createProgressSnapshot({
        status,
        phase,
        phaseProgress,
        aggregationStage,
      })
    : undefined;

  return {
    simulationId,
    status: snapshot?.status ?? status,
    phase: snapshot?.phase ?? phase,
    phaseProgress,
    aggregationStage: snapshot?.aggregationStage ?? aggregationStage,
    progress: getNumberField(parsed, 'progress') ?? snapshot?.progress ?? simulation.progress ?? 0,
    completedBatches: getNumberField(parsed, 'completedBatches') ?? simulation.completedBatches ?? 0,
    totalBatches: Math.ceil(
      simulation.cloneCount / Math.max(1, simulation.batchSizeUsed ?? config.simulation.batchSize),
    ),
    cloneCount: simulation.cloneCount,
    processedClones: liveProcessedClones ?? 0,
    error: getStringField(parsed, 'error') ?? simulation.error,
    currentBatch: getNumberField(parsed, 'currentBatch'),
    batchProcessedClones: getNumberField(parsed, 'batchProcessedClones'),
    batchCloneCount: getNumberField(parsed, 'batchCloneCount'),
    estimatedTimeRemaining: getNumberField(parsed, 'estimatedTimeRemaining'),
    activeFrontier: getNumberField(parsed, 'activeFrontier'),
    waitingDecisions: getNumberField(parsed, 'waitingDecisions'),
    resolvedDecisions: getNumberField(parsed, 'resolvedDecisions'),
    estimatedDecisionCount: getNumberField(parsed, 'estimatedDecisionCount'),
    localStepDurationMs: getNumberField(parsed, 'localStepDurationMs'),
    lastUpdated: getStringField(parsed, 'lastUpdated'),
  };
}

export function broadcastSimulationProgress(simulationId: string, data: unknown): void {
  for (const client of progressClients.values()) {
    if (client.simulationId === simulationId) {
      try {
        writeSsePayload(client.reply, data);
      } catch (err) {
        logger.error({ err, clientId: client.id }, 'Failed to broadcast progress payload');
      }
    }
  }
}

export function broadcastSimulationGraphSnapshot(simulationId: string, data: unknown): void {
  for (const client of graphClients.values()) {
    if (client.simulationId === simulationId) {
      try {
        writeSsePayload(client.reply, data);
      } catch (err) {
        logger.error({ err, clientId: client.id }, 'Failed to broadcast graph payload');
      }
    }
  }
}

async function streamRoutes(fastify: FastifyInstance) {
  fastify.get('/simulation/:id/progress', {
    preHandler: [fastify.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const simulation = await findAuthorizedSimulation(request, id);

      if (!simulation) {
        return reply.status(404).send({ error: 'Simulation not found' });
      }

      const clientId = registerSseClient(request, reply, id, progressClients);
      writeSsePayload(reply, { type: 'connected', simulationId: id, status: simulation.status });

      const redis = await getRedisClient();
      const progress = await redis.get(getSimulationProgressKey(id));
      if (progress) {
        try {
          writeSsePayload(reply, { type: 'progress', data: JSON.parse(progress) });
        } catch (err) {
          logger.warn({ err, simulationId: id }, 'Failed to parse live simulation progress');
        }
      }

      logger.info({ clientId, simulationId: id }, 'Progress SSE client connected');
    },
  });

  fastify.get('/simulation/:id/graph', {
    preHandler: [fastify.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const simulation = await findAuthorizedSimulation(request, id);

      if (!simulation) {
        return reply.status(404).send({ error: 'Simulation not found' });
      }

      const clientId = registerSseClient(request, reply, id, graphClients);
      writeSsePayload(reply, { type: 'connected', simulationId: id, status: simulation.status });

      const redis = await getRedisClient();
      const snapshot = await redis.get(getSimulationGraphKey(id));
      if (snapshot) {
        try {
          writeSsePayload(reply, { type: 'graph', data: JSON.parse(snapshot) });
        } catch (err) {
          logger.warn({ err, simulationId: id }, 'Failed to parse live simulation graph snapshot');
        }
      }

      logger.info({ clientId, simulationId: id }, 'Graph SSE client connected');
    },
  });

  fastify.get('/simulation/:id/progress-rest', {
    preHandler: [fastify.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const simulation = await findAuthorizedSimulation(request, id);

      if (!simulation) {
        return reply.status(404).send({ error: 'Simulation not found' });
      }

      const redis = await getRedisClient();
      const [realTimeProgress, processedClonesRaw] = await Promise.all([
        redis.get(getSimulationProgressKey(id)),
        redis.get(getSimulationProcessedClonesKey(id)),
      ]);

      let parsed: Record<string, unknown> | null = null;
      if (realTimeProgress) {
        try {
          parsed = JSON.parse(realTimeProgress) as Record<string, unknown>;
        } catch (err) {
          logger.warn({ err, simulationId: id }, 'Failed to parse live simulation progress');
        }
      }

      const processedClones = processedClonesRaw
        ? Number.parseInt(processedClonesRaw, 10)
        : getNumberField(parsed, 'processedClones');

      if (parsed || Number.isFinite(processedClones)) {
        return buildProgressResponse({
          simulationId: id,
          simulation,
          parsed,
          processedClones,
        });
      }

      const fallbackSnapshot = createProgressSnapshot({
        status: simulation.status,
        phase: deriveSimulationPhase(simulation.status),
        phaseProgress: simulation.status === 'completed'
          ? 100
          : simulation.status === 'pending'
            ? 0
            : simulation.progress ?? 0,
      });
      return {
        simulationId: id,
        status: fallbackSnapshot.status,
        phase: fallbackSnapshot.phase,
        phaseProgress: fallbackSnapshot.phaseProgress,
        progress: simulation.progress ?? fallbackSnapshot.progress,
        completedBatches: simulation.completedBatches ?? 0,
        totalBatches: Math.ceil(
          simulation.cloneCount / Math.max(1, simulation.batchSizeUsed ?? config.simulation.batchSize),
        ),
        cloneCount: simulation.cloneCount,
        error: simulation.error,
      };
    },
  });

  fastify.get('/simulation/:id/graph-rest', {
    preHandler: [fastify.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const simulation = await findAuthorizedSimulation(request, id);

      if (!simulation) {
        return reply.status(404).send({ error: 'Simulation not found' });
      }

      const redis = await getRedisClient();
      const graphSnapshot = await redis.get(getSimulationGraphKey(id));
      if (!graphSnapshot) {
        return reply.status(204).send();
      }

      try {
        return JSON.parse(graphSnapshot) as SimulationGraphSnapshot;
      } catch (err) {
        logger.warn({ err, simulationId: id }, 'Failed to parse live simulation graph snapshot');
        return reply.status(204).send();
      }
    },
  });
}

export default streamRoutes;
