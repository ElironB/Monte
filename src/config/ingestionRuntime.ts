import { parsePositiveIntEnv } from './simulationRuntime.js';

export interface IngestionRuntimeConfig {
  workerConcurrency: number;
}

export function resolveIngestionRuntimeConfig(nodeEnv: string = process.env.NODE_ENV || 'development'): IngestionRuntimeConfig {
  return {
    workerConcurrency: parsePositiveIntEnv(process.env.INGESTION_WORKER_CONCURRENCY)
      || (nodeEnv === 'production' ? 10 : 3),
  };
}
