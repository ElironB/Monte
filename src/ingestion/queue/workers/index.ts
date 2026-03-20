import { Job } from 'bullmq';
import type { Worker } from 'bullmq';
import { createWorker, IngestionJobData, PersonaJobData, SimulationJobData } from '../ingestionQueue.js';
import { logger } from '../../../utils/logger.js';
import { runQuerySingle, runWriteSingle, runQuery } from '../../../config/neo4j.js';
import { getFile } from '../../../config/minio.js';
import { getRedisClient } from '../../../config/redis.js';
import { SearchHistoryExtractor } from '../../extractors/searchHistory.js';
import { SocialBehaviorExtractor } from '../../extractors/socialBehavior.js';
import { FinancialBehaviorExtractor } from '../../extractors/financialBehavior.js';
import { CognitiveStructureExtractor } from '../../extractors/cognitiveStructure.js';
import { MediaConsumptionExtractor } from '../../extractors/mediaConsumption.js';
import { SemanticExtractor } from '../../extractors/semanticExtractor.js';
import { ContradictionDetector } from '../../contradictionDetector.js';
import { DimensionMapper } from '../../../persona/dimensionMapper.js';
import { GraphBuilder } from '../../../persona/graphBuilder.js';
import { PersonaCompressor } from '../../../persona/personaCompressor.js';
import { CloneGenerator, CloneParameters } from '../../../persona/cloneGenerator.js';
import { BayesianUpdater } from '../../../persona/bayesianUpdater.js';
import { EmbeddingService } from '../../../embeddings/embeddingService.js';
import { getDimensionConceptEmbeddings } from '../../../embeddings/dimensionConcepts.js';
import { BehavioralSignal } from '../../types.js';

// Phase 4: Simulation Engine imports
import { getScenario } from '../../../simulation/decisionGraph.js';
import { SimulationEngine } from '../../../simulation/engine.js';
import { createAggregator } from '../../../simulation/resultAggregator.js';
import { CloneResult } from '../../../simulation/types.js';
import { calculateKelly } from '../../../simulation/kellyCalculator.js';
import { RateLimiter, createConcurrencyLimiter, detectProviderRPM } from '../../../utils/rateLimiter.js';

const extractors = [
  new SearchHistoryExtractor(),
  new SocialBehaviorExtractor(),
  new FinancialBehaviorExtractor(),
  new CognitiveStructureExtractor(),
  new MediaConsumptionExtractor(),
];

