import { describe, expect, test } from 'vitest';
import {
  calculateExecutionPhaseProgress,
  calculateOverallProgress,
  calculatePersistingPhaseProgress,
  calculateSimulationProgress,
  createProgressSnapshot,
  estimateTimeRemainingSeconds,
} from '../src/simulation/progress.js';
import { buildProgressResponse } from '../src/api/routes/stream.js';

describe('simulation progress helpers', () => {
  test('weights execution progress to 90 percent before persistence and aggregation', () => {
    expect(calculateExecutionPhaseProgress(50, 100)).toBe(50);
    expect(calculateOverallProgress('executing', 50)).toBe(45);
    expect(calculateSimulationProgress(1_000, 1_000, 'running')).toBe(90);
    expect(calculateSimulationProgress(1_000, 1_000, 'aggregating')).toBe(99);
    expect(calculateSimulationProgress(1_000, 1_000, 'completed')).toBe(100);
  });

  test('creates phase-aware snapshots for persistence and aggregation', () => {
    expect(calculatePersistingPhaseProgress(25, 100)).toBe(25);
    expect(calculateOverallProgress('persisting', 50)).toBe(93);

    expect(createProgressSnapshot({
      status: 'running',
      phase: 'persisting',
      phaseProgress: 100,
    })).toMatchObject({
      status: 'running',
      phase: 'persisting',
      phaseProgress: 100,
      progress: 96,
    });

    expect(createProgressSnapshot({
      status: 'aggregating',
      phase: 'aggregating',
      phaseProgress: 50,
      aggregationStage: 'reducing',
    })).toMatchObject({
      status: 'aggregating',
      phase: 'aggregating',
      phaseProgress: 50,
      aggregationStage: 'reducing',
      progress: 98,
    });
  });

  test('maps aggregation stages to stable final progress markers', () => {
    expect(calculateOverallProgress('aggregating', 0, 'loading_results')).toBe(97);
    expect(calculateOverallProgress('aggregating', 50, 'reducing')).toBe(98);
    expect(calculateOverallProgress('aggregating', 100, 'writing_summary')).toBe(99);
  });

  test('persisting progress stays ahead of executing once all clone batches are done', () => {
    const executingComplete = calculateOverallProgress('executing', 100);
    const persistingNearlyDone = calculateOverallProgress('persisting', 75);

    expect(executingComplete).toBe(90);
    expect(persistingNearlyDone).toBeGreaterThan(executingComplete);
  });

  test('estimates remaining seconds from observed clone throughput', () => {
    expect(estimateTimeRemainingSeconds(1_000, 40, 100, 21_000)).toBe(30);
  });

  test('builds a phase-aware progress response from live payloads', () => {
    const response = buildProgressResponse({
      simulationId: 'sim-123',
      simulation: {
        status: 'running',
        progress: 42,
        completedBatches: 1,
        cloneCount: 200,
      },
      parsed: {
        status: 'running',
        phase: 'persisting',
        phaseProgress: 100,
        aggregationStage: 'writing_summary',
        progress: 96,
        completedBatches: 1,
        currentBatch: 1,
        batchProcessedClones: 100,
        batchCloneCount: 100,
      },
      processedClones: 200,
    });

    expect(response).toMatchObject({
      simulationId: 'sim-123',
      status: 'running',
      phase: 'persisting',
      phaseProgress: 100,
      progress: 96,
      cloneCount: 200,
      processedClones: 200,
      currentBatch: 1,
      batchProcessedClones: 100,
      batchCloneCount: 100,
    });
  });

  test('falls back to stored simulation progress when Redis is unavailable', () => {
    const response = buildProgressResponse({
      simulationId: 'sim-456',
      simulation: {
        status: 'running',
        progress: 64,
        completedBatches: 3,
        cloneCount: 500,
      },
      parsed: null,
    });

    expect(response).toMatchObject({
      simulationId: 'sim-456',
      status: 'running',
      phase: 'executing',
      progress: 64,
      phaseProgress: undefined,
      completedBatches: 3,
      cloneCount: 500,
      processedClones: 0,
    });
  });
});
