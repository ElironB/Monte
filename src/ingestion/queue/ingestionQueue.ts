import { Queue, Worker, Job } from 'bullmq';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

export const INGESTION_QUEUE = 'ingestion';
export const PERSONA_QUEUE = 'persona';
export const SIMULATION_QUEUE = 'simulation';

export interface IngestionJobData {
  userId: string;
  sourceId: string;
  fileId: string;
}

export interface PersonaJobData {
  userId: string;
  personaId: string;
  version: number;
}

export interface SimulationJobData {
  simulationId: string;
  userId: string;
  personaId: string;
  scenarioType: string;
  cloneBatchIndex: number;
  totalBatches: number;
}

const getConnection = () => ({ url: config.redis.url });

export function getIngestionQueue(): Queue<IngestionJobData> {
  return new Queue<IngestionJobData>(INGESTION_QUEUE, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  });
}

export function getPersonaQueue(): Queue<PersonaJobData> {
  return new Queue<PersonaJobData>(PERSONA_QUEUE, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 10000 },
    },
  });
}

export function getSimulationQueue(): Queue<SimulationJobData> {
  return new Queue<SimulationJobData>(SIMULATION_QUEUE, {
    connection: getConnection(),
    defaultJobOptions: { attempts: 1 },
  });
}

export function createWorker<T>(queueName: string, processor: (job: Job<T>) => Promise<unknown>): Worker<T> {
  const concurrency = queueName === INGESTION_QUEUE
    ? config.ingestion.workerConcurrency
    : config.simulation.workerConcurrency;

  const worker = new Worker<T>(queueName, processor, {
    connection: getConnection(),
    concurrency,
  });
  worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Job completed'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Job failed'));
  return worker;
}

export async function closeQueues(): Promise<void> {
  logger.info('Queues closed');
}

export async function scheduleIngestionJob(data: IngestionJobData, delay?: number): Promise<Job<IngestionJobData>> {
  return getIngestionQueue().add('process-data-source', data, { delay });
}

export async function schedulePersonaBuild(data: PersonaJobData, delay?: number): Promise<Job<PersonaJobData>> {
  return getPersonaQueue().add('build-graph', data, { delay });
}

export async function scheduleSimulationBatch(data: SimulationJobData, priority?: number): Promise<Job<SimulationJobData>> {
  return getSimulationQueue().add('run-clone-batch', data, { priority });
}
