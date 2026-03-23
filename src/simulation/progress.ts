export type SimulationProgressPhase =
  | 'queued'
  | 'executing'
  | 'persisting'
  | 'aggregating'
  | 'completed'
  | 'failed';

export type SimulationAggregationStage =
  | 'loading_results'
  | 'reducing'
  | 'writing_summary';

export interface SimulationProgressSnapshot {
  status: string;
  phase: SimulationProgressPhase;
  phaseProgress: number;
  progress: number;
  aggregationStage?: SimulationAggregationStage;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function asSimulationProgressPhase(value: unknown): SimulationProgressPhase | undefined {
  switch (value) {
    case 'queued':
    case 'executing':
    case 'persisting':
    case 'aggregating':
    case 'completed':
    case 'failed':
      return value;
    default:
      return undefined;
  }
}

export function asSimulationAggregationStage(value: unknown): SimulationAggregationStage | undefined {
  switch (value) {
    case 'loading_results':
    case 'reducing':
    case 'writing_summary':
      return value;
    default:
      return undefined;
  }
}

export function deriveSimulationPhase(status: string): SimulationProgressPhase {
  switch (status.toLowerCase()) {
    case 'pending':
      return 'queued';
    case 'aggregating':
      return 'aggregating';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'running':
    default:
      return 'executing';
  }
}

export function calculateExecutionPhaseProgress(
  processedClones: number,
  totalClones: number,
): number {
  if (totalClones <= 0) {
    return 0;
  }

  const safeProcessedClones = Math.max(0, Math.min(processedClones, totalClones));
  return clampPercent((safeProcessedClones / totalClones) * 100);
}

export function calculateExecutionPhaseProgressFromFrontier(options: {
  processedClones: number;
  totalClones: number;
  resolvedDecisions: number;
  waitingDecisions: number;
  estimatedDecisionCount: number;
}): number {
  const cloneProgress = calculateExecutionPhaseProgress(
    options.processedClones,
    options.totalClones,
  );

  if (options.estimatedDecisionCount <= 0) {
    return cloneProgress;
  }

  const effectiveDecisionProgress = clampPercent(
    ((Math.max(0, options.resolvedDecisions) + (Math.max(0, options.waitingDecisions) * 0.5))
      / options.estimatedDecisionCount) * 100,
  );

  return Math.max(cloneProgress, effectiveDecisionProgress);
}

export function calculatePersistingPhaseProgress(
  persistedCloneResults: number,
  batchCloneCount: number,
): number {
  if (batchCloneCount <= 0) {
    return 0;
  }

  const safePersistedCloneResults = Math.max(0, Math.min(persistedCloneResults, batchCloneCount));
  return clampPercent((safePersistedCloneResults / batchCloneCount) * 100);
}

export function calculateOverallProgress(
  phase: SimulationProgressPhase,
  phaseProgress: number,
  aggregationStage?: SimulationAggregationStage,
): number {
  const safePhaseProgress = clampPercent(phaseProgress);

  switch (phase) {
    case 'queued':
      return 0;
    case 'executing':
      return Math.min(90, Math.round((safePhaseProgress / 100) * 90));
    case 'persisting':
      return Math.min(96, 90 + Math.round((safePhaseProgress / 100) * 6));
    case 'aggregating':
      switch (aggregationStage) {
        case 'reducing':
          return 98;
        case 'writing_summary':
          return 99;
        case 'loading_results':
        default:
          return 97;
      }
    case 'completed':
      return 100;
    case 'failed':
      return Math.min(99, safePhaseProgress);
  }
}

export function calculateSimulationProgress(
  processedClones: number,
  totalClones: number,
  status: string,
): number {
  const phase = deriveSimulationPhase(status);

  if (phase === 'completed') {
    return 100;
  }

  if (phase === 'aggregating') {
    return 99;
  }

  if (phase === 'failed') {
    return calculateOverallProgress(
      'failed',
      calculateExecutionPhaseProgress(processedClones, totalClones),
    );
  }

  return calculateOverallProgress(
    'executing',
    calculateExecutionPhaseProgress(processedClones, totalClones),
  );
}

export function createProgressSnapshot(options: {
  status?: string;
  phase: SimulationProgressPhase;
  phaseProgress: number;
  aggregationStage?: SimulationAggregationStage;
}): SimulationProgressSnapshot {
  const status = options.status ?? (options.phase === 'queued' ? 'pending' : options.phase);
  const phaseProgress = clampPercent(options.phaseProgress);

  return {
    status,
    phase: options.phase,
    phaseProgress,
    progress: calculateOverallProgress(options.phase, phaseProgress, options.aggregationStage),
    aggregationStage: options.aggregationStage,
  };
}

export function estimateTimeRemainingSeconds(
  startedAtMs: number,
  processedClones: number,
  totalClones: number,
  nowMs: number = Date.now(),
): number | undefined {
  if (processedClones <= 0 || totalClones <= 0 || processedClones >= totalClones) {
    return undefined;
  }

  const elapsedMs = nowMs - startedAtMs;
  if (elapsedMs <= 0) {
    return undefined;
  }

  const avgMsPerClone = elapsedMs / processedClones;
  const remainingClones = totalClones - processedClones;
  return Math.max(1, Math.round((avgMsPerClone * remainingClones) / 1000));
}
