import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getRedisClient } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';
import { runQuerySingle } from '../../config/neo4j.js';

interface SSEClient {
  id: string;
  simulationId: string;
  reply: FastifyReply;
}

const clients = new Map<string, SSEClient>();

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
      const progress = await redis.get(`sim:${id}:progress`);
      if (progress) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'progress', data: JSON.parse(progress) })}\n\n`);
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
      const realTimeProgress = await redis.get(`sim:${id}:progress`);

      if (realTimeProgress) {
        const parsed = JSON.parse(realTimeProgress);
        return {
          simulationId: id,
          status: simulation.status,
          progress: parsed.progress ?? simulation.progress ?? 0,
          completedBatches: parsed.completedBatches ?? simulation.completedBatches ?? 0,
          totalBatches: Math.ceil(simulation.cloneCount / 100),
          cloneCount: simulation.cloneCount,
          error: parsed.error ?? simulation.error,
          currentBatch: parsed.currentBatch,
          estimatedTimeRemaining: parsed.estimatedTimeRemaining,
          lastUpdated: parsed.lastUpdated,
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
