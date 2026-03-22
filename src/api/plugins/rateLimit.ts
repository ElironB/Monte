import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import rateLimit from '@fastify/rate-limit';

const isDev = process.env.NODE_ENV !== 'production';

const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(rateLimit, {
    // Dev: effectively unlimited. Prod: 100/min per user.
    max: isDev ? 10000 : 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      // Skip rate limiting for Swagger docs static assets
      if (req.url.startsWith('/docs')) return 'docs-bypass';
      return req.user?.userId ?? req.ip;
    },
    allowList: ['docs-bypass'],
  });

  await fastify.register(rateLimit, {
    max: isDev ? 10000 : 10,
    timeWindow: '1 minute',
    prefix: '/simulation',
    keyGenerator: (req) => req.user?.userId ?? req.ip,
  });

  await fastify.register(rateLimit, {
    max: isDev ? 10000 : 5,
    timeWindow: '1 minute',
    prefix: '/ingestion',
    keyGenerator: (req) => req.user?.userId ?? req.ip,
  });
};

export default fp(rateLimitPlugin, { name: 'rateLimit' });
