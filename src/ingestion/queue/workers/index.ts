import { Job } from 'bullmq';
import { createWorker, IngestionJobData, PersonaJobData, SimulationJobData } from '../ingestionQueue.js';
import { logger } from '../../../utils/logger.js';

async function processIngestion(job: Job<IngestionJobData>): Promise<void> {
  logger.info({ jobId: job.id }, 'Processing ingestion');
}

async function processPersona(job: Job<PersonaJobData>): Promise<void> {
  logger.info({ jobId: job.id }, 'Processing persona');
}

async function processSimulation(job: Job<SimulationJobData>): Promise<void> {
  logger.info({ jobId: job.id }, 'Processing simulation batch');
}

import type { Worker } from 'bullmq';

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
