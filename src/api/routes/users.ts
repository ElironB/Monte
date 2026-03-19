import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { runQuery, runQuerySingle, runWriteSingle } from '../../config/neo4j.js';
import { cacheGet, cacheSet } from '../../config/redis.js';
import { NotFoundError } from '../../utils/errors.js';

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sortBy: z.enum(['createdAt', 'name', 'email']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
});

const CACHE_TTL = 300; // 5 minutes

async function userRoutes(fastify: FastifyInstance) {
  // List users with pagination
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'List users with pagination',
      tags: ['users'],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20 },
          sortBy: { type: 'string', enum: ['createdAt', 'name', 'email'] },
          sortOrder: { type: 'string', enum: ['asc', 'desc'] },
          search: { type: 'string' },
        },
      },
    },
    handler: async (request: FastifyRequest) => {
      const query = listQuerySchema.parse(request.query);
      const skip = (query.page - 1) * query.limit;

      let whereClause = '';
      const params: Record<string, unknown> = { skip, limit: query.limit };

      if (query.search) {
        whereClause = 'WHERE u.name CONTAINS $search OR u.email CONTAINS $search';
        params.search = query.search;
      }

      const [users, countResult] = await Promise.all([
        runQuery<{
          id: string;
          email: string;
          name: string;
          createdAt: string;
        }>(
          `MATCH (u:User)
           ${whereClause}
           RETURN u.id as id, u.email as email, u.name as name, u.createdAt as createdAt
           ORDER BY u.${query.sortBy} ${query.sortOrder.toUpperCase()}
           SKIP $skip LIMIT $limit`,
          params
        ),
        runQuerySingle<{ total: number }>(
          `MATCH (u:User) ${whereClause} RETURN count(u) as total`,
          query.search ? { search: query.search } : {}
        ),
      ]);

      const total = countResult?.total ?? 0;
      const totalPages = Math.ceil(total / query.limit);

      return {
        data: users,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages,
          hasNextPage: query.page < totalPages,
          hasPrevPage: query.page > 1,
        },
      };
    },
  });

  // Get current user (cached)
  fastify.get('/me', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'Get current user (cached)',
      tags: ['users'],
    },
    handler: async (request: FastifyRequest) => {
      const cacheKey = `user:${request.user.userId}`;

      // Try cache first
      const cached = await cacheGet<{
        id: string;
        email: string;
        name: string;
        createdAt: string;
        personaStatus: string;
      }>(cacheKey);

      if (cached) {
        return { ...cached, cached: true };
      }

      // Fetch from database
      const user = await runQuerySingle<{
        id: string;
        email: string;
        name: string;
        createdAt: string;
      }>(
        'MATCH (u:User {id: $userId}) RETURN u.id as id, u.email as email, u.name as name, u.createdAt as createdAt',
        { userId: request.user.userId }
      );

      if (!user) throw new NotFoundError('User');

      const persona = await runQuerySingle<{ status: string }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)
         RETURN p.buildStatus as status ORDER BY p.version DESC LIMIT 1`,
        { userId: request.user.userId }
      );

      const result = {
        ...user,
        personaStatus: persona?.status ?? 'none',
      };

      // Cache result
      await cacheSet(cacheKey, result, CACHE_TTL);

      return result;
    },
  });

  // Get specific user
  fastify.get('/:id', {
    preHandler: [fastify.authenticate],
    handler: async (request) => {
      const { id } = request.params as { id: string };
      if (id !== request.user.userId) throw new NotFoundError('User');

      const user = await runQuerySingle<{
        id: string;
        email: string;
        name: string;
        createdAt: string;
      }>(
        'MATCH (u:User {id: $id}) RETURN u.id as id, u.email as email, u.name as name, u.createdAt as createdAt',
        { id }
      );
      if (!user) throw new NotFoundError('User');
      return user;
    },
  });

  // Update user
  fastify.patch('/:id', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      if (id !== request.user.userId) throw new NotFoundError('User');

      const body = updateSchema.parse(request.body);
      if (!body.name) throw new Error('Nothing to update');

      const user = await runWriteSingle<{
        id: string;
        email: string;
        name: string;
      }>(
        `MATCH (u:User {id: $id})
         SET u.name = $name, u.updatedAt = datetime()
         RETURN u.id as id, u.email as email, u.name as name`,
        { id, name: body.name }
      );

      // Invalidate cache
      await cacheSet(`user:${id}`, null, 0);

      return user;
    },
  });

  // Delete user
  fastify.delete('/:id', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      if (id !== request.user.userId) throw new NotFoundError('User');

      await runWriteSingle(
        `MATCH (u:User {id: $id})
         OPTIONAL MATCH (u)-[:HAS_PERSONA]->(p:Persona)
         OPTIONAL MATCH (p)-[:HAS_CLONE]->(c:Clone)
         OPTIONAL MATCH (p)-[:HAS_SIMULATION]->(s:Simulation)
         DETACH DELETE u, p, c, s`,
        { id }
      );

      reply.status(204);
    },
  });
}

export default userRoutes;
