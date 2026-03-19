import { FastifyInstance } from 'fastify';
import { getNeo4jDriver } from '../../config/neo4j.js';
import { getRedisClient } from '../../config/redis.js';
import { getMinioClient } from '../../config/minio.js';

async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    schema: { description: 'Health check', tags: ['health'] },
    handler: async () => ({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    }),
  });

  fastify.get('/ready', {
    schema: { description: 'Readiness probe', tags: ['health'] },
    handler: async (request, reply) => {
      const checks = await Promise.allSettled([
        (async () => { const d = await getNeo4jDriver(); await d.verifyConnectivity(); })(),
        (async () => { const c = await getRedisClient(); await c.ping(); })(),
        (async () => { const c = getMinioClient(); await c.listBuckets(); })(),
      ]);

      const services = {
        neo4j: checks[0].status === 'fulfilled' ? 'connected' : 'error',
        redis: checks[1].status === 'fulfilled' ? 'connected' : 'error',
        minio: checks[2].status === 'fulfilled' ? 'connected' : 'error',
      };

      const healthy = Object.values(services).every(s => s === 'connected');
      if (!healthy) reply.status(503);

      return { status: healthy ? 'ready' : 'degraded', services, timestamp: new Date().toISOString() };
    },
  });

  fastify.get('/live', {
    schema: { description: 'Liveness probe', tags: ['health'] },
    handler: async () => ({ status: 'alive' }),
  });
}

export default healthRoutes;
