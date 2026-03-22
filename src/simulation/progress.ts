export function calculateSimulationProgress(
  processedClones: number,
  totalClones: number,
  status: string,
): number {
  if (status.toLowerCase() === 'completed') {
    return 100;
  }

  if (totalClones <= 0) {
    return 0;
  }

  const safeProcessedClones = Math.max(0, Math.min(processedClones, totalClones));
  const rawProgress = Math.round((safeProcessedClones / totalClones) * 100);
  return Math.min(99, rawProgress);
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
