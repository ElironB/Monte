import { Job } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import type { Worker } from 'bullmq';
import { createWorker, IngestionJobData, PersonaJobData, SimulationJobData } from '../ingestionQueue.js';
import { logger } from '../../../utils/logger.js';
import { config } from '../../../config/index.js';
import { runQuerySingle, runWriteSingle, runQuery } from '../../../config/neo4j.js';
import { getFile } from '../../../config/minio.js';
import { getRedisClient } from '../../../config/redis.js';
import { SearchHistoryExtractor } from '../../extractors/searchHistory.js';
import { SocialBehaviorExtractor } from '../../extractors/socialBehavior.js';
import { FinancialBehaviorExtractor } from '../../extractors/financialBehavior.js';
import { CognitiveStructureExtractor } from '../../extractors/cognitiveStructure.js';
import { MediaConsumptionExtractor } from '../../extractors/mediaConsumption.js';
import { AIChatHistoryExtractor } from '../../extractors/aiChatHistory.js';
import { SemanticExtractor } from '../../extractors/semanticExtractor.js';
import { ContradictionDetector } from '../../contradictionDetector.js';
import { DimensionMapper } from '../../../persona/dimensionMapper.js';
import { GraphBuilder } from '../../../persona/graphBuilder.js';
import { PersonaCompressor } from '../../../persona/personaCompressor.js';
import { CloneGenerator, CloneParameters } from '../../../persona/cloneGenerator.js';
import { BayesianUpdater, DriftDetector } from '../../../persona/bayesianUpdater.js';
import { EmbeddingService } from '../../../embeddings/embeddingService.js';
import { getDimensionConceptEmbeddings } from '../../../embeddings/dimensionConcepts.js';
import { BehavioralSignal, SignalContradiction } from '../../types.js';
import { parseTimestamp, detectSequences } from '../../extractors/temporalUtils.js';

// Phase 4: Simulation Engine imports
import { SimulationEngine } from '../../../simulation/engine.js';
import { compileScenario } from '../../../simulation/scenarioCompiler.js';
import { createAggregator } from '../../../simulation/resultAggregator.js';
import { persistCloneResultsBatch } from '../../../simulation/resultPersistence.js';
import { buildRerunComparison } from '../../../simulation/evidenceLoop.js';
import {
  AggregatedResults,
  CloneResult,
  EvidenceResult,
  SimulationRuntimeTelemetry,
} from '../../../simulation/types.js';
import { calculateKelly } from '../../../simulation/kellyCalculator.js';
import {
  calculatePersistingPhaseProgress,
  createProgressSnapshot,
  estimateTimeRemainingSeconds,
} from '../../../simulation/progress.js';
import {
  createEmptySimulationRuntimeTelemetry,
  mergeSimulationRuntimeTelemetry,
} from '../../../simulation/runtimeTelemetry.js';
import { RateLimiter, createConcurrencyLimiter, detectProviderRPM } from '../../../utils/rateLimiter.js';

const extractors = [
  new SearchHistoryExtractor(),
  new SocialBehaviorExtractor(),
  new FinancialBehaviorExtractor(),
  new CognitiveStructureExtractor(),
  new MediaConsumptionExtractor(),
  new AIChatHistoryExtractor(),
];

const semanticExtractor = new SemanticExtractor();
const SIMULATION_PROGRESS_TTL_SECONDS = 300;
const SIMULATION_RUNTIME_TTL_SECONDS = 86400;

function getSimulationProgressKey(simulationId: string): string {
  return `sim:${simulationId}:progress`;
}

function getSimulationProcessedClonesKey(simulationId: string): string {
  return `sim:${simulationId}:processedClones`;
}

function getSimulationProgressStartedAtKey(simulationId: string): string {
  return `sim:${simulationId}:progressStartedAtMs`;
}

function getSimulationBatchProcessedClonesKey(simulationId: string, batchIndex: number): string {
  return `sim:${simulationId}:batch:${batchIndex}:processedClones`;
}

function getSimulationBatchTelemetryKey(simulationId: string, batchIndex: number): string {
  return `sim:${simulationId}:batch:${batchIndex}:runtimeTelemetry`;
}

async function storeSimulationBatchTelemetry(
  redis: Awaited<ReturnType<typeof getRedisClient>>,
  simulationId: string,
  batchIndex: number,
  telemetry: SimulationRuntimeTelemetry,
): Promise<void> {
  await redis.setex(
    getSimulationBatchTelemetryKey(simulationId, batchIndex),
    SIMULATION_RUNTIME_TTL_SECONDS,
    JSON.stringify(telemetry),
  );
}

async function loadSimulationRuntimeTelemetry(
  redis: Awaited<ReturnType<typeof getRedisClient>>,
  simulationId: string,
  totalBatches: number,
): Promise<SimulationRuntimeTelemetry> {
  const telemetryPayloads = await Promise.all(
    Array.from({ length: totalBatches }, (_, index) =>
      redis.get(getSimulationBatchTelemetryKey(simulationId, index))),
  );

  const parsed = telemetryPayloads
    .filter((payload): payload is string => typeof payload === 'string' && payload.length > 0)
    .map((payload) => {
      try {
        return JSON.parse(payload) as SimulationRuntimeTelemetry;
      } catch {
        return null;
      }
    });

  return mergeSimulationRuntimeTelemetry(parsed);
}

async function publishSimulationProgress(
  redis: Awaited<ReturnType<typeof getRedisClient>>,
  simulationId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await redis.setex(
    getSimulationProgressKey(simulationId),
    SIMULATION_PROGRESS_TTL_SECONDS,
    JSON.stringify({
      simulationId,
      ...payload,
      lastUpdated: new Date().toISOString(),
    }),
  );
}

