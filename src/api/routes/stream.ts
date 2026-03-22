import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getRedisClient } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';
import { runQuerySingle } from '../../config/neo4j.js';
import { calculateSimulationProgress } from '../../simulation/progress.js';

interface SSEClient {
  id: string;
  simulationId: string;
  reply: FastifyReply;
}

const clients = new Map<string, SSEClient>();

function getSimulationProgressKey(simulationId: string): string {
  return `sim:${simulationId}:progress`;
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

export function broadcastSimulationProgress(simulationId: string, data: unknown): void {
  for (const client of clients.values()) {
    if (client.simulationId === simulationId) {
      try {
        client.reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        logger.error({ err, clientId: client.id }, 'Failed to broadcast to client');
      }
    }
  }
}

async function streamRoutes(fastify: FastifyInstance) {
  // SSE endpoint for simulation progress
  fastify.get('/simulation/:id/progress', {
    preHandler: [fastify.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const userId = request.user.userId;

      // Verify simulation belongs to user
      const simulation = await runQuerySingle<{ id: string; status: string }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)-[:HAS_SIMULATION]->(s:Simulation {id: $simId})
         RETURN s.id as id, s.status as status`,
        { userId, simId: id }
      );

      if (!simulation) {
        return reply.status(404).send({ error: 'Simulation not found' });
      }

      // Setup SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const clientId = `${userId}-${id}-${Date.now()}`;
      const client: SSEClient = {
        id: clientId,
        simulationId: id,
        reply,
      };
      clients.set(clientId, client);

      // Send initial state
      reply.raw.write(`data: ${JSON.stringify({ type: 'connected', simulationId: id, status: simulation.status })}\n\n`);

      // Send current progress from Redis if available
      const redis = await getRedisClient();
      const progress = await redis.get(getSimulationProgressKey(id));
      if (progress) {
        try {
          reply.raw.write(`data: ${JSON.stringify({ type: 'progress', data: JSON.parse(progress) })}\n\n`);
        } catch (err) {
          logger.warn({ err, simulationId: id }, 'Failed to parse live simulation progress');
        }
      }

      // Keep connection alive with ping every 30 seconds
      const pingInterval = setInterval(() => {
        try {
          reply.raw.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
        } catch {
          clearInterval(pingInterval);
          clients.delete(clientId);
        }
      }, 30000);

      // Cleanup on close
      request.raw.on('close', () => {
        clearInterval(pingInterval);
        clients.delete(clientId);
        logger.info({ clientId, simulationId: id }, 'SSE client disconnected');
      });

      logger.info({ clientId, simulationId: id }, 'SSE client connected');
    },
  });

  // Get current progress (REST fallback)
  fastify.get('/simulation/:id/progress-rest', {
    preHandler: [fastify.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const userId = request.user.userId;

      const simulation = await runQuerySingle<{
        id: string;
        status: string;
        progress: number;
        completedBatches: number;
        cloneCount: number;
        error?: string;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)-[:HAS_SIMULATION]->(s:Simulation {id: $simId})
         RETURN s.id as id, s.status as status, s.progress as progress, s.completedBatches as completedBatches, s.cloneCount as cloneCount, s.error as error`,
        { userId, simId: id }
      );

      if (!simulation) {
        return reply.status(404).send({ error: 'Simulation not found' });
      }

      // Get real-time updates from Redis
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
        const status = getStringField(parsed, 'status') ?? simulation.status;
        const liveProcessedClones = typeof processedClones === 'number' && Number.isFinite(processedClones)
          ? processedClones
          : undefined;
        return {
          simulationId: id,
          status,
          progress: typeof liveProcessedClones === 'number' && liveProcessedClones > 0
            ? calculateSimulationProgress(liveProcessedClones, simulation.cloneCount, status)
            : getNumberField(parsed, 'progress') ?? simulation.progress ?? 0,
          completedBatches: getNumberField(parsed, 'completedBatches') ?? simulation.completedBatches ?? 0,
          totalBatches: Math.ceil(simulation.cloneCount / 100),
          cloneCount: simulation.cloneCount,
          processedClones: liveProcessedClones ?? 0,
          error: getStringField(parsed, 'error') ?? simulation.error,
          currentBatch: getNumberField(parsed, 'currentBatch'),
          batchProcessedClones: getNumberField(parsed, 'batchProcessedClones'),
          batchCloneCount: getNumberField(parsed, 'batchCloneCount'),
          estimatedTimeRemaining: getNumberField(parsed, 'estimatedTimeRemaining'),
          lastUpdated: getStringField(parsed, 'lastUpdated'),
        };
      }

      return {
        simulationId: id,
        status: simulation.status,
        progress: simulation.progress ?? 0,
        completedBatches: simulation.completedBatches ?? 0,
        totalBatches: Math.ceil(simulation.cloneCount / 100),
        cloneCount: simulation.cloneCount,
        error: simulation.error,
      };
    },
  });
}

export default streamRoutes;
