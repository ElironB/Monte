import { describe, it, expect } from 'vitest';
import { DimensionMapper } from '../src/persona/dimensionMapper.js';
import { BehavioralSignal } from '../src/ingestion/types.js';

function makeSignal(value: string, type: string = 'cognitive_trait', confidence: number = 0.8): BehavioralSignal {
  return {
    id: `sig-${Math.random().toString(36).slice(2, 8)}`,
    type: type as any,
    value,
    confidence,
    evidence: 'test',
    sourceDataId: 'test',
    timestamp: new Date().toISOString(),
    dimensions: {},
  };
}

describe('DimensionMapper', () => {
  it('maps high risk signals to elevated riskTolerance', () => {
    const signals = [
      makeSignal('high_risk_tolerance'),
      makeSignal('financial_trading', 'interest'),
      makeSignal('impulse_spending', 'financial_behavior'),
    ];
    const mapper = new DimensionMapper(signals);
    const dims = mapper.mapToDimensions();
    expect(dims.riskTolerance).toBeGreaterThan(0.5);
  });

  it('maps anxiety signals to elevated emotionalVolatility', () => {
    const signals = [
      makeSignal('anxiety', 'emotional_state'),
    ];
    const mapper = new DimensionMapper(signals);
    const dims = mapper.mapToDimensions();
    expect(dims.emotionalVolatility).toBeGreaterThan(0.5);
  });

  it('maps goal + education signals to learning-oriented dimensions', () => {
    const signals = [
      makeSignal('educational_content', 'interest'),
      makeSignal('learning_focused'),
      makeSignal('deep_self_reflection'),
    ];
    const mapper = new DimensionMapper(signals);
    const dims = mapper.mapToDimensions();
    expect(dims.learningStyle).toBeGreaterThan(0.5);
  });

  it('returns neutral (0.5) with no signals', () => {
    const mapper = new DimensionMapper([]);
    const dims = mapper.mapToDimensions();
    expect(dims.riskTolerance).toBe(0.5);
    expect(dims.emotionalVolatility).toBe(0.5);
  });

  it('all dimensions are bounded 0-1', () => {
    const signals = [
      makeSignal('high_risk_tolerance'),
      makeSignal('anxiety', 'emotional_state'),
      makeSignal('impulse_spending', 'financial_behavior'),
      makeSignal('goal_oriented'),
      makeSignal('educational_content', 'interest'),
      makeSignal('decision_paralysis'),
      makeSignal('high_social_engagement', 'social_pattern'),
    ];
    const mapper = new DimensionMapper(signals);
    const dims = mapper.mapToDimensions();
    for (const [key, val] of Object.entries(dims)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });
});