async function processIngestion(job: Job<IngestionJobData>): Promise<void> {
  logger.info({ jobId: job.id }, 'Processing ingestion');
  
  const { userId, sourceId, sourceType, filePath, metadata } = job.data;
  
  await runWriteSingle(
    `MATCH (d:DataSource {id: $sourceId})
     SET d.status = 'processing', d.processedAt = datetime()
     RETURN d.id as id`,
    { sourceId }
  );
  
  try {
    let rawContent = '';
    if (filePath) {
      const buffer = await getFile(filePath);
      rawContent = buffer.toString('utf-8');
    } else if (metadata?.content) {
      rawContent = metadata.content as string;
    }
    
    const rawData = {
      sourceId,
      userId,
      sourceType: sourceType as any,
      rawContent,
      metadata: metadata || {},
    };
    
    const allSignals: BehavioralSignal[] = [];
    for (const extractor of extractors) {
      if (extractor.sourceTypes.includes(sourceType) || 
          extractor.sourceTypes.some((st: string) => sourceType.includes(st))) {
        const signals = await extractor.extract(rawData);
        allSignals.push(...signals);
      }
    }

    if (semanticExtractor.sourceTypes.includes(sourceType)) {
      try {
        const semanticSignals = await semanticExtractor.extract(rawData);
        const existingValues = new Set(allSignals.map(signal => signal.value.toLowerCase()));
        const newSemanticSignals = semanticSignals.filter(signal => !existingValues.has(signal.value.toLowerCase()));
        allSignals.push(...newSemanticSignals);
        logger.info(
          { sourceId: rawData.sourceId, semanticSignalCount: newSemanticSignals.length },
          'Semantic extraction complete',
        );
      } catch (err) {
        logger.warn({ err, sourceId: rawData.sourceId }, 'Semantic extraction failed');
      }
    }
    
    for (const signal of allSignals) {
      await runWriteSingle(
        `MATCH (d:DataSource {id: $sourceId})
         CREATE (s:Signal {
           id: $signalId,
           type: $type,
           value: $value,
           confidence: $confidence,
           evidence: $evidence,
           timestamp: datetime($signalTimestamp),
           dimensions: $dimensions
         })
         CREATE (d)-[:HAS_SIGNAL]->(s)
         RETURN s.id as id`,
        {
          sourceId,
          signalId: signal.id,
          type: signal.type,
          value: signal.value,
          confidence: signal.confidence,
          evidence: signal.evidence,
          signalTimestamp: signal.timestamp,
          dimensions: JSON.stringify(signal.dimensions),
        }
      );
    }

    let signalEmbeddings = new Map<string, number[]>();
    if (allSignals.length > 0 && EmbeddingService.isAvailable()) {
      try {
        const service = EmbeddingService.getInstance();
        const signalTexts = allSignals.map(signal => {
          const d = parseTimestamp(signal.timestamp);
          let temporalPrefix = '';
          if (d) {
            const h = d.getUTCHours();
            let timeOfDay = 'late_night';
            if (h >= 5 && h < 12) timeOfDay = 'morning';
            else if (h >= 12 && h < 17) timeOfDay = 'afternoon';
            else if (h >= 17 && h < 22) timeOfDay = 'evening';
            const day = d.getUTCDay();
            const dayOfWeek = (day === 0 || day === 6) ? 'weekend' : 'weekday';
            temporalPrefix = `[${timeOfDay}, ${dayOfWeek}] `;
          }
          return `${temporalPrefix}${signal.type}: ${signal.value} — ${signal.evidence}`;
        });
        const embeddings = await service.embedBatch(signalTexts);

        for (let i = 0; i < allSignals.length; i++) {
          const embedding = embeddings[i];
          signalEmbeddings.set(allSignals[i].id, embedding);
          await runWriteSingle(
            `MATCH (s:Signal {id: $signalId})
             SET s.embedding = $embedding
             RETURN s.id as id`,
            { signalId: allSignals[i].id, embedding }
          );
        }

        const sequences = detectSequences(allSignals, signalEmbeddings);
        const compositeSignals: BehavioralSignal[] = [];

        for (const seq of sequences) {
          const capped = seq.signals.slice(-5);
          const compositeValue = capped.map(s => s.value).join(' -> ');
          const progressionMultiplier = seq.progressionScore > 0.6 ? 1.5 : 0.8;
          const avgBaseConfidence = capped.reduce((sum, s) => sum + s.confidence, 0) / capped.length;

          const compositeSignal: BehavioralSignal = {
            id: uuidv4(),
            type: 'cognitive_trait',
            value: `Sequence: ${compositeValue}`,
            confidence: Math.min(1, avgBaseConfidence * progressionMultiplier),
            evidence: `Composite sequence of ${capped.length} temporally clustered signals forming a tracked pattern.`,
            sourceDataId: sourceId,
            timestamp: capped[capped.length - 1].timestamp,
            dimensions: {
              temporalCluster: 'sequence',
              recurrence: capped.length,
            }
          };
          compositeSignals.push(compositeSignal);
        }

        if (compositeSignals.length > 0) {
          const compositeTexts = compositeSignals.map(signal => {
            const d = parseTimestamp(signal.timestamp);
            let temporalPrefix = '';
            if (d) {
              const h = d.getUTCHours();
              let timeOfDay = 'late_night';
              if (h >= 5 && h < 12) timeOfDay = 'morning';
              else if (h >= 12 && h < 17) timeOfDay = 'afternoon';
              else if (h >= 17 && h < 22) timeOfDay = 'evening';
              const day = d.getUTCDay();
              const dayOfWeek = (day === 0 || day === 6) ? 'weekend' : 'weekday';
              temporalPrefix = `[${timeOfDay}, ${dayOfWeek}] `;
            }
            return `${temporalPrefix}${signal.type}: ${signal.value} — ${signal.evidence}`;
          });

          const compositeEmbs = await service.embedBatch(compositeTexts);

          for (let i = 0; i < compositeSignals.length; i++) {
            const sig = compositeSignals[i];
            const emb = compositeEmbs[i];

            await runWriteSingle(
              `CREATE (s:Signal {
                 id: $signalId,
                 type: $type,
                 value: $value,
                 confidence: $confidence,
                 evidence: $evidence,
                 timestamp: datetime($signalTimestamp),
                 dimensions: $dimensions
               })
               WITH s
               MATCH (d:DataSource {id: $sourceId})
               CREATE (d)-[:HAS_SIGNAL]->(s)
               SET s.embedding = $embedding
               RETURN s.id as id`,
              {
                sourceId,
                signalId: sig.id,
                type: sig.type,
                value: sig.value,
                confidence: sig.confidence,
                evidence: sig.evidence,
                signalTimestamp: sig.timestamp,
                dimensions: JSON.stringify(sig.dimensions),
                embedding: emb
              }
            );

            allSignals.push(sig);
            signalEmbeddings.set(sig.id, emb);
          }
        }

        logger.info({ sourceId, embeddedCount: allSignals.length, sequencesFound: compositeSignals.length }, 'Signal embeddings stored');
      } catch (err) {
        signalEmbeddings = new Map();
        logger.warn({ err, sourceId }, 'Failed to embed signals — dimension mapping will use fallback');
      }
    }
    
    if (allSignals.length > 0) {
      let dimensionConceptEmbs = null;
      try {
        dimensionConceptEmbs = await getDimensionConceptEmbeddings();
      } catch {
        dimensionConceptEmbs = null;
      }

      let existingContradictions: SignalContradiction[] = [];
      try {
        existingContradictions = await fetchContradictions(userId);
      } catch (err) {
        logger.warn({ err, userId }, 'Failed to fetch existing contradictions');
      }

      const detector = new ContradictionDetector(allSignals, signalEmbeddings, dimensionConceptEmbs, existingContradictions);
      const contradictions = await detector.detect();
      
      for (const contradiction of contradictions) {
        const { statedSignalId, revealedSignalId } = getContradictionRoleAssignment(contradiction);

        await runWriteSingle(
          `MERGE (c:Contradiction {id: $id})
           ON CREATE SET c.createdAt = datetime()
           SET c.type = $type,
               c.description = $description,
               c.severity = $severity,
               c.magnitude = $magnitude,
               c.affectedDimensions = $affectedDimensions,
               c.statedSignalId = $statedSignalId,
               c.revealedSignalId = $revealedSignalId,
               c.convergenceRate = $convergenceRate,
               c.isPermanentTrait = $isPermanentTrait,
               c.firstSeen = datetime($firstSeen),
               c.lastSeen = datetime($lastSeen),
               c.updatedAt = datetime()
          WITH c
          MATCH (s1:Signal {id: $signalAId}), (s2:Signal {id: $signalBId})
          MERGE (s1)-[:CONTRADICTS]->(c)<-[:CONTRADICTS]-(s2)
          RETURN c.id as id`,
          {
            id: contradiction.id,
            type: contradiction.type,
            description: contradiction.description,
            severity: contradiction.severity,
            magnitude: contradiction.magnitude,
            affectedDimensions: JSON.stringify(contradiction.affectedDimensions),
            statedSignalId,
            revealedSignalId,
            signalAId: contradiction.signalAId,
            signalBId: contradiction.signalBId,
            convergenceRate: contradiction.convergenceRate ?? 0,
            isPermanentTrait: contradiction.isPermanentTrait ?? false,
            firstSeen: contradiction.firstSeen,
            lastSeen: contradiction.lastSeen,
          }
        );
      }
    }
    
    await runWriteSingle(
      `MATCH (d:DataSource {id: $sourceId})
       SET d.status = 'completed', d.completedAt = datetime(), d.signalCount = $signalCount
       RETURN d.id as id`,
      { sourceId, signalCount: allSignals.length }
    );
    
    logger.info({ jobId: job.id, signalCount: allSignals.length }, 'Ingestion complete');
    
  } catch (err) {
    logger.error({ err, jobId: job.id }, 'Ingestion failed');
    
    await runWriteSingle(
      `MATCH (d:DataSource {id: $sourceId})
       SET d.status = 'failed', d.error = $error, d.failedAt = datetime()
       RETURN d.id as id`,
      { sourceId, error: (err as Error).message }
    );
    
    throw err;
  }
}

