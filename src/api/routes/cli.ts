import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const simulateSchema = z.object({
  scenarioType: z.string(),
  parameters: z.record(z.unknown()).optional(),
});

async function cliRoutes(fastify: FastifyInstance) {
  fastify.post('/login', {
    schema: { description: 'CLI login', tags: ['cli'] },
    handler: async (request) => {
      const body = loginSchema.parse(request.body);
      const response = await fastify.inject({
        method: 'POST',
        url: '/auth/login',
        payload: body,
      });
      const result = JSON.parse(response.payload);
      if (response.statusCode !== 200) {
        return { success: false, ...result };
      }
      return {
        success: true,
        userId: result.userId,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      };
    },
  });

  fastify.post('/simulate', {
    preHandler: [fastify.authenticate],
    schema: { description: 'Trigger simulation', tags: ['cli'], security: [{ bearerAuth: [] }] },
    handler: async (request) => {
      const body = simulateSchema.parse(request.body);
      const response = await fastify.inject({
        method: 'POST',
        url: '/simulation',
        headers: { authorization: request.headers.authorization },
        payload: { scenarioType: body.scenarioType, name: `CLI-${Date.now()}`, parameters: body.parameters },
      });
      const result = JSON.parse(response.payload);
      return { success: response.statusCode === 202, ...result };
    },
  });

  fastify.get('/persona', {
    preHandler: [fastify.authenticate],
    schema: { description: 'Quick persona check', tags: ['cli'], security: [{ bearerAuth: [] }] },
    handler: async (request) => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/persona',
        headers: { authorization: request.headers.authorization },
      });
      const result = JSON.parse(response.payload);
      return { success: true, hasPersona: result.status !== 'none', ...result };
    },
  });
}

export default cliRoutes;
