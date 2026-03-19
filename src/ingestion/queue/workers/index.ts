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
import { ContradictionDetector } from '../../contradictionDetector.js';
import { DimensionMapper } from '../../../persona/dimensionMapper.js';
import { GraphBuilder } from '../../../persona/graphBuilder.js';
import { PersonaCompressor } from '../../../persona/personaCompressor.js';
import { CloneGenerator, CloneParameters } from '../../../persona/cloneGenerator.js';
import { BehavioralSignal } from '../../types.js';

// Phase 4: Simulation Engine imports
import { getScenario } from '../../../simulation/decisionGraph.js';
import { SimulationEngine } from '../../../simulation/engine.js';
import { createAggregator } from '../../../simulation/resultAggregator.js';
import { CloneResult } from '../../../simulation/types.js';

const extractors = [
  new SearchHistoryExtractor(),
  new SocialBehaviorExtractor(),
  new FinancialBehaviorExtractor(),
  new CognitiveStructureExtractor(),
  new MediaConsumptionExtractor(),
];

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
    
    for (const signal of allSignals) {
      await runWriteSingle(
        `MATCH (d:DataSource {id: $sourceId})
         CREATE (s:Signal {
           id: $signalId,
           type: $type,
           value: $value,
           confidence: $confidence,
           evidence: $evidence,
           timestamp: datetime(),
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
          dimensions: JSON.stringify(signal.dimensions),
        }
      );
    }
    
    if (allSignals.length > 0) {
      const detector = new ContradictionDetector(allSignals);
      const contradictions = detector.detect();
      
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
  
  // Get all signals for this user
  const signals = await runQuery<BehavioralSignal>(
    `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource)-[:HAS_SIGNAL]->(s:Signal)
     WHERE d.status = 'completed'
     RETURN s.id as id, s.type as type, s.value as value, s.confidence as confidence,
            s.evidence as evidence, s.timestamp as timestamp, s.dimensions as dimensions`,
    { userId }
  );
  
  const signalIds = signals.map(s => s.id);
  
  logger.info({ personaId, signalCount: signals.length }, 'Building persona from signals');
  
  // Map to dimensions
  const mapper = new DimensionMapper(signals);
  const dimensions = mapper.mapToDimensions();
  
  // Build Neo4j graph
  const graphBuilder = new GraphBuilder(userId, personaId);
  await graphBuilder.buildPersonaGraph(dimensions, signalIds);
  
  // Get stored traits for compression
  const { traits, memories } = await graphBuilder.getPersonaGraph();
  
  // Compress to Master Persona
  const compressor = new PersonaCompressor(traits, memories);
  const masterPersona = compressor.compress();
  
  // Store master persona summary
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
      signalCount: signals.length,
    }
  );
  
  // Generate 1,000 clones
  const cloneGen = new CloneGenerator(masterPersona, personaId);
  const clones = cloneGen.generateClones(1000);
  
  // Store clones in batches
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
     SET p.cloneCount = $cloneCount, p.updatedAt = datetime()
     RETURN p.id as id`,
    { personaId, cloneCount: clones.length }
  );
  
  logger.info({ personaId, signalCount: signals.length, cloneCount: clones.length }, 'Persona build complete');
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
    }>(
      `MATCH (s:Simulation {id: $simulationId})
       RETURN s.name as name, s.parameters as parameters, s.cloneCount as cloneCount`,
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
    
    // Create simulation engine
    const engine = new SimulationEngine(scenario, {
      useLLM: true,
      useChaos: true,
      maxAnthropicCalls: 20,
      logDecisions: false,
    });
    
    // Execute clones
    const results: CloneResult[] = [];
    for (const clone of clones) {
      try {
        const result = await engine.executeClone(
          clone.cloneId,
          clone.parameters,
          clone.stratification
        );
        results.push(result);
      } catch (err) {
        logger.error({ err, cloneId: clone.cloneId }, 'Clone simulation failed');
        // Continue with other clones
      }
    }
    
    // Store clone results in Neo4j
    for (const result of results) {
      await runWriteSingle(
        `MATCH (s:Simulation {id: $simulationId})
         CREATE (cr:CloneResult {
           id: $resultId,
           cloneId: $cloneId,
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
        metrics: string;
        finalState: string;
        category: string;
        percentile: number;
      }>(
        `MATCH (s:Simulation {id: $simulationId})-[:HAS_RESULT]->(cr:CloneResult)
         RETURN cr.metrics as metrics, cr.finalState as finalState,
                cr.category as category, cr.percentile as percentile`,
        { simulationId }
      );
      
      // Convert to CloneResult format
      const aggregatedResults: CloneResult[] = allResults.map(r => ({
        cloneId: 'aggregate',
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
          results: JSON.stringify({
            histograms: finalResults.histograms,
            outcomeDistribution: finalResults.outcomeDistribution,
            statistics: finalResults.statistics,
            stratifiedBreakdown: finalResults.stratifiedBreakdown,
          }),
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