async function processPersona(job: Job<PersonaJobData>): Promise<void> {
  logger.info({ jobId: job.id, data: job.data }, 'Processing persona build');

  const { userId, personaId } = job.data;

  try {
    const previousPersona = await runQuerySingle<{ id: string; version: number | { toNumber: () => number } }>(
      `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)
       WHERE p.buildStatus = 'ready' AND p.id <> $personaId
       RETURN p.id as id, p.version as version
       ORDER BY p.version DESC
       LIMIT 1`,
      { userId, personaId }
    );

    if (previousPersona) {
      const historicalSignals = await fetchSignals(userId, false);
      const nowMs = Date.now();
      const recentSignals = historicalSignals.filter(s => {
        const d = parseTimestamp(s.timestamp);
        return d && (nowMs - d.getTime() <= 90 * 24 * 60 * 60 * 1000);
      });
      
      const driftEval = new DriftDetector().evaluateDrift(recentSignals, historicalSignals);
      
      if (driftEval.recommendedStrategy.includes('full_rebuild')) {
        logger.info({ userId, strategy: driftEval.recommendedStrategy }, 'Drift detected, initiating full rebuild');
        await processFullBuild(userId, personaId);
        return;
      }

      await processIncrementalUpdate(userId, personaId, previousPersona.id);
      return;
    }

    await processFullBuild(userId, personaId);
  } catch (error) {
    await markPersonaFailed(personaId, error);
    throw error;
  }
}


async function markPersonaFailed(personaId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : 'Unknown persona build failure';
  await runWriteSingle(
    `MATCH (p:Persona {id: $personaId})
     SET p.buildStatus = 'failed',
         p.lastError = $message,
         p.updatedAt = datetime()
     RETURN p.id as id`,
    { personaId, message }
  );
}

interface StoredSignalRecord {
  id: string;
  type: BehavioralSignal['type'];
  value: string;
  confidence: number;
  evidence: string;
  timestamp: string;
  sourceType?: string;
  dimensions: string | BehavioralSignal['dimensions'] | null;
}

async function processFullBuild(userId: string, personaId: string): Promise<void> {
  ensureEmbeddingsConfigured();

  const signals = await fetchSignals(userId);
  const signalIds = signals.map(signal => signal.id);
  const signalEmbeddings = await fetchSignalEmbeddings(signalIds);
  const conceptEmbeddings = await getDimensionConceptEmbeddings();
  const contradictions = await fetchContradictions(userId);

  logger.info(
    { personaId, signalCount: signals.length, contradictionCount: contradictions.length },
    'Building persona from all signals'
  );

  const mapper = new DimensionMapper(signals, conceptEmbeddings, signalEmbeddings, contradictions);
  const result = mapper.mapToDimensionsWithContradictions();

  const graphBuilder = new GraphBuilder(userId, personaId);
  await graphBuilder.buildPersonaGraph(result.dimensions, result.dimensionScores, signalIds);

  const { traits, memories } = await graphBuilder.getPersonaGraph();
  const compressor = new PersonaCompressor(traits, memories);
  const masterPersona = compressor.compress();

  await storeMasterPersona(personaId, masterPersona, signals.length);
  await regenerateClones(personaId, masterPersona, contradictions);

  logger.info({ personaId, signalCount: signals.length }, 'Persona full build complete');
}

async function processIncrementalUpdate(
  userId: string,
  personaId: string,
  previousPersonaId: string
): Promise<void> {
  logger.info({ personaId, previousPersonaId }, 'Processing incremental persona update');

  await clonePersonaState(previousPersonaId, personaId);

  ensureEmbeddingsConfigured();

  const newSignals = await fetchSignals(userId, true);

  if (newSignals.length > 0) {
    const signalEmbeddings = await fetchSignalEmbeddings(newSignals.map(signal => signal.id));
    const conceptEmbeddings = await getDimensionConceptEmbeddings();
    const contradictions = await fetchContradictions(userId);
    const mapper = new DimensionMapper(newSignals, conceptEmbeddings, signalEmbeddings, contradictions);
    const newDimensions = mapper.mapToDimensionsWithContradictions().dimensions;
    const updater = new BayesianUpdater(userId, personaId, conceptEmbeddings, signalEmbeddings);
    const updateResult = await updater.update(newSignals, newDimensions);

    await linkSignalsToPersona(personaId, newSignals.map(signal => signal.id));

    logger.info(
      {
        personaId,
        previousPersonaId,
        newSignalCount: updateResult.newSignalCount,
        contradictionsRaised: updateResult.contradictionsRaised,
        overallConfidenceDelta: updateResult.overallConfidenceDelta,
      },
      'Bayesian persona update applied'
    );
  } else {
    logger.info({ personaId, previousPersonaId }, 'No new signals found for incremental persona update');
  }

  const graphBuilder = new GraphBuilder(userId, personaId);
  await graphBuilder.rebuildTraitRelationships();

  const { traits, memories } = await graphBuilder.getPersonaGraph();
  const compressor = new PersonaCompressor(traits, memories);
  const masterPersona = compressor.compress();
  const totalSignalCount = await countPersonaSignals(personaId);

  await storeMasterPersona(personaId, masterPersona, totalSignalCount);
  const contradictions = await fetchContradictions(userId);
  await regenerateClones(personaId, masterPersona, contradictions);

  logger.info({ personaId, previousPersonaId, signalCount: totalSignalCount }, 'Persona incremental update complete');
}

