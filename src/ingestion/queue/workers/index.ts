import { Job } from 'bullmq';
import type { Worker } from 'bullmq';
import { createWorker, IngestionJobData, PersonaJobData, SimulationJobData } from '../ingestionQueue.js';
import { logger } from '../../../utils/logger.js';
import { runQuerySingle, runWriteSingle, runQuery } from '../../../config/neo4j.js';
import { getFile } from '../../../config/minio.js';
import { SearchHistoryExtractor } from '../../extractors/searchHistory.js';
import { SocialBehaviorExtractor } from '../../extractors/socialBehavior.js';
import { FinancialBehaviorExtractor } from '../../extractors/financialBehavior.js';
import { CognitiveStructureExtractor } from '../../extractors/cognitiveStructure.js';
import { MediaConsumptionExtractor } from '../../extractors/mediaConsumption.js';
import { ContradictionDetector } from '../../contradictionDetector.js';
import { DimensionMapper } from '../../../persona/dimensionMapper.js';
import { GraphBuilder } from '../../../persona/graphBuilder.js';
import { PersonaCompressor } from '../../../persona/personaCompressor.js';
import { CloneGenerator } from '../../../persona/cloneGenerator.js';
import { BehavioralSignal } from '../../types.js';

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

async function processSimulation(job: Job<SimulationJobData>): Promise<void> {
  logger.info({ jobId: job.id, data: job.data }, 'Processing simulation batch');
  
  const { simulationId, cloneBatchIndex, totalBatches } = job.data;
  
  const progress = Math.round(((cloneBatchIndex + 1) / totalBatches) * 100);
  
  await runWriteSingle(
    `MATCH (s:Simulation {id: $simulationId})
     SET s.progress = $progress, s.completedBatches = $completedBatches
     RETURN s.id as id`,
    { simulationId, progress, completedBatches: cloneBatchIndex + 1 }
  );
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
