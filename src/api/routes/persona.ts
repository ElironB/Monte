import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runQuery, runQuerySingle, runWriteSingle } from '../../config/neo4j.js';
import { schedulePersonaBuild } from '../../ingestion/queue/ingestionQueue.js';
import { ValidationError } from '../../utils/errors.js';
import { v4 as uuidv4 } from 'uuid';

const createSchema = z.object({
  baseTraits: z.record(z.number().min(0).max(1)).optional(),
});

async function personaRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    schema: { description: 'Get current persona', tags: ['persona'], security: [{ bearerAuth: [] }] },
    handler: async (request) => {
      const persona = await runQuerySingle<{
        id: string;
        version: number;
        buildStatus: string;
        traitCount: number;
        memoryCount: number;
        createdAt: string;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)
         OPTIONAL MATCH (p)-[:HAS_TRAIT]->(t:Trait)
         OPTIONAL MATCH (p)-[:HAS_MEMORY]->(m:Memory)
         RETURN p.id as id, p.version as version, p.buildStatus as buildStatus,
                count(DISTINCT t) as traitCount, count(DISTINCT m) as memoryCount, p.createdAt as createdAt
         ORDER BY p.version DESC LIMIT 1`,
        { userId: request.user.userId }
      );

      if (!persona) return { status: 'none', message: 'No persona exists' };
      return persona;
    },
  });

  fastify.post('/', {
    preHandler: [fastify.authenticate],
    schema: { description: 'Build persona', tags: ['persona'], security: [{ bearerAuth: [] }] },
    handler: async (request, reply) => {
      const body = createSchema.parse(request.body);

      const hasSources = await runQuerySingle<{ count: number }>(
        `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource)
         RETURN count(d) as count`,
        { userId: request.user.userId }
      );
      if (!hasSources?.count) throw new ValidationError('At least one data source required');

      const latest = await runQuerySingle<{ version: number }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)
         RETURN max(p.version) as version`,
        { userId: request.user.userId }
      );

      const version = (latest?.version ?? 0) + 1;
      const personaId = uuidv4();

      await runWriteSingle(
        `MATCH (u:User {id: $userId})
         CREATE (p:Persona {
           id: $personaId,
           version: $version,
           buildStatus: 'building',
           baseTraits: $baseTraits,
           createdAt: datetime(),
           updatedAt: datetime()
         })
         CREATE (u)-[:HAS_PERSONA]->(p)
         RETURN p.id as id`,
        {
          userId: request.user.userId,
          personaId,
          version,
          baseTraits: JSON.stringify(body.baseTraits ?? {}),
        }
      );

      await schedulePersonaBuild({ userId: request.user.userId, personaId, version });

      reply.status(202);
      return { personaId, version, status: 'building', message: 'Persona build started' };
    },
  });

  fastify.get('/history', {
    preHandler: [fastify.authenticate],
    schema: { description: 'Persona history', tags: ['persona'], security: [{ bearerAuth: [] }] },
    handler: async (request) => {
      return await runQuery<{
        id: string;
        version: number;
        buildStatus: string;
        createdAt: string;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)
         RETURN p.id as id, p.version as version, p.buildStatus as buildStatus, p.createdAt as createdAt
         ORDER BY p.version DESC`,
        { userId: request.user.userId }
      );
    },
  });

  fastify.get('/traits', {
    preHandler: [fastify.authenticate],
    schema: { description: 'Get traits', tags: ['persona'], security: [{ bearerAuth: [] }] },
    handler: async (request) => {
      return await runQuery<{
        id: string;
        type: string;
        name: string;
        value: number;
        confidence: number;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)
         MATCH (p)-[:HAS_TRAIT]->(t:Trait)
         RETURN t.id as id, t.type as type, t.name as name, t.value as value, t.confidence as confidence
         ORDER BY t.confidence DESC`,
        { userId: request.user.userId }
      );
    },
  });
}

export default personaRoutes;