async function fetchSignals(userId: string, onlyNewSignals: boolean = false): Promise<BehavioralSignal[]> {
  const filters = ["d.status = 'completed'"];
  if (onlyNewSignals) {
    filters.push('NOT EXISTS { MATCH (:Persona)-[:DERIVED_FROM]->(s) }');
  }

  const records = await runQuery<StoredSignalRecord>(
    `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource)-[:HAS_SIGNAL]->(s:Signal)
     WHERE ${filters.join(' AND ')}
     RETURN s.id as id,
            coalesce(d.sourceType, d.type) as sourceType,
            s.type as type,
            s.value as value,
            s.confidence as confidence,
            s.evidence as evidence,
            toString(s.timestamp) as timestamp,
            s.dimensions as dimensions`,
    { userId }
  );

  return records.map(record => ({
    id: record.id,
    type: record.type,
    value: record.value,
    confidence: record.confidence,
    evidence: record.evidence,
    sourceDataId: '',
    sourceType: record.sourceType,
    timestamp: record.timestamp,
    dimensions: parseSignalDimensions(record.dimensions),
  }));
}


async function fetchSignalEmbeddings(signalIds: string[]): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  if (signalIds.length === 0) {
    return map;
  }

  const records = await runQuery<{ id: string; embedding: number[] | null }>(
    `MATCH (s:Signal)
     WHERE s.id IN $signalIds AND s.embedding IS NOT NULL
     RETURN s.id as id, s.embedding as embedding`,
    { signalIds }
  );

  for (const record of records) {
    if (Array.isArray(record.embedding)) {
      map.set(record.id, record.embedding.map(value => Number(value)));
    }
  }

  return map;
}

async function fetchContradictions(userId: string): Promise<SignalContradiction[]> {
  const records = await runQuery<{
    id: string;
    type: string;
    description: string;
    severity: string;
    magnitude: number | null;
    affectedDimensions: string | null;
    statedSignalId: string | null;
    revealedSignalId: string | null;
    convergenceRate: number | null;
    isPermanentTrait: boolean | null;
    firstSeen: string | null;
    lastSeen: string | null;
    connectedSignalIds: string[] | null;
  }>(
    `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(:DataSource)-[:HAS_SIGNAL]->(:Signal)-[:CONTRADICTS]->(c:Contradiction)
     WITH DISTINCT c
     OPTIONAL MATCH (s:Signal)-[:CONTRADICTS]->(c)
     RETURN c.id as id,
            c.type as type,
            c.description as description,
            c.severity as severity,
            c.magnitude as magnitude,
            c.affectedDimensions as affectedDimensions,
            c.statedSignalId as statedSignalId,
            c.revealedSignalId as revealedSignalId,
            c.convergenceRate as convergenceRate,
            c.isPermanentTrait as isPermanentTrait,
            toString(c.firstSeen) as firstSeen,
            toString(c.lastSeen) as lastSeen,
            collect(DISTINCT s.id) as connectedSignalIds`,
    { userId }
  );

  return records.map(record => ({
    id: record.id,
    ...resolveFetchedContradictionSignals(record),
    type: record.type as SignalContradiction['type'],
    description: record.description,
    severity: record.severity as SignalContradiction['severity'],
    magnitude: typeof record.magnitude === 'number'
      ? Math.max(0, Math.min(1, record.magnitude))
      : record.severity === 'high'
        ? 0.8
        : record.severity === 'medium'
          ? 0.5
          : 0.3,
    affectedDimensions: record.affectedDimensions
      ? JSON.parse(record.affectedDimensions) as string[]
      : [],
    convergenceRate: record.convergenceRate ?? 0,
    isPermanentTrait: record.isPermanentTrait ?? false,
    firstSeen: record.firstSeen || undefined,
    lastSeen: record.lastSeen || undefined,
  }));
}

function getContradictionRoleAssignment(
  contradiction: SignalContradiction
): { statedSignalId: string | null; revealedSignalId: string | null } {
  switch (contradiction.type) {
    case 'stated_vs_revealed':
    case 'temporal':
    case 'cross_domain':
      return {
        statedSignalId: contradiction.signalAId,
        revealedSignalId: contradiction.signalBId,
      };
    default:
      return {
        statedSignalId: null,
        revealedSignalId: null,
      };
  }
}

function resolveFetchedContradictionSignals(record: {
  statedSignalId: string | null;
  revealedSignalId: string | null;
  connectedSignalIds: string[] | null;
}): Pick<SignalContradiction, 'signalAId' | 'signalBId'> {
  if (record.statedSignalId && record.revealedSignalId) {
    return {
      signalAId: record.statedSignalId,
      signalBId: record.revealedSignalId,
    };
  }

  const fallbackIds = [...new Set(record.connectedSignalIds ?? [])].sort();
  return {
    signalAId: record.statedSignalId ?? fallbackIds[0] ?? '',
    signalBId: record.revealedSignalId ?? fallbackIds[1] ?? fallbackIds[0] ?? '',
  };
}

function ensureEmbeddingsConfigured(): void {
  if (!EmbeddingService.isAvailable()) {
    throw new Error('Embeddings require OPENROUTER_API_KEY or EMBEDDING_API_KEY. Groq does not support embeddings.');
  }
}

function parseSignalDimensions(
  rawDimensions: string | BehavioralSignal['dimensions'] | null
): BehavioralSignal['dimensions'] {
  if (!rawDimensions) {
    return {};
  }

  if (typeof rawDimensions === 'string') {
    try {
      return JSON.parse(rawDimensions) as BehavioralSignal['dimensions'];
    } catch (err) {
      logger.warn({ err, rawDimensions }, 'Failed to parse signal dimensions');
      return {};
    }
  }

  return rawDimensions;
}

