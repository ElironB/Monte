import { describe, it, expect } from 'vitest';
import { DimensionMapper } from '../src/persona/dimensionMapper.js';
import type { ConceptEmbeddings } from '../src/embeddings/dimensionConcepts.js';
import { BehavioralSignal, SignalContradiction } from '../src/ingestion/types.js';

function makeSignal(value: string, type: string = 'cognitive_trait', confidence: number = 0.8): BehavioralSignal {
  return {
    id: `sig-${Math.random().toString(36).slice(2, 8)}`,
    type: type as BehavioralSignal['type'],
    value,
    confidence,
    evidence: 'test',
    sourceDataId: 'test',
    timestamp: new Date().toISOString(),
    dimensions: {},
  };
}

const conceptEmbeddings: ConceptEmbeddings = {
  riskTolerance: { high: [1, 0], low: [-1, 0] },
  timePreference: { high: [0.9, 0.1], low: [-0.9, -0.1] },
  socialDependency: { high: [0.7, 0.7], low: [-0.7, -0.7] },
  learningStyle: { high: [0, 1], low: [0, -1] },
  decisionSpeed: { high: [0.8, 0.2], low: [-0.8, -0.2] },
  emotionalVolatility: { high: [0.6, 0.8], low: [-0.6, -0.8] },
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
