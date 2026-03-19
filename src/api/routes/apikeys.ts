import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createApiKey, listApiKeys, revokeApiKey } from '../plugins/apiKey.js';
import { ValidationError } from '../../utils/errors.js';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(['read', 'write', 'admin', 'simulation'])).default(['read']),
  rateLimit: z.number().min(10).max(10000).default(1000),
  expiresInDays: z.number().min(1).max(365).optional(),
});

async function apiKeyRoutes(fastify: FastifyInstance) {
  // List API keys
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'List API keys',
      tags: ['api-keys'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              keyPrefix: { type: 'string' },
              scopes: { type: 'array', items: { type: 'string' } },
              rateLimit: { type: 'number' },
              lastUsedAt: { type: 'string' },
              createdAt: { type: 'string' },
              expiresAt: { type: 'string' },
            },
          },
        },
      },
    },
    handler: async (request) => {
      const keys = await listApiKeys(request.user.userId);
      return keys.map(k => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        scopes: k.scopes,
        rateLimit: k.rateLimit,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
      }));
    },
  });

  // Create API key
  fastify.post('/', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'Create API key',
      tags: ['api-keys'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          scopes: { type: 'array', items: { type: 'string' } },
          rateLimit: { type: 'number' },
          expiresInDays: { type: 'number' },
        },
      },
    },
    handler: async (request, reply) => {
      const body = createSchema.parse(request.body);

      const result = await createApiKey(
        request.user.userId,
        body.name,
        body.scopes,
        body.rateLimit,
        body.expiresInDays
      );

      reply.status(201);
      return {
        id: result.id,
        key: result.key, // ONLY SHOWN ONCE
        name: result.name,
        scopes: result.scopes,
        warning: 'This key will only be shown once. Store it securely.',
      };
    },
  });

  // Revoke API key
  fastify.delete('/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'Revoke API key',
      tags: ['api-keys'],
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const revoked = await revokeApiKey(request.user.userId, id);

      if (!revoked) {
        throw new ValidationError('API key not found');
      }

      reply.status(204);
    },
  });
}

export default apiKeyRoutes;