async function clonePersonaState(sourcePersonaId: string, targetPersonaId: string): Promise<void> {
  await runWriteSingle(
    `MATCH (source:Persona {id: $sourcePersonaId})-[:HAS_TRAIT]->(t:Trait)
     MATCH (target:Persona {id: $targetPersonaId})
     CREATE (target)-[:HAS_TRAIT]->(:Trait {
       id: randomUUID(),
       type: t.type,
       name: t.name,
       value: t.value,
       confidence: t.confidence,
       evidence: t.evidence,
       dimension: t.dimension,
       evidenceCount: coalesce(t.evidenceCount, 1),
       lowConfidence: coalesce(t.lowConfidence, false),
       updateHistory: coalesce(t.updateHistory, ''),
       createdAt: datetime(),
       lastUpdated: coalesce(t.lastUpdated, datetime())
     })
     RETURN count(t) as copied`,
    { sourcePersonaId, targetPersonaId }
  );

  await runWriteSingle(
    `MATCH (source:Persona {id: $sourcePersonaId})-[:HAS_MEMORY]->(m:Memory)
     MATCH (target:Persona {id: $targetPersonaId})
     CREATE (target)-[:HAS_MEMORY]->(:Memory {
       id: randomUUID(),
       type: m.type,
       content: m.content,
       timestamp: m.timestamp,
       sourceId: m.sourceId,
       emotionalValence: m.emotionalValence,
       createdAt: datetime()
     })
     RETURN count(m) as copied`,
    { sourcePersonaId, targetPersonaId }
  );

  await runWriteSingle(
    `MATCH (source:Persona {id: $sourcePersonaId})-[:DERIVED_FROM]->(s:Signal)
     MATCH (target:Persona {id: $targetPersonaId})
     MERGE (target)-[:DERIVED_FROM]->(s)
     RETURN count(s) as copied`,
    { sourcePersonaId, targetPersonaId }
  );
}

async function linkSignalsToPersona(personaId: string, signalIds: string[]): Promise<void> {
  if (signalIds.length === 0) {
    return;
  }

  for (const signalId of signalIds) {
    await runWriteSingle(
      `MATCH (p:Persona {id: $personaId}), (s:Signal {id: $signalId})
       MERGE (p)-[:DERIVED_FROM]->(s)
       RETURN p.id as id`,
      { personaId, signalId }
    );
  }
}

async function countPersonaSignals(personaId: string): Promise<number> {
  const result = await runQuerySingle<{ count: number | { toNumber: () => number } }>(
    `MATCH (p:Persona {id: $personaId})-[:DERIVED_FROM]->(s:Signal)
     RETURN count(DISTINCT s) as count`,
    { personaId }
  );

  return toNumber(result?.count ?? 0);
}

async function storeMasterPersona(
  personaId: string,
  masterPersona: ReturnType<PersonaCompressor['compress']>,
  signalCount: number
): Promise<void> {
  await runWriteSingle(
    `MATCH (p:Persona {id: $personaId})
     SET p.buildStatus = 'ready',
         p.summary = $summary,
         p.narrativeSummary = $narrativeSummary,
         p.riskProfile = $riskProfile,
         p.timeHorizon = $timeHorizon,
         p.behavioralFingerprint = $fingerprint,
         p.dominantTraits = $dominantTraits,
         p.keyContradictions = $contradictions,
         p.psychologicalProfile = $psychologicalProfile,
         p.llmContextSummary = $llmContextSummary,
         p.signalCount = $signalCount,
         p.updatedAt = datetime()
     RETURN p.id as id`,
    {
      personaId,
      summary: masterPersona.summary,
      narrativeSummary: masterPersona.narrativeSummary,
      riskProfile: masterPersona.riskProfile,
      timeHorizon: masterPersona.timeHorizon,
      fingerprint: JSON.stringify(masterPersona.behavioralFingerprint),
      dominantTraits: JSON.stringify(masterPersona.dominantTraits),
      contradictions: JSON.stringify(masterPersona.keyContradictions),
      psychologicalProfile: masterPersona.psychologicalProfile
        ? JSON.stringify(masterPersona.psychologicalProfile)
        : null,
      llmContextSummary: masterPersona.llmContextSummary ?? null,
      signalCount,
    }
  );
}

async function regenerateClones(
  personaId: string,
  masterPersona: ReturnType<PersonaCompressor['compress']>,
  contradictions: SignalContradiction[]
): Promise<void> {
  await runWriteSingle(
    `MATCH (p:Persona {id: $personaId})-[:HAS_CLONE]->(c:Clone)
     WITH collect(c) as clones
     FOREACH (clone IN clones | DETACH DELETE clone)
     RETURN size(clones) as deleted`,
    { personaId }
  );

  const cloneGen = new CloneGenerator(masterPersona, personaId, contradictions);
  const clones = cloneGen.generateClones(1000);
  const batchSize = 100;

  for (let i = 0; i < clones.length; i += batchSize) {
    const batch = clones.slice(i, i + batchSize);

    for (const clone of batch) {
      await runWriteSingle(
        `MATCH (p:Persona {id: $personaId})
         CREATE (c:Clone {
           id: $cloneId,
           parameters: $parameters,
           percentile: $percentile,
           category: $category,
           createdAt: datetime()
         })
         CREATE (p)-[:HAS_CLONE]->(c)
         RETURN c.id as id`,
        {
          personaId,
          cloneId: clone.id,
          parameters: JSON.stringify(clone.parameters),
          percentile: clone.stratification.percentile,
          category: clone.stratification.category,
        }
      );
    }
  }

  await runWriteSingle(
    `MATCH (p:Persona {id: $personaId})
     SET p.cloneCount = $cloneCount,
         p.updatedAt = datetime()
     RETURN p.id as id`,
    { personaId, cloneCount: clones.length }
  );
}

function toNumber(value: number | { toNumber: () => number }): number {
  if (typeof value === 'number') {
    return value;
  }

  return value.toNumber();
}

interface CloneData {
  id: string;
  parameters: CloneParameters;
  percentile: number;
  category: 'edge' | 'central' | 'typical';
}

