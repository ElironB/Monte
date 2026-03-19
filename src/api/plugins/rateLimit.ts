import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import rateLimit from '@fastify/rate-limit';

const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.user?.userId ?? req.ip,
  });

  await fastify.register(rateLimit, {
    max: 10,
    timeWindow: '1 minute',
    prefix: '/simulation',
    keyGenerator: (req) => req.user?.userId ?? req.ip,
  });

  await fastify.register(rateLimit, {
    max: 5,
    timeWindow: '1 minute',
    prefix: '/ingestion',
    keyGenerator: (req) => req.user?.userId ?? req.ip,
  });
};

export default fp(rateLimitPlugin, { name: 'rateLimit' });
