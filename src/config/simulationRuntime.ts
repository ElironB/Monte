export interface SimulationRuntimeConfig {
  batchSize: number;
  decisionConcurrency: number;
  activeFrontier: number;
  cloneConcurrency: number;
  workerConcurrency: number;
  decisionBatchSize: number;
  decisionBatchFlushMs: number;
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
  const batchSize = parsePositiveIntEnv(process.env.SIMULATION_BATCH_SIZE) || 100;
  const decisionConcurrency =
    parsePositiveIntEnv(process.env.SIMULATION_DECISION_CONCURRENCY)
    || parsePositiveIntEnv(process.env.SIMULATION_CONCURRENCY)
    || 10;

  return {
    batchSize,
    decisionConcurrency,
    activeFrontier: parsePositiveIntEnv(process.env.SIMULATION_ACTIVE_FRONTIER) || batchSize,
    cloneConcurrency: decisionConcurrency,
    workerConcurrency: parsePositiveIntEnv(process.env.SIMULATION_WORKER_CONCURRENCY)
      || (nodeEnv === 'production' ? 20 : 5),
    decisionBatchSize: parsePositiveIntEnv(process.env.SIMULATION_DECISION_BATCH_SIZE) || 20,
    decisionBatchFlushMs: parsePositiveIntEnv(process.env.SIMULATION_DECISION_BATCH_FLUSH_MS) || 40,
    llmRpmLimit: parsePositiveIntEnv(process.env.LLM_RPM_LIMIT),
  };
}