async function processSimulation(job: Job<SimulationJobData>): Promise<void> {
  logger.info({ jobId: job.id, data: job.data }, 'Processing simulation batch');
  
  const { simulationId, userId, personaId, scenarioType, cloneBatchIndex, totalBatches } = job.data;
  let simulationCloneCount = 0;
  
  try {
    // Get simulation details
    const simulation = await runQuerySingle<{
      name: string;
      parameters: string;
      cloneCount: number;
      capitalAtRisk: number | null;
    }>(
      `MATCH (s:Simulation {id: $simulationId})
       RETURN s.name as name, s.parameters as parameters, s.cloneCount as cloneCount, s.capitalAtRisk as capitalAtRisk`,
      { simulationId }
    );
    
    if (!simulation) {
      throw new Error(`Simulation ${simulationId} not found`);
    }
    simulationCloneCount = simulation.cloneCount;

    await runWriteSingle(
      `MATCH (s:Simulation {id: $simulationId})
       WHERE coalesce(s.status, 'pending') = 'pending'
       SET s.status = 'running'
       RETURN s.id as id`,
      { simulationId }
    );
    
    // Compile scenario from stored simulation parameters
    const simulationParameters = simulation.parameters
      ? JSON.parse(simulation.parameters)
      : {};
    const acceptedEvidence = Array.isArray(simulationParameters.evidence)
      ? simulationParameters.evidence as EvidenceResult[]
      : [];
    const sourceSimulationId = typeof simulationParameters.sourceSimulationId === 'string'
      ? simulationParameters.sourceSimulationId
      : undefined;
    const sanitizedScenarioParameters = {
      ...simulationParameters,
    };
    delete sanitizedScenarioParameters.evidence;
    delete sanitizedScenarioParameters.sourceSimulationId;
    delete sanitizedScenarioParameters.rerunMode;
    const scenario = compileScenario({
      scenarioType,
      name: simulation.name,
      parameters: sanitizedScenarioParameters,
      capitalAtRisk: simulation.capitalAtRisk,
      evidence: acceptedEvidence,
    });
    
    // Calculate batch size (100 clones per batch by default)
    const batchSize = config.simulation.batchSize;
    const startIndex = Math.trunc(cloneBatchIndex * batchSize);
    const endIndex = Math.trunc(Math.min(startIndex + batchSize, simulation.cloneCount));
    const cloneLimit = Math.max(0, Math.trunc(endIndex - startIndex));
    
    // Fetch clones for this batch
    const cloneData = await runQuery<CloneData>(
      `MATCH (p:Persona {id: $personaId})-[:HAS_CLONE]->(c:Clone)
       WITH c
       ORDER BY c.id
       SKIP $skip
       LIMIT $limit
       RETURN c.id as id, c.parameters as parameters, c.percentile as percentile, c.category as category`,
      { personaId, skip: startIndex, limit: cloneLimit }
    );
    
    // Parse clone parameters
    const clones: Array<{
      cloneId: string;
      parameters: CloneParameters;
      stratification: { percentile: number; category: 'edge' | 'central' | 'typical' };
    }> = cloneData.map(c => ({
      cloneId: c.id,
      parameters: JSON.parse(c.parameters as unknown as string),
      stratification: {
        percentile: c.percentile,
        category: c.category,
      },
    }));
    
    logger.info({ 
      simulationId, 
      batchIndex: cloneBatchIndex, 
      cloneCount: clones.length,
      scenario: scenarioType 
    }, 'Running simulation batch');

    const rpm = typeof config.simulation.llmRpmLimit === 'number'
      ? config.simulation.llmRpmLimit
      : detectProviderRPM();
    const concurrency = config.simulation.cloneConcurrency;
    const rateLimiter = new RateLimiter(rpm);
    const redis = await getRedisClient();
    const processedClonesKey = getSimulationProcessedClonesKey(simulationId);
    const batchProcessedClonesKey = getSimulationBatchProcessedClonesKey(simulationId, cloneBatchIndex);
    const progressStartedAtKey = getSimulationProgressStartedAtKey(simulationId);
    const batchStartedAtMs = Date.now();
    const progressStartedAtWasSet = await redis.setnx(progressStartedAtKey, String(batchStartedAtMs));
    await redis.expire(progressStartedAtKey, SIMULATION_PROGRESS_TTL_SECONDS);
    let progressStartedAtMs = batchStartedAtMs;
    if (progressStartedAtWasSet === 0) {
      const existingStartedAt = await redis.get(progressStartedAtKey);
      const parsedStartedAt = Number.parseInt(existingStartedAt || '', 10);
      if (Number.isFinite(parsedStartedAt)) {
        progressStartedAtMs = parsedStartedAt;
      }
    }

    // Fetch MasterPersona so psychology context flows into the LLM prompt
    const personaRow = await runQuerySingle<{
      psychologicalProfile: string | null;
      llmContextSummary: string | null;
    }>(
      `MATCH (p:Persona {id: $personaId})
       RETURN p.psychologicalProfile as psychologicalProfile,
              p.llmContextSummary as llmContextSummary`,
      { personaId }
    );
    const masterPersona = personaRow?.psychologicalProfile
      ? {
          psychologicalProfile: JSON.parse(personaRow.psychologicalProfile),
          llmContextSummary: personaRow.llmContextSummary ?? undefined,
          // Required MasterPersona fields — populated minimally since
          // ForkEvaluator only reads psychologicalProfile and llmContextSummary
          summary: '',
          behavioralFingerprint: {},
          dimensionScores: {},
          keyContradictions: [],
          dominantTraits: [],
          riskProfile: 'unknown' as const,
          timeHorizon: 'medium' as const,
          narrativeSummary: personaRow.llmContextSummary ?? '',
        }
      : undefined;

    const engine = new SimulationEngine(scenario, {
      useLLM: true,
      useChaos: true,
      maxLLMCalls: 20,
      logDecisions: false,
      rateLimiter,
      masterPersona,
    });

    const results: CloneResult[] = [];
    const limit = createConcurrencyLimiter(concurrency);
    const batchStart = Date.now();
    const initialProcessedClones = Number.parseInt(await redis.get(processedClonesKey) || '0', 10);
    {
      const progressSnapshot = createProgressSnapshot({
        status: 'running',
        phase: 'executing',
        phaseProgress: initialProcessedClones > 0
          ? Math.round((Math.min(initialProcessedClones, simulation.cloneCount) / simulation.cloneCount) * 100)
          : 0,
      });
      await publishSimulationProgress(redis, simulationId, {
        ...progressSnapshot,
        totalBatches,
        currentBatch: cloneBatchIndex,
        processedClones: initialProcessedClones,
        totalClones: simulation.cloneCount,
        batchProcessedClones: 0,
        batchCloneCount: clones.length,
      });
    }
    const batchLogInterval = Math.max(1, Math.ceil(clones.length / 4));
    let lastLoggedBatchProgress = 0;

    await Promise.all(
      clones.map((clone) =>
        limit(async () => {
          try {
            const result = await engine.executeClone(
              clone.cloneId,
              clone.parameters,
              clone.stratification
            );
            results.push(result);
          } catch (err) {
            logger.error({ err, cloneId: clone.cloneId }, 'Clone simulation failed');
          } finally {
            const [processedClones, batchProcessedClones] = await Promise.all([
              redis.incr(processedClonesKey),
              redis.incr(batchProcessedClonesKey),
            ]);

            await Promise.all([
              redis.expire(processedClonesKey, SIMULATION_PROGRESS_TTL_SECONDS),
              redis.expire(batchProcessedClonesKey, SIMULATION_PROGRESS_TTL_SECONDS),
            ]);

            const progressSnapshot = createProgressSnapshot({
              status: 'running',
              phase: 'executing',
              phaseProgress: Math.round((Math.min(processedClones, simulation.cloneCount) / simulation.cloneCount) * 100),
            });
            const estimatedTimeRemaining = estimateTimeRemainingSeconds(
              progressStartedAtMs,
              processedClones,
              simulation.cloneCount,
            );

            await publishSimulationProgress(redis, simulationId, {
              ...progressSnapshot,
              totalBatches,
              currentBatch: cloneBatchIndex,
              processedClones,
              totalClones: simulation.cloneCount,
              batchProcessedClones,
              batchCloneCount: clones.length,
              estimatedTimeRemaining,
            });

            if (
              batchProcessedClones === clones.length ||
              batchProcessedClones >= lastLoggedBatchProgress + batchLogInterval
            ) {
              lastLoggedBatchProgress = batchProcessedClones;
              logger.info({
                simulationId,
                batchIndex: cloneBatchIndex,
                batchProcessedClones,
                batchCloneCount: clones.length,
                processedClones,
                totalClones: simulation.cloneCount,
                progress: progressSnapshot.progress,
              }, 'Simulation batch progress');
            }
          }
        })
      )
    );

    const batchDuration = Date.now() - batchStart;
    logger.info({
      simulationId,
      batchIndex: cloneBatchIndex,
      cloneCount: clones.length,
      durationMs: batchDuration,
      avgPerClone: clones.length > 0 ? Math.round(batchDuration / clones.length) : 0,
      concurrency,
      rpm,
    }, 'Simulation batch complete');
    
    const processedClones = Number.parseInt(await redis.get(processedClonesKey) || '0', 10);
    if (processedClones >= simulation.cloneCount) {
      const persistStartSnapshot = createProgressSnapshot({
        status: 'running',
        phase: 'persisting',
        phaseProgress: calculatePersistingPhaseProgress(0, Math.max(1, results.length)),
      });
      await publishSimulationProgress(redis, simulationId, {
        ...persistStartSnapshot,
        totalBatches,
        currentBatch: cloneBatchIndex,
        processedClones,
        totalClones: simulation.cloneCount,
        batchProcessedClones: clones.length,
        batchCloneCount: clones.length,
      });
    }

    const persistenceStartedAt = Date.now();
    await persistCloneResultsBatch(simulationId, results);
    const persistenceDurationMs = Date.now() - persistenceStartedAt;
    const engineRuntimeTelemetry = engine.getRuntimeTelemetry();
    const batchRuntimeTelemetry: SimulationRuntimeTelemetry = {
      ...createEmptySimulationRuntimeTelemetry(),
      executionDurationMs: batchDuration,
      executionMaxBatchDurationMs: batchDuration,
      persistenceDurationMs,
      persistenceMaxBatchDurationMs: persistenceDurationMs,
      cloneCount: clones.length,
      batchCount: 1,
      cloneConcurrency: concurrency,
      decisionBatchSize: config.simulation.decisionBatchSize,
      decisionBatchFlushMs: config.simulation.decisionBatchFlushMs,
      llmRpmLimit: rpm,
      llm: engineRuntimeTelemetry.llm,
      embeddings: engineRuntimeTelemetry.embeddings,
      rateLimiter: engineRuntimeTelemetry.rateLimiter,
    };
    await storeSimulationBatchTelemetry(redis, simulationId, cloneBatchIndex, batchRuntimeTelemetry);

    if (processedClones >= simulation.cloneCount) {
      const persistCompleteSnapshot = createProgressSnapshot({
        status: 'running',
        phase: 'persisting',
        phaseProgress: calculatePersistingPhaseProgress(results.length, Math.max(1, results.length)),
      });
      await publishSimulationProgress(redis, simulationId, {
        ...persistCompleteSnapshot,
        totalBatches,
        currentBatch: cloneBatchIndex,
        processedClones,
        totalClones: simulation.cloneCount,
        batchProcessedClones: clones.length,
        batchCloneCount: clones.length,
      });
    }
    
    // Update progress using persisted batch completion, not enqueue order.
    const progressState = await runWriteSingle<{
      completedBatches: number;
      totalBatches: number;
      status: string;
      progress: number;
    }>(
      `MATCH (s:Simulation {id: $simulationId})
       SET s.completedBatches = coalesce(s.completedBatches, 0) + 1
       WITH s, s.completedBatches as completedBatches
       SET s.progress = CASE
             WHEN completedBatches >= $totalBatches THEN 99
             ELSE toInteger(round((toFloat(completedBatches) / $totalBatches) * 100))
           END,
           s.status = CASE
             WHEN completedBatches >= $totalBatches AND coalesce(s.status, 'pending') IN ['aggregating', 'completed', 'failed'] THEN s.status
             ELSE 'running'
           END
       RETURN s.completedBatches as completedBatches,
              $totalBatches as totalBatches,
              s.status as status,
              s.progress as progress`,
      { simulationId, totalBatches }
    );

    const completedBatches = progressState?.completedBatches ?? 0;
    const isFinalBatch = completedBatches >= totalBatches;

    // Publish real-time progress to Redis. For non-final batches publish now;
    // for the final batch we publish 'completed' only after results are stored
    // to avoid a race where the CLI reads 'completed' before results exist in Neo4j.
    if (!isFinalBatch) {
      const allClonesFinished = processedClones >= simulation.cloneCount;
      const progressSnapshot = allClonesFinished
        ? createProgressSnapshot({
            status: 'running',
            phase: 'persisting',
            phaseProgress: calculatePersistingPhaseProgress(completedBatches, totalBatches),
          })
        : createProgressSnapshot({
            status: 'running',
            phase: 'executing',
            phaseProgress: Math.round((Math.min(processedClones, simulation.cloneCount) / simulation.cloneCount) * 100),
          });
      await publishSimulationProgress(redis, simulationId, {
        ...progressSnapshot,
        completedBatches,
        totalBatches,
        currentBatch: cloneBatchIndex,
        processedClones,
        totalClones: simulation.cloneCount,
        batchProcessedClones: clones.length,
        batchCloneCount: clones.length,
        estimatedTimeRemaining: estimateTimeRemainingSeconds(
          progressStartedAtMs,
          processedClones,
          simulation.cloneCount,
        ),
      });
    }
    
    if (isFinalBatch) {
      const finalized = await runWriteSingle<{ id: string }>(
        `MATCH (s:Simulation {id: $simulationId})
         WHERE coalesce(s.status, 'pending') <> 'completed'
         SET s.status = 'aggregating'
         RETURN s.id as id`,
        { simulationId }
      );

      if (!finalized) {
        logger.info({ simulationId, cloneBatchIndex, completedBatches, totalBatches }, 'Simulation already finalized by another batch');
        return;
      }

      const aggregationStartedAt = Date.now();
      {
        const aggregationSnapshot = createProgressSnapshot({
          status: 'aggregating',
          phase: 'aggregating',
          phaseProgress: 0,
          aggregationStage: 'loading_results',
        });
        await publishSimulationProgress(redis, simulationId, {
          ...aggregationSnapshot,
          completedBatches,
          totalBatches,
          currentBatch: cloneBatchIndex,
          processedClones,
          totalClones: simulation.cloneCount,
          batchProcessedClones: clones.length,
          batchCloneCount: clones.length,
        });
      }

      // Aggregate all results
      const aggregator = createAggregator(scenarioType, scenario.decisionFrame);
      
      // Fetch all results for aggregation
      const allResults = await runQuery<{
        cloneId: string;
        metrics: string;
        finalState: string;
        category: string;
        percentile: number;
      }>(
        `MATCH (s:Simulation {id: $simulationId})-[:HAS_RESULT]->(cr:CloneResult)
         RETURN cr.cloneId as cloneId, cr.metrics as metrics, cr.finalState as finalState,
                cr.category as category, cr.percentile as percentile`,
        { simulationId }
      );

      {
        const aggregationSnapshot = createProgressSnapshot({
          status: 'aggregating',
          phase: 'aggregating',
          phaseProgress: 50,
          aggregationStage: 'reducing',
        });
        await publishSimulationProgress(redis, simulationId, {
          ...aggregationSnapshot,
          completedBatches,
          totalBatches,
          currentBatch: cloneBatchIndex,
          processedClones,
          totalClones: simulation.cloneCount,
          batchProcessedClones: clones.length,
          batchCloneCount: clones.length,
        });
      }
      
      // Convert to CloneResult format
      const aggregatedResults: CloneResult[] = allResults.map(r => ({
        cloneId: r.cloneId || 'unknown',
        parameters: {} as CloneParameters,
        stratification: {
          percentile: r.percentile || 50,
          category: (r.category as 'edge' | 'central' | 'typical') || 'typical',
        },
        path: [],
        finalState: JSON.parse(r.finalState as unknown as string),
        metrics: JSON.parse(r.metrics as unknown as string),
        duration: 0,
      }));
      
      aggregator.addResults(aggregatedResults);
      const finalResults = aggregator.aggregate();
      finalResults.appliedEvidence = acceptedEvidence;

      if (sourceSimulationId && acceptedEvidence.length > 0) {
        const sourceSimulation = await runQuerySingle<{ results: string | null }>(
          `MATCH (s:Simulation {id: $sourceSimulationId})
           RETURN s.results as results`,
          { sourceSimulationId }
        );

        if (sourceSimulation?.results) {
          const baselineResults = JSON.parse(sourceSimulation.results) as AggregatedResults;
          finalResults.rerunComparison = buildRerunComparison(
            sourceSimulationId,
            baselineResults,
            finalResults,
            acceptedEvidence,
          );
        }
      }

      if (typeof simulation.capitalAtRisk === 'number' && simulation.capitalAtRisk > 0) {
        const persona = await runQuerySingle<{ behavioralFingerprint: string | null }>(
          `MATCH (p:Persona {id: $personaId})
           RETURN p.behavioralFingerprint as behavioralFingerprint`,
          { personaId }
        );

        const fingerprint = persona?.behavioralFingerprint
          ? JSON.parse(persona.behavioralFingerprint)
          : {};
        const riskTolerance = typeof fingerprint.riskTolerance === 'number'
          ? fingerprint.riskTolerance
          : 0.5;

        finalResults.kelly = calculateKelly({
          results: finalResults,
          cloneResults: aggregatedResults,
          riskTolerance,
          capitalAtRisk: simulation.capitalAtRisk,
        });
      }

      const runtimeTelemetry = await loadSimulationRuntimeTelemetry(redis, simulationId, totalBatches);
      runtimeTelemetry.wallClockDurationMs = Math.max(0, Date.now() - progressStartedAtMs);
      runtimeTelemetry.aggregationDurationMs = Date.now() - aggregationStartedAt;
      runtimeTelemetry.cloneCount = simulation.cloneCount;
      runtimeTelemetry.batchCount = totalBatches;
      runtimeTelemetry.cloneConcurrency = Math.max(runtimeTelemetry.cloneConcurrency, concurrency);
      runtimeTelemetry.decisionBatchSize = Math.max(
        runtimeTelemetry.decisionBatchSize,
        config.simulation.decisionBatchSize,
      );
      runtimeTelemetry.decisionBatchFlushMs = Math.max(
        runtimeTelemetry.decisionBatchFlushMs,
        config.simulation.decisionBatchFlushMs,
      );
      runtimeTelemetry.llmRpmLimit = Math.max(runtimeTelemetry.llmRpmLimit, rpm);
      finalResults.runtimeTelemetry = runtimeTelemetry;

      {
        const aggregationSnapshot = createProgressSnapshot({
          status: 'aggregating',
          phase: 'aggregating',
          phaseProgress: 100,
          aggregationStage: 'writing_summary',
        });
        await publishSimulationProgress(redis, simulationId, {
          ...aggregationSnapshot,
          completedBatches,
          totalBatches,
          currentBatch: cloneBatchIndex,
          processedClones,
          totalClones: simulation.cloneCount,
          batchProcessedClones: clones.length,
          batchCloneCount: clones.length,
        });
      }
      
      // Store aggregated results
      await runWriteSingle(
        `MATCH (s:Simulation {id: $simulationId})
         SET s.status = 'completed',
             s.progress = 100,
             s.completedBatches = $totalBatches,
             s.results = $results,
             s.runtimeTelemetry = $runtimeTelemetry,
             s.completedAt = datetime()
         RETURN s.id as id`,
        {
          simulationId,
          totalBatches,
          results: JSON.stringify(finalResults),
          runtimeTelemetry: JSON.stringify(finalResults.runtimeTelemetry),
        }
      );
      
      // Now it's safe to mark as completed in Redis — results are in Neo4j
      await redis.setex(
        processedClonesKey,
        SIMULATION_PROGRESS_TTL_SECONDS,
        String(simulation.cloneCount),
      );
      await publishSimulationProgress(redis, simulationId, {
        ...createProgressSnapshot({
          status: 'completed',
          phase: 'completed',
          phaseProgress: 100,
        }),
        completedBatches: totalBatches,
        totalBatches,
        currentBatch: cloneBatchIndex,
        processedClones: simulation.cloneCount,
        totalClones: simulation.cloneCount,
        batchProcessedClones: clones.length,
        batchCloneCount: clones.length,
      });

      logger.info({
        simulationId,
        cloneCount: finalResults.cloneCount,
        successRate: finalResults.statistics.successRate,
        runtimeTelemetry: finalResults.runtimeTelemetry,
      }, 'Simulation completed');
    }
    
  } catch (err) {
    logger.error({ err, simulationId, jobId: job.id }, 'Simulation batch failed');

    // Mark simulation as failed
    await runWriteSingle(
      `MATCH (s:Simulation {id: $simulationId})
       SET s.status = 'failed', s.error = $error
       RETURN s.id as id`,
      { simulationId, error: (err as Error).message }
    );

    // Publish failure status to Redis
    try {
      const redis = await getRedisClient();
      const processedClones = Number.parseInt(
        await redis.get(getSimulationProcessedClonesKey(simulationId)) || '0',
        10,
      );
      const failureSnapshot = createProgressSnapshot({
        status: 'failed',
        phase: 'failed',
        phaseProgress: Math.round((Math.min(processedClones, Math.max(1, simulationCloneCount)) / Math.max(1, simulationCloneCount)) * 100),
      });
      await publishSimulationProgress(redis, simulationId, {
        ...failureSnapshot,
        processedClones,
        totalClones: simulationCloneCount,
        error: (err as Error).message,
      });
    } catch {
      // Ignore Redis errors during failure handling
    }

    throw err;
  }
}

let workers: Worker[] = [];

export function startWorkers(): void {
  workers = [
    createWorker<IngestionJobData>('ingestion', processIngestion),
    createWorker<PersonaJobData>('persona', processPersona),
    createWorker<SimulationJobData>('simulation', processSimulation),
  ];
  logger.info('Workers started');
}

export async function stopWorkers(): Promise<void> {
  for (const worker of workers) {
    await worker.close();
  }
  logger.info('Workers stopped');
}
