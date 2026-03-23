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

import { BayesianUpdater, DriftDetector } from '../src/persona/bayesianUpdater.js';

let signalCounter = 0;

function makeSignal(
  value: string,
  type: BehavioralSignal['type'],
  confidence = 0.9,
): BehavioralSignal {
  signalCounter += 1;

  return {
    id: `sig-${signalCounter}`,
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
  timePreference: {
    high: [[0.9, 0.1]],
    low: [[-0.9, -0.1]],
    negative: [],
  },
  socialDependency: {
    high: [[0.7, 0.7]],
    low: [[-0.7, -0.7]],
    negative: [],
  },
  learningStyle: { high: [[0, 1]], low: [[0, -1]], negative: [] },
  decisionSpeed: {
    high: [[0.8, 0.2]],
    low: [[-0.8, -0.2]],
    negative: [],
  },
  emotionalVolatility: {
    high: [[0.6, 0.8]],
    low: [[-0.6, -0.8]],
    negative: [],
  },
};

describe('BayesianUpdater', () => {
  beforeEach(() => {
    signalCounter = 0;
    runQuerySingleMock.mockReset();
    runWriteSingleMock.mockReset();
    runWriteSingleMock.mockResolvedValue({ id: 'trait-1' });
  });

  it('raises confidence for corroborating semantic evidence', async () => {
    runQuerySingleMock.mockImplementation(
      async (_query: string, params: { dimName: string }) => ({
        value: params.dimName === 'riskTolerance' ? 0.82 : 0.5,
        confidence: params.dimName === 'riskTolerance' ? 0.7 : 0.6,
        evidenceCount: 2,
      }),
    );

    const signal = makeSignal('speculative conviction', 'cognitive_trait');
    const signalEmbeddings = new Map([[signal.id, [1, 0]]]);
    const updater = new BayesianUpdater(
      'user-1',
      'persona-1',
      conceptEmbeddings,
      signalEmbeddings,
    );
    const result = await updater.update(
      [signal],
      {
        riskTolerance: 0.85,
        timePreference: 0.5,
        socialDependency: 0.5,
        learningStyle: 0.5,
        decisionSpeed: 0.5,
        emotionalVolatility: 0.5,
      },
    );

    const riskUpdate = result.updates.find(
      update => update.dimension === 'riskTolerance',
    );
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
      }),
    );
  });

  it('flags low confidence after repeated contradicting semantic evidence', async () => {
    runQuerySingleMock.mockImplementation(
      async (_query: string, params: { dimName: string }) => ({
        value: params.dimName === 'riskTolerance' ? 0.8 : 0.5,
        confidence: params.dimName === 'riskTolerance' ? 0.1 : 0.6,
        evidenceCount: 2,
      }),
    );

    const signal = makeSignal(
      'cautious capital preservation',
      'cognitive_trait',
      1,
    );
    const signalEmbeddings = new Map([[signal.id, [1, 0]]]);
    const updater = new BayesianUpdater(
      'user-1',
      'persona-1',
      conceptEmbeddings,
      signalEmbeddings,
    );
    const result = await updater.update(
      [signal],
      {
        riskTolerance: 0.1,
        timePreference: 0.5,
        socialDependency: 0.5,
        learningStyle: 0.5,
        decisionSpeed: 0.5,
        emotionalVolatility: 0.5,
      },
    );

    const riskUpdate = result.updates.find(
      update => update.dimension === 'riskTolerance',
    );
    expect(riskUpdate).toBeDefined();
    expect(riskUpdate?.evidenceType).toBe('contradicting');
    expect(riskUpdate?.posterior).toBe(0.05);

    expect(runWriteSingleMock).toHaveBeenCalledWith(
      expect.stringContaining('SET t.confidence = $posterior'),
      expect.objectContaining({
        dimName: 'riskTolerance',
        lowConfidence: true,
        evidenceCount: 3,
      }),
    );
  });
});

describe('DriftDetector', () => {
  const detector = new DriftDetector();

  it('flags only the dimension whose semantic evidence changes', () => {
    const historicalSignals: BehavioralSignal[] = [
      {
        ...makeSignal('patient long-term planning', 'cognitive_trait'),
        evidence: 'future-oriented and gradual investing plan',
      },
    ];
    const recentSignals: BehavioralSignal[] = [
      {
        ...makeSignal('needs immediate results now', 'cognitive_trait'),
        evidence: 'urgent short-term decisions and quick wins',
        dimensions: { urgency: 1, intensityTrend: 'increasing' },
      },
    ];

    const result = detector.evaluateDrift(recentSignals, historicalSignals);

    expect(result.driftingDimensions).toEqual(['timePreference']);
    expect(result.maxDelta).toBeGreaterThan(0.3);
    expect(result.recommendedStrategy).toBe('full_rebuild');
  });

  it(
    'does not infer drift from count changes alone when semantics stay aligned',
    () => {
      const historicalSignals: BehavioralSignal[] = [
        {
          ...makeSignal('speculative conviction', 'cognitive_trait'),
          evidence: 'comfortable with bold volatile bets',
        },
        {
          ...makeSignal('aggressive venture appetite', 'interest'),
          evidence: 'likes leveraged upside',
        },
      ];
      const recentSignals: BehavioralSignal[] = [
        {
          ...makeSignal('speculative conviction', 'cognitive_trait'),
          evidence: 'comfortable with bold volatile bets',
        },
      ];

      const result = detector.evaluateDrift(recentSignals, historicalSignals);

      expect(result.driftingDimensions).toEqual([]);
      expect(result.maxDelta).toBe(0);
      expect(result.recommendedStrategy).toBe('incremental');
    },
  );
});
