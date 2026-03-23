import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { CloneResult } from '../src/simulation/types.js';

const { runWriteSingleMock } = vi.hoisted(() => ({
  runWriteSingleMock: vi.fn(),
}));

vi.mock('../src/config/neo4j.js', () => ({
  runWriteSingle: runWriteSingleMock,
}));

import { createCloneResultBatchRows, persistCloneResultsBatch } from '../src/simulation/resultPersistence.js';

function makeCloneResult(cloneId: string): CloneResult {
  return {
    cloneId,
    parameters: {
      riskTolerance: 0.5,
      timePreference: 0.5,
      socialDependency: 0.5,
      learningStyle: 0.5,
      decisionSpeed: 0.5,
      emotionalVolatility: 0.5,
      executionGap: 0.5,
      informationSeeking: 0.5,
      stressResponse: 0.5,
    },
    stratification: {
      percentile: 50,
      category: 'typical',
    },
    path: ['start', 'decision', 'outcome'],
    finalState: {
      capital: 10000,
      health: 0.8,
      happiness: 0.7,
      timeElapsed: 12,
      decisions: [],
      events: [],
      metrics: {
        runway: 6,
      },
      beliefState: {
        thesisConfidence: 0.6,
        uncertaintyLevel: 0.4,
        evidenceClarity: 0.5,
        reversibilityConfidence: 0.6,
        commitmentLockIn: 0.4,
        socialPressureLoad: 0.3,
        downsideSalience: 0.4,
        learningVelocity: 0.6,
        latestSignal: 'neutral',
        updateNarrative: 'steady',
      },
      causalState: {
        demandStrength: 0.6,
        executionCapacity: 0.7,
        runwayStress: 0.3,
        marketTailwind: 0.5,
        socialLegitimacy: 0.4,
        reversibilityPressure: 0.2,
        evidenceMomentum: 0.5,
      },
      outcome: 'success',
    },
    metrics: {
      capital: 10000,
      happiness: 0.7,
    },
    duration: 1234,
  };
}

describe('result persistence', () => {
  beforeEach(() => {
    runWriteSingleMock.mockReset();
    runWriteSingleMock.mockResolvedValue({ storedCount: 2 });
  });

  test('serializes clone results into Neo4j batch rows', () => {
    const rows = createCloneResultBatchRows([makeCloneResult('clone-1')]);

    expect(rows).toEqual([
      expect.objectContaining({
        resultId: 'clone-1',
        cloneId: 'clone-1',
        percentile: 50,
        category: 'typical',
        path: JSON.stringify(['start', 'decision', 'outcome']),
        metrics: JSON.stringify({
          capital: 10000,
          happiness: 0.7,
        }),
        duration: 1234,
      }),
    ]);
  });

  test('persists an entire clone batch with one Neo4j write', async () => {
    await persistCloneResultsBatch('sim-123', [
      makeCloneResult('clone-1'),
      makeCloneResult('clone-2'),
    ]);

    expect(runWriteSingleMock).toHaveBeenCalledTimes(1);
    expect(runWriteSingleMock).toHaveBeenCalledWith(
      expect.stringContaining('UNWIND $rows AS row'),
      expect.objectContaining({
        simulationId: 'sim-123',
        rows: [
          expect.objectContaining({ cloneId: 'clone-1' }),
          expect.objectContaining({ cloneId: 'clone-2' }),
        ],
      }),
    );
  });

  test('skips the Neo4j write for empty result batches', async () => {
    await persistCloneResultsBatch('sim-empty', []);
    expect(runWriteSingleMock).not.toHaveBeenCalled();
  });
});
