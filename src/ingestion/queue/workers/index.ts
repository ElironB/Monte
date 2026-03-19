import { Job } from 'bullmq';
import type { Worker } from 'bullmq';
import { createWorker, IngestionJobData, PersonaJobData, SimulationJobData } from '../ingestionQueue.js';
import { logger } from '../../../utils/logger.js';
import { runQuerySingle, runWriteSingle } from '../../../config/neo4j.js';
import { getFile } from '../../../config/minio.js';
import { SearchHistoryExtractor } from '../../extractors/searchHistory.js';
import { SocialBehaviorExtractor } from '../../extractors/socialBehavior.js';
import { FinancialBehaviorExtractor } from '../../extractors/financialBehavior.js';
import { CognitiveStructureExtractor } from '../../extractors/cognitiveStructure.js';
import { MediaConsumptionExtractor } from '../../extractors/mediaConsumption.js';
import { ContradictionDetector } from '../../contradictionDetector.js';
import { BehavioralSignal } from '../../types.js';

const extractors = [
  new SearchHistoryExtractor(),
  new SocialBehaviorExtractor(),
  new FinancialBehaviorExtractor(),
  new CognitiveStructureExtractor(),
  new MediaConsumptionExtractor(),
];

async function processIngestion(job: Job<IngestionJobData>): Promise<void> {
  logger.info({ jobId: job.id, data: job.data }, 'Processing ingestion job');
  
  const { userId, sourceId, sourceType, filePath, metadata } = job.data;
  
  // Update status to processing
  await runWriteSingle(
    `MATCH (d:DataSource {id: $sourceId})
     SET d.status = 'processing', d.processedAt = datetime()
     RETURN d.id as id`,
    { sourceId }
  );
  
  try {
    // Get raw content
    let rawContent = '';
    if (filePath) {
      const buffer = await getFile(filePath);
      rawContent = buffer.toString('utf-8');
    } else if (metadata?.content) {
      rawContent = metadata.content as string;
    }
    
    // Extract signals
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
    
    // Store signals
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
    
    // Detect contradictions if we have signals
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
    
    // Mark complete
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
  logger.info({ jobId: job.id, data: job.data }, 'Processing persona job');
  
  const { userId, personaId } = job.data;
  
  // Aggregate all signals for this user
  const signals = await runQuerySingle<{ count: number }>(
    `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource)-[:HAS_SIGNAL]->(s:Signal)
     WHERE d.status = 'completed'
     RETURN count(s) as count`,
    { userId }
  );
  
  // Build persona from signals (placeholder for Phase 3)
  logger.info({ personaId, signalCount: signals?.count || 0 }, 'Building persona');
  
  // Update persona status
  await runWriteSingle(
    `MATCH (p:Persona {id: $personaId})
     SET p.buildStatus = 'ready', p.signalCount = $signalCount, p.updatedAt = datetime()
     RETURN p.id as id`,
    { personaId, signalCount: signals?.count || 0 }
  );
}

async function processSimulation(job: Job<SimulationJobData>): Promise<void> {
  logger.info({ jobId: job.id, data: job.data }, 'Processing simulation batch');
  
  // Placeholder for Phase 4 simulation engine
  const { simulationId, cloneBatchIndex, totalBatches } = job.data;
  
  // Update simulation progress
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
