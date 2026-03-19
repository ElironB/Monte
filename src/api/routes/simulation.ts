import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runQuery, runQuerySingle, runWriteSingle } from '../../config/neo4j.js';
import { scheduleSimulationBatch } from '../../ingestion/queue/ingestionQueue.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { v4 as uuidv4 } from 'uuid';

const SCENARIOS = ['day_trading', 'startup_founding', 'career_change', 'advanced_degree', 'geographic_relocation', 'real_estate_purchase', 'health_fitness_goal', 'custom'] as const;

const createSchema = z.object({
  scenarioType: z.enum(SCENARIOS),
  name: z.string().min(1).max(100),
  parameters: z.record(z.unknown()).optional(),
  cloneCount: z.number().min(100).max(10000).default(1000),
});

async function simulationRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    schema: { description: 'List simulations', tags: ['simulation'], security: [{ bearerAuth: [] }] },
    handler: async (request) => {
      return await runQuery<{
        id: string;
        name: string;
        scenarioType: string;
        status: string;
        cloneCount: number;
        createdAt: string;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)-[:HAS_SIMULATION]->(s:Simulation)
         RETURN s.id as id, s.name as name, s.scenarioType as scenarioType, s.status as status,
                s.cloneCount as cloneCount, s.createdAt as createdAt
         ORDER BY s.createdAt DESC`,
        { userId: request.user.userId }
      );
    },
  });

  fastify.post('/', {
    preHandler: [fastify.authenticate],
    schema: { description: 'Create simulation', tags: ['simulation'], security: [{ bearerAuth: [] }] },
    handler: async (request, reply) => {
      const body = createSchema.parse(request.body);

      const persona = await runQuerySingle<{ id: string }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)
         WHERE p.buildStatus = 'ready'
         RETURN p.id as id ORDER BY p.version DESC LIMIT 1`,
        { userId: request.user.userId }
      );
      if (!persona) throw new ValidationError('No ready persona found');

      const simulationId = uuidv4();
      await runWriteSingle(
        `MATCH (p:Persona {id: $personaId})
         CREATE (s:Simulation {
           id: $simulationId,
           name: $name,
           scenarioType: $scenarioType,
           status: 'pending',
           parameters: $parameters,
           cloneCount: $cloneCount,
           createdAt: datetime()
         })
         CREATE (p)-[:HAS_SIMULATION]->(s)
         RETURN s.id as id`,
        {
          personaId: persona.id,
          simulationId,
          name: body.name,
          scenarioType: body.scenarioType,
          parameters: JSON.stringify(body.parameters ?? {}),
          cloneCount: body.cloneCount,
        }
      );

      const batchSize = 100;
      const totalBatches = Math.ceil(body.cloneCount / batchSize);
      for (let i = 0; i < totalBatches; i++) {
        await scheduleSimulationBatch({
          simulationId,
          userId: request.user.userId,
          personaId: persona.id,
          scenarioType: body.scenarioType,
          cloneBatchIndex: i,
          totalBatches,
        });
      }

      reply.status(202);
      return { simulationId, name: body.name, status: 'pending', cloneCount: body.cloneCount };
    },
  });

  fastify.get('/:id', {
    preHandler: [fastify.authenticate],
    handler: async (request) => {
      const { id } = request.params as { id: string };
      const sim = await runQuerySingle<{
        id: string;
        name: string;
        scenarioType: string;
        status: string;
        parameters: string;
        cloneCount: number;
        results: string | null;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)-[:HAS_SIMULATION]->(s:Simulation {id: $simId})
         RETURN s.id as id, s.name as name, s.scenarioType as scenarioType, s.status as status,
                s.parameters as parameters, s.cloneCount as cloneCount, s.results as results`,
        { userId: request.user.userId, simId: id }
      );
      if (!sim) throw new NotFoundError('Simulation');
      return { ...sim, parameters: JSON.parse(sim.parameters), results: sim.results ? JSON.parse(sim.results) : null };
    },
  });

  fastify.get('/:id/results', {
    preHandler: [fastify.authenticate],
    handler: async (request) => {
      const { id } = request.params as { id: string };
      const sim = await runQuerySingle<{ results: string | null; status: string }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)-[:HAS_SIMULATION]->(s:Simulation {id: $simId})
         RETURN s.results as results, s.status as status`,
        { userId: request.user.userId, simId: id }
      );
      if (!sim) throw new NotFoundError('Simulation');
      return {
        status: sim.status,
        distributions: sim.results ? JSON.parse(sim.results) : null,
      };
    },
  });

  fastify.delete('/:id', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      await runWriteSingle(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)-[:HAS_SIMULATION]->(s:Simulation {id: $simId})
         DETACH DELETE s`,
        { userId: request.user.userId, simId: id }
      );
      reply.status(204);
    },
  });

  fastify.get('/scenarios', {
    schema: { description: 'List scenarios', tags: ['simulation'] },
    handler: async () => [
      { id: 'day_trading', name: 'Day Trading Career', timeframe: '12-24 months' },
      { id: 'startup_founding', name: 'Startup Founding', timeframe: '36-60 months' },
      { id: 'career_change', name: 'Career Change', timeframe: '12-24 months' },
      { id: 'advanced_degree', name: 'Advanced Degree', timeframe: '24-48 months' },
      { id: 'geographic_relocation', name: 'Geographic Relocation', timeframe: '12-36 months' },
      { id: 'real_estate_purchase', name: 'Real Estate Purchase', timeframe: '60-120 months' },
      { id: 'health_fitness_goal', name: 'Health & Fitness Goal', timeframe: '6-18 months' },
      { id: 'custom', name: 'Custom Scenario', timeframe: 'variable' },
    ],
  });
}

export default simulationRoutes;
