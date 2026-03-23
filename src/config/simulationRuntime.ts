export interface SimulationRuntimeConfig {
  batchSize: number;
  cloneConcurrency: number;
  workerConcurrency: number;
  llmRpmLimit?: number;
}

export function parsePositiveIntEnv(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

export function resolveSimulationRuntimeConfig(nodeEnv: string = process.env.NODE_ENV || 'development'): SimulationRuntimeConfig {
  return {
    batchSize: parsePositiveIntEnv(process.env.SIMULATION_BATCH_SIZE) || 100,
    cloneConcurrency: parsePositiveIntEnv(process.env.SIMULATION_CONCURRENCY) || 10,
    workerConcurrency: parsePositiveIntEnv(process.env.SIMULATION_WORKER_CONCURRENCY)
      || (nodeEnv === 'production' ? 20 : 5),
    llmRpmLimit: parsePositiveIntEnv(process.env.LLM_RPM_LIMIT),
  };
}
