import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runQuery, runQuerySingle, runWriteSingle } from '../../config/neo4j.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import bcrypt from 'bcrypt';

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  password: z.string().min(8).optional(),
});

const deleteSchema = z.object({
  password: z.string(),
  confirmDelete: z.literal(true),
});

async function userRoutes(fastify: FastifyInstance) {
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

  fastify.patch('/:id', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      if (id !== request.user.userId) throw new NotFoundError('User');
      
      const body = updateSchema.parse(request.body);
      if (!body.name && !body.password) throw new ValidationError('Nothing to update');
      
      const updates: string[] = ['u.updatedAt = datetime()'];
      const params: Record<string, unknown> = { id };
      
      if (body.name) {
        updates.push('u.name = $name');
        params.name = body.name;
      }
      if (body.password) {
        const hash = await bcrypt.hash(body.password, 12);
        updates.push('u.passwordHash = $passwordHash');
        params.passwordHash = hash;
      }
      
      const user = await runWriteSingle<{
        id: string;
        email: string;
        name: string;
      }>(
        `MATCH (u:User {id: $id})
         SET ${updates.join(', ')}
         RETURN u.id as id, u.email as email, u.name as name`,
        params
      );
      
      return user;
    },
  });

  fastify.delete('/:id', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      if (id !== request.user.userId) throw new NotFoundError('User');
      
      const body = deleteSchema.parse(request.body);
      
      const user = await runQuerySingle<{ passwordHash: string }>(
        'MATCH (u:User {id: $id}) RETURN u.passwordHash as passwordHash',
        { id }
      );
      if (!user) throw new NotFoundError('User');
      
      const valid = await bcrypt.compare(body.password, user.passwordHash);
      if (!valid) throw new ValidationError('Invalid password');
      
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
