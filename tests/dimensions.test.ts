import { describe, it, expect } from 'vitest';
import { DimensionMapper } from '../src/persona/dimensionMapper.js';
import type { ConceptEmbeddings } from '../src/embeddings/dimensionConcepts.js';
import { BehavioralSignal, SignalContradiction } from '../src/ingestion/types.js';

function makeSignal(
  value: string,
  type: string = 'cognitive_trait',
  confidence: number = 0.8,
  timestamp: string = new Date().toISOString(),
  sourceType?: string,
): BehavioralSignal {
  return {
    id: `sig-${Math.random().toString(36).slice(2, 8)}`,
    type: type as BehavioralSignal['type'],
    value,
    confidence,
    evidence: 'test',
    sourceDataId: 'test',
    sourceType,
    timestamp,
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

describe('DimensionMapper', () => {
  it('maps semantically aligned high-risk signals to elevated riskTolerance', () => {
    const signals = [
      makeSignal('speculative investing appetite'),
      makeSignal('comfortable making volatile bets', 'interest'),
      makeSignal('impulsive financial swing', 'financial_behavior'),
    ];
    const signalEmbeddings = new Map(signals.map((signal, index) => [
      signal.id,
      [1, index * 0.05],
    ]));

    const mapper = new DimensionMapper(signals, conceptEmbeddings, signalEmbeddings);
    const dims = mapper.mapToDimensions();
    expect(dims.riskTolerance).toBeGreaterThan(0.5);
  });

  it('maps emotionally reactive signals to elevated emotionalVolatility', () => {
    const signals = [
      makeSignal('panic-driven reaction', 'emotional_state'),
    ];
    const signalEmbeddings = new Map([[signals[0].id, [0.6, 0.8]]]);

    const mapper = new DimensionMapper(signals, conceptEmbeddings, signalEmbeddings);
    const dims = mapper.mapToDimensions();
    expect(dims.emotionalVolatility).toBeGreaterThan(0.5);
  });

  it('maps research-oriented signals to learning-oriented dimensions', () => {
    const signals = [
      makeSignal('prefers formal study before acting', 'interest'),
      makeSignal('reads documentation deeply'),
      makeSignal('likes structured courses'),
    ];
    const signalEmbeddings = new Map(signals.map(signal => [signal.id, [0, 1]]));

    const mapper = new DimensionMapper(signals, conceptEmbeddings, signalEmbeddings);
    const dims = mapper.mapToDimensions();
    expect(dims.learningStyle).toBeGreaterThan(0.5);
  });

  it('returns neutral (0.5) with no embeddings available', () => {
    const mapper = new DimensionMapper([]);
    const dims = mapper.mapToDimensions();
    expect(dims.riskTolerance).toBe(0.5);
    expect(dims.emotionalVolatility).toBe(0.5);
  });

  it('applies source-specific half-lives when sourceType is present', () => {
    const oldTimestamp = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const recentTimestamp = new Date().toISOString();
    const financialSignal = makeSignal('speculative investing appetite', 'cognitive_trait', 0.8, oldTimestamp, 'financial');
    const searchSignal = makeSignal('speculative investing appetite', 'cognitive_trait', 0.8, oldTimestamp, 'search_history');
    const counterweightSignal = makeSignal('risk averse capital preservation', 'financial_behavior', 0.8, recentTimestamp, 'financial');

    const embeddings = new Map<string, number[]>([
      [financialSignal.id, [1, 0]],
      [searchSignal.id, [1, 0]],
      [counterweightSignal.id, [-1, 0]],
    ]);

    const financialDims = new DimensionMapper(
      [financialSignal, counterweightSignal],
      conceptEmbeddings,
      embeddings,
    ).mapToDimensions();

    const searchDims = new DimensionMapper(
      [searchSignal, counterweightSignal],
      conceptEmbeddings,
      embeddings,
    ).mapToDimensions();

    expect(financialDims.riskTolerance).toBeGreaterThan(searchDims.riskTolerance);
  });

  it('applies recency decay — older signals contribute less', () => {
    const recentSignal = makeSignal(
      'speculative investing appetite',
      'cognitive_trait',
      0.8,
      new Date().toISOString(),
    );
    const oldSignal = makeSignal(
      'speculative investing appetite',
      'cognitive_trait',
      0.8,
      new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    );
    const counterweightSignal = makeSignal(
      'risk averse capital preservation',
      'financial_behavior',
      0.8,
      new Date().toISOString(),
    );

    const embeddings = new Map<string, number[]>([
      [recentSignal.id, [1, 0]],
      [oldSignal.id, [1, 0]],
      [counterweightSignal.id, [-1, 0]],
    ]);

    const oldDims = new DimensionMapper(
      [oldSignal, counterweightSignal],
      conceptEmbeddings,
      embeddings,
    ).mapToDimensions();

    const recentDims = new DimensionMapper(
      [recentSignal, counterweightSignal],
      conceptEmbeddings,
      embeddings,
    ).mapToDimensions();

    expect(recentDims.riskTolerance).toBeGreaterThan(oldDims.riskTolerance);
  });

  it('all dimensions are bounded 0-1', () => {
    const signals = [
      makeSignal('speculative risk appetite'),
      makeSignal('reactive under pressure', 'emotional_state'),
      makeSignal('urgent need for immediate action', 'financial_behavior'),
      makeSignal('long research sprint'),
      makeSignal('prefers team validation', 'social_pattern'),
      makeSignal('slow careful analysis'),
    ];
    const vectors = [
      [1, 0],
      [0.6, 0.8],
      [0.9, 0.1],
      [0, 1],
      [0.7, 0.7],
      [-0.8, -0.2],
    ];
    const signalEmbeddings = new Map(signals.map((signal, index) => [signal.id, vectors[index]]));

    const mapper = new DimensionMapper(signals, conceptEmbeddings, signalEmbeddings);
    const dims = mapper.mapToDimensions();
    for (const val of Object.values(dims)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  describe('with contradictions', () => {
    it('pulls a contradicted dimension toward 0.5', () => {
      const signals = [makeSignal('speculative investing appetite')];
      const signalEmbeddings = new Map([[signals[0].id, [1, 0]]]);

      const mapperClean = new DimensionMapper(signals, conceptEmbeddings, signalEmbeddings, []);
      const dimsClean = mapperClean.mapToDimensions();

      const contradictions: SignalContradiction[] = [{
        id: 'c1',
        signalAId: 'stated-risk-aversion',
        signalBId: signals[0].id,
        type: 'stated_vs_revealed',
        description: 'test',
        severity: 'high',
        magnitude: 0.8,
        affectedDimensions: ['riskTolerance'],
      }];

      const mapperContra = new DimensionMapper(signals, conceptEmbeddings, signalEmbeddings, contradictions);
      const dimsContra = mapperContra.mapToDimensions();

      expect(Math.abs(dimsContra.riskTolerance - 0.5)).toBeLessThan(
        Math.abs(dimsClean.riskTolerance - 0.5)
      );
    });

    it('contradiction on one dimension does not affect other dimensions', () => {
      const signals = [makeSignal('speculative investing appetite')];
      const signalEmbeddings = new Map([[signals[0].id, [1, 0]]]);

      const contradictions: SignalContradiction[] = [{
        id: 'c1',
        signalAId: 'other',
        signalBId: signals[0].id,
        type: 'cross_domain',
        description: 'test',
        severity: 'high',
        magnitude: 0.9,
        affectedDimensions: ['riskTolerance'],
      }];

      const mapperClean = new DimensionMapper(signals, conceptEmbeddings, signalEmbeddings, []);
      const mapperContra = new DimensionMapper(signals, conceptEmbeddings, signalEmbeddings, contradictions);

      expect(mapperContra.mapToDimensions().learningStyle).toBe(mapperClean.mapToDimensions().learningStyle);
    });

    it('returns contradiction penalties alongside dimensions', () => {
      const signals = [makeSignal('speculative investing appetite')];
      const signalEmbeddings = new Map([[signals[0].id, [1, 0]]]);
      const contradictions: SignalContradiction[] = [{
        id: 'c1',
        signalAId: 'other',
        signalBId: signals[0].id,
        type: 'cross_domain',
        description: 'test',
        severity: 'medium',
        magnitude: 0.6,
        affectedDimensions: ['riskTolerance'],
      }];

      const result = new DimensionMapper(
        signals,
        conceptEmbeddings,
        signalEmbeddings,
        contradictions
      ).mapToDimensionsWithContradictions();

      expect(result.contradictionPenalties.riskTolerance).toBeGreaterThan(0);
      expect(result.contradictionPenalties.learningStyle).toBe(0);
      expect(result.dimensions.riskTolerance).toBeGreaterThanOrEqual(0);
      expect(result.dimensions.riskTolerance).toBeLessThanOrEqual(1);
    });

    it('ignores historical contradictions that are unrelated to the current signal batch', () => {
      const freshSignal = makeSignal('keeps taking speculative bets');
      const signalEmbeddings = new Map<string, number[]>([
        [freshSignal.id, [1, 0]],
        ['historical-signal', [-1, 0]],
      ]);
      const contradictions: SignalContradiction[] = [{
        id: 'c1',
        signalAId: 'historical-signal',
        signalBId: 'another-historical-signal',
        type: 'cross_domain',
        description: 'old contradiction unrelated to this incremental batch',
        severity: 'high',
        magnitude: 1,
        affectedDimensions: ['riskTolerance'],
      }];

      const result = new DimensionMapper(
        [freshSignal],
        conceptEmbeddings,
        signalEmbeddings,
        contradictions
      ).mapToDimensionsWithContradictions();

      expect(result.dimensions.riskTolerance).toBe(1);
      expect(result.contradictionPenalties.riskTolerance).toBe(0);
    });

    it('weights revealed-side signals higher than stated-side signals', () => {
      const stated = makeSignal('claims extreme caution');
      const revealed = makeSignal('keeps taking speculative bets');
      const signalEmbeddings = new Map<string, number[]>([
        [stated.id, [-1, 0]],
        [revealed.id, [1, 0]],
      ]);

      const correctRoles: SignalContradiction[] = [{
        id: 'c1',
        signalAId: stated.id,
        signalBId: revealed.id,
        type: 'stated_vs_revealed',
        description: 'test',
        severity: 'high',
        magnitude: 0.8,
        affectedDimensions: ['riskTolerance'],
      }];
      const swappedRoles: SignalContradiction[] = [{
        ...correctRoles[0],
        signalAId: revealed.id,
        signalBId: stated.id,
      }];

      const correctScore = new DimensionMapper(
        [stated, revealed],
        conceptEmbeddings,
        signalEmbeddings,
        correctRoles
      ).mapToDimensions().riskTolerance;
      const swappedScore = new DimensionMapper(
        [stated, revealed],
        conceptEmbeddings,
        signalEmbeddings,
        swappedRoles
      ).mapToDimensions().riskTolerance;

      expect(correctScore).toBeGreaterThan(swappedScore);
    });
  });
});
