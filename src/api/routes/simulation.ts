import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { runQuery, runQuerySingle, runWriteSingle } from '../../config/neo4j.js';
import { NarrativeGenerator } from '../../simulation/narrativeGenerator.js';
import {
  AggregatedResults,
  CloneResult,
  EvidenceResult,
  ExperimentRecommendation,
} from '../../simulation/types.js';
import { deriveEvidenceAdjustments } from '../../simulation/evidenceLoop.js';
import {
  buildCompletedSimulationGraphSnapshot,
  buildSimulationGraphStructure,
  createSimulationGraphEnvelope,
} from '../../simulation/graphSnapshot.js';
import { buildDecisionFrame, compileScenario } from '../../simulation/scenarioCompiler.js';
import { BehavioralSignal } from '../../ingestion/types.js';
import { DimensionMapper } from '../../persona/dimensionMapper.js';
import { getDimensionConceptEmbeddings } from '../../embeddings/dimensionConcepts.js';
import { EmbeddingService } from '../../embeddings/embeddingService.js';
import { logger } from '../../utils/logger.js';
import { cacheGet, cacheSet, getRedisClient } from '../../config/redis.js';
import { scheduleSimulationBatch } from '../../ingestion/queue/ingestionQueue.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config/index.js';

const SCENARIOS = ['day_trading', 'startup_founding', 'career_change', 'advanced_degree', 'geographic_relocation', 'real_estate_purchase', 'health_fitness_goal', 'custom'] as const;
const EVIDENCE_RESULTS = ['positive', 'negative', 'mixed', 'inconclusive'] as const;
const CAUSAL_TARGETS = [
  'demandStrength',
  'executionCapacity',
  'runwayStress',
  'marketTailwind',
  'socialLegitimacy',
  'reversibilityPressure',
  'evidenceMomentum',
] as const;
const BELIEF_TARGETS = [
  'thesisConfidence',
  'uncertaintyLevel',
  'evidenceClarity',
  'reversibilityConfidence',
  'commitmentLockIn',
  'socialPressureLoad',
  'downsideSalience',
  'learningVelocity',
] as const;
const DEFAULT_MANUAL_CAUSAL_TARGETS: EvidenceResult['causalTargets'] = ['evidenceMomentum', 'demandStrength'];
const DEFAULT_MANUAL_BELIEF_TARGETS: EvidenceResult['beliefTargets'] = [
  'uncertaintyLevel',
  'thesisConfidence',
  'evidenceClarity',
];

const createSchema = z.object({
  scenarioType: z.enum(SCENARIOS),
  name: z.string().min(1).max(100),
  parameters: z.record(z.unknown()).optional(),
  cloneCount: z.number().int().min(10).max(10000).default(1000),
  capitalAtRisk: z.number().positive().optional(),
});

const evidenceSchema = z.object({
  recommendationIndex: z.number().int().min(1).optional(),
  uncertainty: z.string().min(1).max(300).optional(),
  focusMetric: z.string().min(1).max(100).optional(),
  recommendedExperiment: z.string().min(1).max(1000).optional(),
  result: z.enum(EVIDENCE_RESULTS),
  confidence: z.number().min(0).max(1).default(0.75),
  observedSignal: z.string().min(1).max(2000),
  notes: z.string().max(4000).optional(),
  causalTargets: z.array(z.enum(CAUSAL_TARGETS)).max(7).optional(),
  beliefTargets: z.array(z.enum(BELIEF_TARGETS)).max(8).optional(),
}).superRefine((value, ctx) => {
  if (!value.recommendationIndex && (!value.uncertainty || !value.recommendedExperiment)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide recommendationIndex or supply uncertainty plus recommendedExperiment.',
    });
  }
});

const rerunSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  cloneCount: z.number().int().min(10).max(10000).optional(),
  evidenceIds: z.array(z.string().min(1)).optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
  scenarioType: z.enum(SCENARIOS).optional(),
  sortBy: z.enum(['createdAt', 'name', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

const CACHE_TTL = 60; // 1 minute for simulation lists
const GRAPH_SAMPLE_TRACE_LIMIT = 12;

function getSimulationGraphKey(simulationId: string): string {
  return `sim:${simulationId}:graph`;
}

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

function deriveSimulationDisplayCopy(options: {
  name: string;
  scenarioType: string;
  parameters?: string | Record<string, unknown> | null;
  capitalAtRisk?: number | null;
}) {
  const parsedParameters = typeof options.parameters === 'string'
    ? parseJson<Record<string, unknown>>(options.parameters, {})
    : options.parameters ?? {};
  const decisionFrame = buildDecisionFrame({
    scenarioType: options.scenarioType,
    name: options.name,
    parameters: parsedParameters,
    capitalAtRisk: options.capitalAtRisk,
  });

  return {
    parameters: parsedParameters,
    title: decisionFrame.title,
    primaryQuestion: decisionFrame.primaryQuestion,
  };
}

const parseEvidenceRow = (row: {
  id: string;
  uncertainty: string;
  focusMetric: string;
  recommendationIndex?: number | null;
  recommendedExperiment: string;
  result: EvidenceResult['result'];
  confidence: number;
  observedSignal: string;
  notes?: string | null;
  createdAt: string;
  causalTargets?: string[] | null;
  beliefTargets?: string[] | null;
  causalAdjustments?: string | null;
  beliefAdjustments?: string | null;
}): EvidenceResult => {
  return {
    id: row.id,
    uncertainty: row.uncertainty,
    focusMetric: row.focusMetric,
    recommendationIndex: row.recommendationIndex ?? undefined,
    recommendedExperiment: row.recommendedExperiment,
    result: row.result,
    confidence: row.confidence,
    observedSignal: row.observedSignal,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
    causalTargets: (row.causalTargets ?? []) as EvidenceResult['causalTargets'],
    beliefTargets: (row.beliefTargets ?? []) as EvidenceResult['beliefTargets'],
    causalAdjustments: parseJson(row.causalAdjustments, {}),
    beliefAdjustments: parseJson(row.beliefAdjustments, {}),
  };
};

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
          parameters: string;
          capitalAtRisk: number | null;
        }>(
          `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)-[:HAS_SIMULATION]->(s:Simulation)
           ${whereClause}
           RETURN s.id as id, s.name as name, s.scenarioType as scenarioType, s.status as status,
                  s.progress as progress, s.cloneCount as cloneCount, s.createdAt as createdAt,
                  s.parameters as parameters, s.capitalAtRisk as capitalAtRisk
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
      const simulationSummaries = simulations.map((simulation) => {
        const displayCopy = deriveSimulationDisplayCopy(simulation);
        return {
          id: simulation.id,
          name: simulation.name,
          title: displayCopy.title,
          primaryQuestion: displayCopy.primaryQuestion,
          scenarioType: simulation.scenarioType,
          status: simulation.status,
          progress: simulation.progress,
          cloneCount: simulation.cloneCount,
          createdAt: simulation.createdAt,
        };
      });

      const result = {
        data: simulationSummaries,
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
      if (!persona) {
        const latestPersona = await runQuerySingle<{ buildStatus: string; lastError?: string | null }>(
          `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)
           RETURN p.buildStatus as buildStatus, p.lastError as lastError
           ORDER BY p.version DESC LIMIT 1`,
          { userId: request.user.userId }
        );

        if (latestPersona?.buildStatus === 'building') {
          throw new ValidationError('No ready persona found. Your latest persona is still building; run `monte persona status` to monitor progress.');
        }

        if (latestPersona?.buildStatus === 'failed') {
          const suffix = latestPersona.lastError ? ` Last error: ${latestPersona.lastError}` : '';
          throw new ValidationError(`No ready persona found. Your latest persona build failed.${suffix}`);
        }

        throw new ValidationError('No ready persona found. Build a persona first with `monte persona build`.');
      }

      const simulationId = uuidv4();
      const batchSizeUsed = config.simulation.batchSize;
      await runWriteSingle(
        `MATCH (p:Persona {id: $personaId})
         CREATE (s:Simulation {
           id: $simulationId,
           name: $name,
           scenarioType: $scenarioType,
           status: 'pending',
           parameters: $parameters,
           cloneCount: $cloneCount,
           capitalAtRisk: $capitalAtRisk,
           batchSizeUsed: $batchSizeUsed,
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
          capitalAtRisk: body.capitalAtRisk ?? null,
          batchSizeUsed,
        }
      );

      const totalBatches = Math.ceil(body.cloneCount / batchSizeUsed);
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

  fastify.post('/:id/evidence', {
    preHandler: [fastify.authenticate],
    schema: { description: 'Record experiment evidence for a completed simulation', tags: ['simulation'], security: [{ bearerAuth: [] }] },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = evidenceSchema.parse(request.body);

      const simulation = await runQuerySingle<{
        status: string;
        results: string | null;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(:Persona)-[:HAS_SIMULATION]->(s:Simulation {id: $simId})
         RETURN s.status as status, s.results as results`,
        { userId: request.user.userId, simId: id }
      );

      if (!simulation) {
        throw new NotFoundError('Simulation');
      }

      if (simulation.status !== 'completed') {
        throw new ValidationError('Evidence can only be recorded once the base simulation has completed.');
      }

      const results = parseJson<AggregatedResults | null>(simulation.results, null);
      let recommendation: ExperimentRecommendation | undefined;

      if (body.recommendationIndex) {
        recommendation = results?.decisionIntelligence?.recommendedExperiments[body.recommendationIndex - 1];
        if (!recommendation) {
          throw new ValidationError(`Recommendation ${body.recommendationIndex} was not found on this simulation.`);
        }
      }

      const uncertainty = recommendation?.uncertainty ?? body.uncertainty ?? '';
      const focusMetric = recommendation?.focusMetric ?? body.focusMetric ?? 'manual_evidence';
      const recommendedExperiment = recommendation?.recommendedExperiment ?? body.recommendedExperiment ?? '';
      const causalTargets = recommendation?.causalTargets ?? (body.causalTargets as EvidenceResult['causalTargets'] | undefined) ?? DEFAULT_MANUAL_CAUSAL_TARGETS;
      const beliefTargets = recommendation?.beliefTargets ?? (body.beliefTargets as EvidenceResult['beliefTargets'] | undefined) ?? DEFAULT_MANUAL_BELIEF_TARGETS;
      const evidenceId = uuidv4();
      const adjustments = deriveEvidenceAdjustments(body.result, body.confidence, causalTargets, beliefTargets);

      const created = await runWriteSingle<{
        id: string;
        uncertainty: string;
        focusMetric: string;
        recommendationIndex: number | null;
        recommendedExperiment: string;
        result: EvidenceResult['result'];
        confidence: number;
        observedSignal: string;
        notes: string | null;
        createdAt: string;
        causalTargets: string[];
        beliefTargets: string[];
        causalAdjustments: string;
        beliefAdjustments: string;
        evidenceCount: number;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(:Persona)-[:HAS_SIMULATION]->(s:Simulation {id: $simId})
         CREATE (e:SimulationEvidence {
           id: $evidenceId,
           uncertainty: $uncertainty,
           focusMetric: $focusMetric,
           recommendationIndex: $recommendationIndex,
           recommendedExperiment: $recommendedExperiment,
           result: $result,
           confidence: $confidence,
           observedSignal: $observedSignal,
           notes: $notes,
           causalTargets: $causalTargets,
           beliefTargets: $beliefTargets,
           causalAdjustments: $causalAdjustments,
           beliefAdjustments: $beliefAdjustments,
           createdAt: datetime()
         })
         CREATE (s)-[:HAS_EVIDENCE]->(e)
         WITH s, e
         MATCH (s)-[:HAS_EVIDENCE]->(allEvidence:SimulationEvidence)
         RETURN e.id as id,
                e.uncertainty as uncertainty,
                e.focusMetric as focusMetric,
                e.recommendationIndex as recommendationIndex,
                e.recommendedExperiment as recommendedExperiment,
                e.result as result,
                e.confidence as confidence,
                e.observedSignal as observedSignal,
                e.notes as notes,
                toString(e.createdAt) as createdAt,
                e.causalTargets as causalTargets,
                e.beliefTargets as beliefTargets,
                e.causalAdjustments as causalAdjustments,
                e.beliefAdjustments as beliefAdjustments,
                count(allEvidence) as evidenceCount`,
        {
          userId: request.user.userId,
          simId: id,
          evidenceId,
          uncertainty,
          focusMetric,
          recommendationIndex: body.recommendationIndex ?? null,
          recommendedExperiment,
          result: body.result,
          confidence: body.confidence,
          observedSignal: body.observedSignal,
          notes: body.notes ?? null,
          causalTargets,
          beliefTargets,
          causalAdjustments: JSON.stringify(adjustments.causalAdjustments),
          beliefAdjustments: JSON.stringify(adjustments.beliefAdjustments),
        }
      );

      reply.status(201);
      return {
        evidence: created ? parseEvidenceRow(created) : null,
        evidenceCount: created?.evidenceCount ?? 0,
      };
    },
  });

  fastify.post('/:id/rerun', {
    preHandler: [fastify.authenticate],
    schema: { description: 'Create an evidence-adjusted rerun from a completed simulation', tags: ['simulation'], security: [{ bearerAuth: [] }] },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = rerunSchema.parse(request.body);

      const sourceSimulation = await runQuerySingle<{
        personaId: string;
        name: string;
        scenarioType: string;
        status: string;
        parameters: string;
        cloneCount: number;
        capitalAtRisk: number | null;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)-[:HAS_SIMULATION]->(s:Simulation {id: $simId})
         RETURN p.id as personaId,
                s.name as name,
                s.scenarioType as scenarioType,
                s.status as status,
                s.parameters as parameters,
                s.cloneCount as cloneCount,
                s.capitalAtRisk as capitalAtRisk`,
        { userId: request.user.userId, simId: id }
      );

      if (!sourceSimulation) {
        throw new NotFoundError('Simulation');
      }

      if (sourceSimulation.status !== 'completed') {
        throw new ValidationError('Evidence-adjusted reruns require a completed source simulation.');
      }

      const evidenceRows = await runQuery<{
        id: string;
        uncertainty: string;
        focusMetric: string;
        recommendationIndex: number | null;
        recommendedExperiment: string;
        result: EvidenceResult['result'];
        confidence: number;
        observedSignal: string;
        notes: string | null;
        createdAt: string;
        causalTargets: string[];
        beliefTargets: string[];
        causalAdjustments: string;
        beliefAdjustments: string;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(:Persona)-[:HAS_SIMULATION]->(s:Simulation {id: $simId})
         MATCH (s)-[:HAS_EVIDENCE]->(e:SimulationEvidence)
         RETURN e.id as id,
                e.uncertainty as uncertainty,
                e.focusMetric as focusMetric,
                e.recommendationIndex as recommendationIndex,
                e.recommendedExperiment as recommendedExperiment,
                e.result as result,
                e.confidence as confidence,
                e.observedSignal as observedSignal,
                e.notes as notes,
                toString(e.createdAt) as createdAt,
                e.causalTargets as causalTargets,
                e.beliefTargets as beliefTargets,
                e.causalAdjustments as causalAdjustments,
                e.beliefAdjustments as beliefAdjustments
         ORDER BY e.createdAt ASC`,
        { userId: request.user.userId, simId: id }
      );

      const allEvidence = evidenceRows.map((row) => parseEvidenceRow(row));
      if (allEvidence.length === 0) {
        throw new ValidationError('Record at least one experiment result before creating an evidence-adjusted rerun.');
      }

      const selectedEvidence = body.evidenceIds?.length
        ? allEvidence.filter((entry) => body.evidenceIds?.includes(entry.id))
        : allEvidence;

      if (body.evidenceIds?.length && selectedEvidence.length !== body.evidenceIds.length) {
        throw new ValidationError('One or more evidenceIds were not found on this simulation.');
      }

      if (selectedEvidence.length === 0) {
        throw new ValidationError('No evidence results were selected for the rerun.');
      }

      const simulationId = uuidv4();
      const cloneCount = body.cloneCount ?? sourceSimulation.cloneCount;
      const rerunName = body.name ?? `${sourceSimulation.name} (evidence rerun)`;
      const batchSizeUsed = config.simulation.batchSize;
      const rerunParameters = {
        ...parseJson<Record<string, unknown>>(sourceSimulation.parameters, {}),
        evidence: selectedEvidence,
        sourceSimulationId: id,
        rerunMode: 'evidence_adjusted',
      };

      await runWriteSingle(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona {id: $personaId})
         MATCH (source:Simulation {id: $sourceSimulationId})
         CREATE (s:Simulation {
           id: $simulationId,
           name: $name,
           scenarioType: $scenarioType,
           status: 'pending',
           parameters: $parameters,
           cloneCount: $cloneCount,
           capitalAtRisk: $capitalAtRisk,
           batchSizeUsed: $batchSizeUsed,
           progress: 0,
           completedBatches: 0,
           sourceSimulationId: $sourceSimulationId,
           evidenceCount: $evidenceCount,
           rerunMode: 'evidence_adjusted',
           createdAt: datetime()
         })
         CREATE (p)-[:HAS_SIMULATION]->(s)
         CREATE (s)-[:RERUN_OF]->(source)
         WITH s
         UNWIND $evidenceIds AS evidenceId
         MATCH (e:SimulationEvidence {id: evidenceId})
         CREATE (s)-[:USES_EVIDENCE]->(e)
         RETURN s.id as id`,
        {
          userId: request.user.userId,
          personaId: sourceSimulation.personaId,
          sourceSimulationId: id,
          simulationId,
          name: rerunName,
          scenarioType: sourceSimulation.scenarioType,
          parameters: JSON.stringify(rerunParameters),
          cloneCount,
          capitalAtRisk: sourceSimulation.capitalAtRisk ?? null,
          batchSizeUsed,
          evidenceCount: selectedEvidence.length,
          evidenceIds: selectedEvidence.map((entry) => entry.id),
        }
      );

      const totalBatches = Math.ceil(cloneCount / batchSizeUsed);
      for (let i = 0; i < totalBatches; i++) {
        await scheduleSimulationBatch({
          simulationId,
          userId: request.user.userId,
          personaId: sourceSimulation.personaId,
          scenarioType: sourceSimulation.scenarioType,
          cloneBatchIndex: i,
          totalBatches,
        });
      }

      reply.status(202);
      return {
        simulationId,
        name: rerunName,
        status: 'pending',
        cloneCount,
        sourceSimulationId: id,
        evidenceCount: selectedEvidence.length,
      };
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
      const displayCopy = deriveSimulationDisplayCopy(sim);

      const result = {
        ...sim,
        title: displayCopy.title,
        primaryQuestion: displayCopy.primaryQuestion,
        parameters: displayCopy.parameters,
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
      const { narrative: wantNarrative } = (request.query as { narrative?: string });
      const sim = await runQuerySingle<{ results: string | null; status: string; scenarioType: string }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)-[:HAS_SIMULATION]->(s:Simulation {id: $simId})
         RETURN s.results as results, s.status as status, s.scenarioType as scenarioType`,
        { userId: request.user.userId, simId: id }
      );
      if (!sim) throw new NotFoundError('Simulation');

      const distributions: AggregatedResults | null = sim.results ? JSON.parse(sim.results) : null;

      if (wantNarrative === 'true' && distributions) {
        try {
          const signalRecords = await runQuery<{
            id: string;
            type: string;
            value: string;
            confidence: number;
            evidence: string;
            dimensions: string;
            timestamp: string;
            embedding: number[] | null;
          }>(
            `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)-[:DERIVED_FROM]->(s:Signal)
             RETURN s.id as id, s.type as type, s.value as value, s.confidence as confidence,
                    s.evidence as evidence, s.dimensions as dimensions, toString(s.timestamp) as timestamp,
                    s.embedding as embedding
             ORDER BY s.confidence DESC
             LIMIT 50`,
            { userId: request.user.userId }
          );

          const signals: BehavioralSignal[] = signalRecords.map((r) => ({
            id: r.id,
            type: r.type as BehavioralSignal['type'],
            value: r.value,
            confidence: r.confidence,
            evidence: r.evidence,
            sourceDataId: '',
            timestamp: r.timestamp,
            dimensions: r.dimensions ? JSON.parse(r.dimensions) : {},
          }));
          const signalEmbeddings = new Map(
            signalRecords
              .filter(record => Array.isArray(record.embedding))
              .map(record => [record.id, (record.embedding ?? []).map(value => Number(value))])
          );
          const conceptEmbeddings = EmbeddingService.isAvailable()
            ? await getDimensionConceptEmbeddings()
            : null;

          const mapper = new DimensionMapper(signals, conceptEmbeddings, signalEmbeddings);
          const dimensions = mapper.mapToDimensions();

          const generator = new NarrativeGenerator();
          const narrative = await generator.generate(distributions, signals, dimensions, sim.scenarioType);
          distributions.narrative = narrative;
        } catch (error) {
          logger.error({ error, simulationId: id }, 'Narrative generation failed, returning results without narrative');
        }
      }

      return {
        status: sim.status,
        distributions,
      };
    },
  });

  fastify.get('/:id/graph', {
    preHandler: [fastify.authenticate],
    handler: async (request) => {
      const { id } = request.params as { id: string };
      const simulation = await runQuerySingle<{
        id: string;
        name: string;
        scenarioType: string;
        status: string;
        parameters: string;
        cloneCount: number;
        capitalAtRisk: number | null;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(:Persona)-[:HAS_SIMULATION]->(s:Simulation {id: $simId})
         RETURN s.id as id,
                s.name as name,
                s.scenarioType as scenarioType,
                s.status as status,
                s.parameters as parameters,
                s.cloneCount as cloneCount,
                s.capitalAtRisk as capitalAtRisk`,
        { userId: request.user.userId, simId: id },
      );

      if (!simulation) {
        throw new NotFoundError('Simulation');
      }

      const displayCopy = deriveSimulationDisplayCopy(simulation);
      const parsedParameters = displayCopy.parameters;
      const acceptedEvidence = Array.isArray(parsedParameters.evidence)
        ? parsedParameters.evidence as EvidenceResult[]
        : [];
      const scenario = compileScenario({
        scenarioType: simulation.scenarioType,
        name: simulation.name,
        parameters: parsedParameters,
        capitalAtRisk: simulation.capitalAtRisk,
        evidence: acceptedEvidence,
      });
      const structure = buildSimulationGraphStructure(scenario);

      let snapshot = null;
      if (simulation.status === 'completed') {
        const rows = await runQuery<{
          cloneId: string;
          path: string;
          finalState: string;
          metrics: string;
          category: 'edge' | 'central' | 'typical';
          percentile: number;
        }>(
          `MATCH (s:Simulation {id: $simulationId})-[:HAS_RESULT]->(cr:CloneResult)
           RETURN cr.cloneId as cloneId,
                  cr.path as path,
                  cr.finalState as finalState,
                  cr.metrics as metrics,
                  cr.category as category,
                  cr.percentile as percentile`,
          { simulationId: id },
        );

        const cloneResults: CloneResult[] = rows.map((row) => ({
          cloneId: row.cloneId,
          parameters: {} as CloneResult['parameters'],
          stratification: {
            percentile: row.percentile,
            category: row.category,
          },
          path: JSON.parse(row.path) as string[],
          finalState: JSON.parse(row.finalState),
          metrics: JSON.parse(row.metrics),
          duration: 0,
        }));

        snapshot = buildCompletedSimulationGraphSnapshot(
          structure,
          cloneResults,
          GRAPH_SAMPLE_TRACE_LIMIT,
        );
      } else {
        const redis = await getRedisClient();
        const liveSnapshot = await redis.get(getSimulationGraphKey(id));
        if (liveSnapshot) {
          try {
            snapshot = JSON.parse(liveSnapshot);
          } catch (error) {
            logger.warn({ error, simulationId: id }, 'Failed to parse live graph snapshot');
          }
        }
      }

      return createSimulationGraphEnvelope({
        simulationId: id,
        name: simulation.name,
        title: scenario.decisionFrame?.title ?? displayCopy.title,
        primaryQuestion: scenario.decisionFrame?.primaryQuestion ?? displayCopy.primaryQuestion,
        status: simulation.status,
        scenarioType: simulation.scenarioType,
        structure,
        snapshot,
      });
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
         OPTIONAL MATCH (s)-[:HAS_EVIDENCE]->(e:SimulationEvidence)
         DETACH DELETE s, cr, e`,
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