const semanticExtractor = new SemanticExtractor();

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
          extractor.sourceTypes.some(st => sourceType.includes(st))) {
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
        const signalTexts = allSignals.map(signal => `${signal.type}: ${signal.value} — ${signal.evidence}`);
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

        logger.info({ sourceId, embeddedCount: allSignals.length }, 'Signal embeddings stored');
      } catch (err) {
        signalEmbeddings = new Map();
        logger.warn({ err, sourceId }, 'Failed to embed signals — dimension mapping will use fallback');
      }
    }
    
    if (allSignals.length > 0) {
      const detector = new ContradictionDetector(allSignals, signalEmbeddings);
      const contradictions = await detector.detect();
      
      for (const contradiction of contradictions) {
        await runWriteSingle(
          `CREATE (c:Contradiction {
            id: $id,
            type: $type,
            description: $description,
            severity: $severity,
            createdAt: datetime()
          })
          WITH c
          MATCH (s1:Signal {id: $signalAId}), (s2:Signal {id: $signalBId})
          CREATE (s1)-[:CONTRADICTS]->(c)<-[:CONTRADICTS]-(s2)
          RETURN c.id as id`,
          {
            id: contradiction.id,
            type: contradiction.type,
            description: contradiction.description,
            severity: contradiction.severity,
            signalAId: contradiction.signalAId,
            signalBId: contradiction.signalBId,
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

  const previousPersona = await runQuerySingle<{ id: string; version: number | { toNumber: () => number } }>(
    `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)
     WHERE p.buildStatus = 'ready' AND p.id <> $personaId
     RETURN p.id as id, p.version as version
     ORDER BY p.version DESC
     LIMIT 1`,
    { userId, personaId }
  );

  if (previousPersona) {
    await processIncrementalUpdate(userId, personaId, previousPersona.id);
    return;
  }

  await processFullBuild(userId, personaId);
}

interface StoredSignalRecord {
  id: string;
  type: BehavioralSignal['type'];
  value: string;
  confidence: number;
  evidence: string;
  timestamp: string;
  dimensions: string | BehavioralSignal['dimensions'] | null;
}

async function processFullBuild(userId: string, personaId: string): Promise<void> {
  ensureEmbeddingsConfigured();

  const signals = await fetchSignals(userId);
  const signalIds = signals.map(signal => signal.id);
  const signalEmbeddings = await fetchSignalEmbeddings(signalIds);
  const conceptEmbeddings = await getDimensionConceptEmbeddings();

  logger.info({ personaId, signalCount: signals.length }, 'Building persona from all signals');

  const mapper = new DimensionMapper(signals, conceptEmbeddings, signalEmbeddings);
  const dimensions = mapper.mapToDimensions();

  const graphBuilder = new GraphBuilder(userId, personaId);
  await graphBuilder.buildPersonaGraph(dimensions, signalIds);

  const { traits, memories } = await graphBuilder.getPersonaGraph();
  const compressor = new PersonaCompressor(traits, memories);
  const masterPersona = compressor.compress();

  await storeMasterPersona(personaId, masterPersona, signals.length);
  await regenerateClones(personaId, masterPersona);

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
    const mapper = new DimensionMapper(newSignals, conceptEmbeddings, signalEmbeddings);
    const newDimensions = mapper.mapToDimensions();
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
  await regenerateClones(personaId, masterPersona);

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
      signalCount,
    }
  );
}

async function regenerateClones(
  personaId: string,
  masterPersona: ReturnType<PersonaCompressor['compress']>
): Promise<void> {
  await runWriteSingle(
    `MATCH (p:Persona {id: $personaId})-[:HAS_CLONE]->(c:Clone)
     WITH collect(c) as clones
     FOREACH (clone IN clones | DETACH DELETE clone)
     RETURN size(clones) as deleted`,
    { personaId }
  );

  const cloneGen = new CloneGenerator(masterPersona, personaId);
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
    
    // Get scenario
    const scenario = getScenario(scenarioType);
    
    // Calculate batch size (100 clones per batch by default)
    const batchSize = 100;
    const startIndex = cloneBatchIndex * batchSize;
    const endIndex = Math.min(startIndex + batchSize, simulation.cloneCount);
    
    // Fetch clones for this batch
    const cloneData = await runQuery<CloneData>(
      `MATCH (p:Persona {id: $personaId})-[:HAS_CLONE]->(c:Clone)
       WITH c
       ORDER BY c.id
       SKIP $skip
       LIMIT $limit
       RETURN c.id as id, c.parameters as parameters, c.percentile as percentile, c.category as category`,
      { personaId, skip: startIndex, limit: endIndex - startIndex }
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

    const configuredRPM = Number.parseInt(process.env.LLM_RPM_LIMIT || '', 10);
    const rpm = configuredRPM > 0 ? configuredRPM : detectProviderRPM();
    const configuredConcurrency = Number.parseInt(process.env.SIMULATION_CONCURRENCY || '', 10);
    const concurrency = configuredConcurrency > 0 ? configuredConcurrency : 10;
    const rateLimiter = new RateLimiter(rpm);

    const engine = new SimulationEngine(scenario, {
      useLLM: true,
      useChaos: true,
      maxLLMCalls: 20,
      logDecisions: false,
      rateLimiter,
    });

    const results: CloneResult[] = [];
    const limit = createConcurrencyLimiter(concurrency);
    const batchStart = Date.now();

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
    
    // Store clone results in Neo4j
    for (const result of results) {
      await runWriteSingle(
        `MATCH (s:Simulation {id: $simulationId})
         CREATE (cr:CloneResult {
           id: $resultId,
           cloneId: $cloneId,
           percentile: $percentile,
           category: $category,
           path: $path,
           finalState: $finalState,
           metrics: $metrics,
           duration: $duration,
           createdAt: datetime()
         })
         CREATE (s)-[:HAS_RESULT]->(cr)
         RETURN cr.id as id`,
        {
          simulationId,
          resultId: result.cloneId,
          cloneId: result.cloneId,
          percentile: result.stratification.percentile,
          category: result.stratification.category,
          path: JSON.stringify(result.path),
          finalState: JSON.stringify(result.finalState),
          metrics: JSON.stringify(result.metrics),
          duration: result.duration,
        }
      );
    }
    
    // Update progress
    const progress = Math.round(((cloneBatchIndex + 1) / totalBatches) * 100);
    const completedBatches = cloneBatchIndex + 1;

    // Publish real-time progress to Redis for SSE streaming
    const redis = await getRedisClient();
    await redis.setex(
      `sim:${simulationId}:progress`,
      300, // 5 minute TTL
      JSON.stringify({
        simulationId,
        progress,
        completedBatches,
        totalBatches,
        currentBatch: cloneBatchIndex,
        processedClones: results.length,
        status: cloneBatchIndex === totalBatches - 1 ? 'completed' : 'running',
        lastUpdated: new Date().toISOString(),
      })
    );

    // Check if this is the final batch
    const isFinalBatch = cloneBatchIndex === totalBatches - 1;
    
    if (isFinalBatch) {
      // Aggregate all results
      const aggregator = createAggregator(scenarioType);
      
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
      
      // Store aggregated results
      await runWriteSingle(
        `MATCH (s:Simulation {id: $simulationId})
         SET s.status = 'completed',
             s.progress = 100,
             s.completedBatches = $totalBatches,
             s.results = $results,
             s.completedAt = datetime()
         RETURN s.id as id`,
        {
          simulationId,
          totalBatches,
          results: JSON.stringify(finalResults),
        }
      );
      
      logger.info({ 
        simulationId, 
        cloneCount: finalResults.cloneCount,
        successRate: finalResults.statistics.successRate,
        llmUsage: engine.getLLMUsage(),
      }, 'Simulation completed');
    } else {
      // Update progress only
      await runWriteSingle(
        `MATCH (s:Simulation {id: $simulationId})
         SET s.progress = $progress, s.completedBatches = $completedBatches
         RETURN s.id as id`,
        { simulationId, progress, completedBatches: cloneBatchIndex + 1 }
      );
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
      await redis.setex(
        `sim:${simulationId}:progress`,
        300,
        JSON.stringify({
          simulationId,
          progress: 0,
          status: 'failed',
          error: (err as Error).message,
          lastUpdated: new Date().toISOString(),
        })
      );
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
