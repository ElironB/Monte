import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { runQuery, runQuerySingle, runWriteSingle } from '../../config/neo4j.js';
import { cacheGet, cacheSet } from '../../config/redis.js';
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

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
  scenarioType: z.enum(SCENARIOS).optional(),
  sortBy: z.enum(['createdAt', 'name', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

const CACHE_TTL = 60; // 1 minute for simulation lists

async function simulationRoutes(fastify: FastifyInstance) {
  // List simulations with pagination and filtering
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'List simulations with pagination',
      tags: ['simulation'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20 },
          status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'] },
          scenarioType: { type: 'string' },
          sortBy: { type: 'string', enum: ['createdAt', 'name', 'status'] },
          sortOrder: { type: 'string', enum: ['asc', 'desc'] },
        },
      },
    },
    handler: async (request: FastifyRequest) => {
      const query = listQuerySchema.parse(request.query);
      const skip = (query.page - 1) * query.limit;
      const cacheKey = `sims:${request.user.userId}:${query.page}:${query.limit}:${query.status || 'all'}:${query.scenarioType || 'all'}:${query.sortBy}:${query.sortOrder}`;

      // Try cache first
      const cached = await cacheGet<{
        data: unknown[];
        pagination: unknown;
        cached: boolean;
      }>(cacheKey);

      if (cached) {
        return { ...cached, cached: true };
      }

      // Build where clause
      let whereClause = '';
      const params: Record<string, unknown> = { userId: request.user.userId, skip, limit: query.limit };

      const filters: string[] = [];
      if (query.status) {
        filters.push('s.status = $status');
        params.status = query.status;
      }
      if (query.scenarioType) {
        filters.push('s.scenarioType = $scenarioType');
        params.scenarioType = query.scenarioType;
      }

      if (filters.length > 0) {
        whereClause = 'WHERE ' + filters.join(' AND ');
      }

      // Fetch data with pagination
      const [simulations, countResult] = await Promise.all([
        runQuery<{
          id: string;
          name: string;
          scenarioType: string;
          status: string;
          progress: number;
          cloneCount: number;
          createdAt: string;
        }>(
          `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)-[:HAS_SIMULATION]->(s:Simulation)
           ${whereClause}
           RETURN s.id as id, s.name as name, s.scenarioType as scenarioType, s.status as status,
                  s.progress as progress, s.cloneCount as cloneCount, s.createdAt as createdAt
           ORDER BY s.${query.sortBy} ${query.sortOrder.toUpperCase()}
           SKIP $skip LIMIT $limit`,
          params
        ),
        runQuerySingle<{ total: number }>(
          `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)-[:HAS_SIMULATION]->(s:Simulation)
           ${whereClause}
           RETURN count(s) as total`,
          { userId: request.user.userId, status: query.status, scenarioType: query.scenarioType }
        ),
      ]);

      const total = countResult?.total ?? 0;
      const totalPages = Math.ceil(total / query.limit);

      const result = {
        data: simulations,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages,
          hasNextPage: query.page < totalPages,
          hasPrevPage: query.page > 1,
        },
      };

      // Cache result
      await cacheSet(cacheKey, result, CACHE_TTL);

      return result;
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
           progress: 0,
           completedBatches: 0,
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

  // Get simulation with caching
  fastify.get('/:id', {
    preHandler: [fastify.authenticate],
    handler: async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const cacheKey = `sim:${id}`;

      // Try cache first
      const cached = await cacheGet<{
        id: string;
        name: string;
        scenarioType: string;
        status: string;
        parameters: unknown;
        cloneCount: number;
        results: unknown;
        progress?: number;
      }>(cacheKey);

      if (cached && cached.status === 'completed') {
        return { ...cached, cached: true };
      }

      const sim = await runQuerySingle<{
        id: string;
        name: string;
        scenarioType: string;
        status: string;
        progress: number;
        parameters: string;
        cloneCount: number;
        results: string | null;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)-[:HAS_SIMULATION]->(s:Simulation {id: $simId})
         RETURN s.id as id, s.name as name, s.scenarioType as scenarioType, s.status as status, s.progress as progress,
                s.parameters as parameters, s.cloneCount as cloneCount, s.results as results`,
        { userId: request.user.userId, simId: id }
      );
      if (!sim) throw new NotFoundError('Simulation');

      const result = {
        ...sim,
        parameters: JSON.parse(sim.parameters),
        results: sim.results ? JSON.parse(sim.results) : null,
      };

      // Cache completed simulations for longer
      const ttl = sim.status === 'completed' ? 3600 : 30;
      await cacheSet(cacheKey, result, ttl);

      return result;
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

      // Invalidate cache
      const cacheKey = `sim:${id}`;
      await cacheSet(cacheKey, null, 0);

      await runWriteSingle(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)-[:HAS_SIMULATION]->(s:Simulation {id: $simId})
         OPTIONAL MATCH (s)-[:HAS_RESULT]->(cr:CloneResult)
         DETACH DELETE s, cr`,
        { userId: request.user.userId, simId: id }
      );
      reply.status(204);
    },
  });

  fastify.get('/scenarios', {
    schema: { description: 'List scenarios', tags: ['simulation'] },
    handler: async () => [
      { id: 'day_trading', name: 'Day Trading Career', timeframe: '12-24 months', description: 'Simulate day trading as primary income source with realistic market volatility' },
      { id: 'startup_founding', name: 'Startup Founding', timeframe: '36-60 months', description: 'Found a technology startup with funding rounds, runway, and exit scenarios' },
      { id: 'career_change', name: 'Career Change', timeframe: '12-24 months', description: 'Transition to a new industry with salary changes, retraining, and job search' },
      { id: 'advanced_degree', name: 'Advanced Degree', timeframe: '24-48 months', description: 'Pursue MBA, PhD, or professional degree with tuition, opportunity cost, and ROI' },
      { id: 'geographic_relocation', name: 'Geographic Relocation', timeframe: '12-36 months', description: 'Move to a new city/country with cost of living changes, job market differences' },
      { id: 'real_estate_purchase', name: 'Real Estate Purchase', timeframe: '60-120 months', description: 'Buy property with mortgage, appreciation, and market crash scenarios' },
      { id: 'health_fitness_goal', name: 'Health & Fitness Goal', timeframe: '6-18 months', description: 'Major lifestyle transformation with health outcomes and maintenance' },
      { id: 'custom', name: 'Custom Scenario', timeframe: 'variable', description: 'Define your own scenario with custom parameters' },
    ],
  });
}

export default simulationRoutes;
