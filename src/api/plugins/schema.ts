import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from '../../config/index.js';

const schemaPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Monte Engine API',
        description: 'Probabilistic life simulation platform',
        version: '0.1.0',
      },
      servers: [{ url: `http://localhost:${config.server.port}` }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
};

export default fp(schemaPlugin, { name: 'schema' });
