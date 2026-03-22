import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BehavioralSignal } from '../src/ingestion/types.js';
import type { ConceptEmbeddings } from '../src/embeddings/dimensionConcepts.js';

const { runQuerySingleMock, runWriteSingleMock } = vi.hoisted(() => ({
  runQuerySingleMock: vi.fn(),
  runWriteSingleMock: vi.fn(),
}));

vi.mock('../src/config/neo4j.js', () => ({
  runQuerySingle: runQuerySingleMock,
  runWriteSingle: runWriteSingleMock,
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { BayesianUpdater } from '../src/persona/bayesianUpdater.js';

function makeSignal(value: string, type: BehavioralSignal['type'], confidence: number = 0.9): BehavioralSignal {
  return {
    id: `sig-${Math.random().toString(36).slice(2, 8)}`,
    type,
    value,
    confidence,
    evidence: 'test',
    sourceDataId: 'source-1',
    timestamp: new Date().toISOString(),
    dimensions: {},
  };
}

const conceptEmbeddings: ConceptEmbeddings = {
  riskTolerance: { high: [[1, 0]], low: [[-1, 0]], negative: [] },
  timePreference: { high: [[0.9, 0.1]], low: [[-0.9, -0.1]], negative: [] },
  socialDependency: { high: [[0.7, 0.7]], low: [[-0.7, -0.7]], negative: [] },
  learningStyle: { high: [[0, 1]], low: [[0, -1]], negative: [] },
  decisionSpeed: { high: [[0.8, 0.2]], low: [[-0.8, -0.2]], negative: [] },
  emotionalVolatility: { high: [[0.6, 0.8]], low: [[-0.6, -0.8]], negative: [] },
};

describe('BayesianUpdater', () => {
  beforeEach(() => {
    runQuerySingleMock.mockReset();
    runWriteSingleMock.mockReset();
    runWriteSingleMock.mockResolvedValue({ id: 'trait-1' });
  });

  it('raises confidence for corroborating semantic evidence', async () => {
    runQuerySingleMock.mockImplementation(async (_query: string, params: { dimName: string }) => ({
      value: params.dimName === 'riskTolerance' ? 0.82 : 0.5,
      confidence: params.dimName === 'riskTolerance' ? 0.7 : 0.6,
      evidenceCount: 2,
    }));

    const signal = makeSignal('speculative conviction', 'cognitive_trait');
    const signalEmbeddings = new Map([[signal.id, [1, 0]]]);
    const updater = new BayesianUpdater('user-1', 'persona-1', conceptEmbeddings, signalEmbeddings);
    const result = await updater.update(
      [signal],
      {
        riskTolerance: 0.85,
        timePreference: 0.5,
        socialDependency: 0.5,
        learningStyle: 0.5,
        decisionSpeed: 0.5,
        emotionalVolatility: 0.5,
      }
    );

    const riskUpdate = result.updates.find(update => update.dimension === 'riskTolerance');
    expect(riskUpdate).toBeDefined();
    expect(riskUpdate?.evidenceType).toBe('corroborating');
    expect(riskUpdate?.posterior).toBeGreaterThan(riskUpdate?.prior ?? 0);
    expect(riskUpdate?.posteriorValue).toBeCloseTo(0.823, 3);

    expect(runWriteSingleMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(runWriteSingleMock).toHaveBeenCalledWith(
      expect.stringContaining('SET t.confidence = $posterior'),
      expect.objectContaining({
        dimName: 'riskTolerance',
        evidenceCount: 3,
        lowConfidence: false,
      })
    );
  });

  it('flags low confidence after repeated contradicting semantic evidence', async () => {
    runQuerySingleMock.mockImplementation(async (_query: string, params: { dimName: string }) => ({
      value: params.dimName === 'riskTolerance' ? 0.8 : 0.5,
      confidence: params.dimName === 'riskTolerance' ? 0.1 : 0.6,
      evidenceCount: 2,
    }));

    const signal = makeSignal('cautious capital preservation', 'cognitive_trait', 1);
    const signalEmbeddings = new Map([[signal.id, [1, 0]]]);
    const updater = new BayesianUpdater('user-1', 'persona-1', conceptEmbeddings, signalEmbeddings);
    const result = await updater.update(
      [signal],
      {
        riskTolerance: 0.1,
        timePreference: 0.5,
        socialDependency: 0.5,
        learningStyle: 0.5,
        decisionSpeed: 0.5,
        emotionalVolatility: 0.5,
      }
    );

    const riskUpdate = result.updates.find(update => update.dimension === 'riskTolerance');
    expect(riskUpdate).toBeDefined();
    expect(riskUpdate?.evidenceType).toBe('contradicting');
    expect(riskUpdate?.posterior).toBe(0.05);

    expect(runWriteSingleMock).toHaveBeenCalledWith(
      expect.stringContaining('SET t.confidence = $posterior'),
      expect.objectContaining({
        dimName: 'riskTolerance',
        lowConfidence: true,
        evidenceCount: 3,
      })
    );
  });
});
