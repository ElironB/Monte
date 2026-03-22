import { expect, test, describe } from 'vitest';
import { PsychologyLayer } from '../../src/persona/psychologyLayer.js';
import type { DimensionScore } from '../../src/persona/personaCompressor.js';

// Helper to build a DimensionScore from a raw value
function score(value: number, confidence = 0.8): DimensionScore {
  return {
    value,
    confidence,
    signalCount: 5,
    sourceCount: 2,
    sourceTypes: ['financial', 'social_media'],
    isEstimated: false,
    confidenceInterval: [Math.max(0, value - 0.1), Math.min(1, value + 0.1)],
  };
}

// Helper to build a full dimension score map with sensible defaults for unspecified dims
function dims(overrides: Partial<Record<string, number>>): Record<string, DimensionScore> {
  const defaults: Record<string, number> = {
    riskTolerance: 0.5,
    timePreference: 0.5,
    socialDependency: 0.5,
    learningStyle: 0.5,
    decisionSpeed: 0.5,
    emotionalVolatility: 0.5,
    executionGap: 0.5,
    informationSeeking: 0.5,
    stressResponse: 0.5,
  };
  // Cast ensures v is number, not number|undefined (overrides are merged over defaults)
  const merged = { ...defaults, ...overrides } as Record<string, number>;
  return Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, score(v)]));
}

describe('PsychologyLayer', () => {
  // --------------------------------------------------------------------------
  // Test 1 — The anxious planner
  // High executionGap, high emotionalVolatility, high socialDependency, loss-averse, present-biased
  // --------------------------------------------------------------------------
  test('anxious planner: high executionGap + anxiety + lossAversion → anxious attachment, low C, high N, hyperbolic discounting, risk flags', () => {
    const layer = new PsychologyLayer();
    const profile = layer.analyze(dims({
      executionGap: 0.8,
      emotionalVolatility: 0.85,
      socialDependency: 0.75,
      timePreference: 0.7,   // high = present bias / low future orientation
      riskTolerance: 0.2,    // low = loss averse
    }));

    expect(profile.bigFive.conscientiousness).toBeLessThan(0.45);
    expect(profile.bigFive.neuroticism).toBeGreaterThan(0.55);
    expect(profile.attachment.style).toBe('anxious');
    expect(['hyperbolic_moderate', 'hyperbolic_severe']).toContain(profile.temporalDiscounting.discountingRate);
    expect(profile.riskFlags.some(f => f.flag === 'social_financial_contamination')).toBe(true);

    // Technical summary should be a non-empty string
    expect(profile.technicalSummary).toContain('Big Five:');
    expect(profile.technicalSummary).toContain('Attachment:');
    expect(profile.narrativeSummary.length).toBeGreaterThan(50);
  });

  // --------------------------------------------------------------------------
  // Test 2 — The disciplined executor
  // Low executionGap, low anxiety, future-oriented, not loss-averse
  // --------------------------------------------------------------------------
  test('disciplined executor: low executionGap + low anxiety + future orientation → secure, high C, low N, near-rational discounting, no high risk flags', () => {
    const layer = new PsychologyLayer();
    // timePreference=0.4 keeps temporal discounting in near_rational band:
    // score = (1-0.4)*0.5 + (1-0.1)*0.3 + 0.7*0.2 = 0.30 + 0.27 + 0.14 = 0.71 → near_rational (0.45..0.70)
    // Wait: 0.71 >= 0.70 → future_biased. Use timePreference=0.45:
    // score = (1-0.45)*0.5 + (1-0.1)*0.3 + 0.7*0.2 = 0.275+0.27+0.14 = 0.685 → near_rational ✓
    const profile = layer.analyze(dims({
      executionGap: 0.1,
      emotionalVolatility: 0.2,
      socialDependency: 0.55, // balanced to avoid avoidant classification
      timePreference: 0.45,  // moderate future orientation — keeps discounting in near_rational
      riskTolerance: 0.7,    // high = not loss-averse
      stressResponse: 0.2,
    }));

    expect(profile.bigFive.conscientiousness).toBeGreaterThan(0.55);
    expect(profile.bigFive.neuroticism).toBeLessThan(0.45);
    expect(profile.attachment.style).toBe('secure');
    // near_rational: score 0.45..0.70
    expect(['near_rational', 'future_biased']).toContain(profile.temporalDiscounting.discountingRate);
    // main assertion: definitely NOT hyperbolic
    expect(profile.temporalDiscounting.discountingRate).not.toBe('hyperbolic_severe');
    expect(profile.temporalDiscounting.discountingRate).not.toBe('hyperbolic_moderate');

    const highSeverityFlags = profile.riskFlags.filter(f => f.severity === 'high');
    expect(highSeverityFlags).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Test 3 — The avoidant high-performer
  // Low socialDependency, high decisionSpeed, deep learningStyle
  // --------------------------------------------------------------------------
  test('avoidant high-performer: low socialDependency + high decisionSpeed + deep learning → avoidant attachment, high O, low E, internal locus', () => {
    const layer = new PsychologyLayer();
    const profile = layer.analyze(dims({
      executionGap: 0.3,
      emotionalVolatility: 0.3,
      socialDependency: 0.1,
      timePreference: 0.4,
      riskTolerance: 0.6,
      decisionSpeed: 0.85,
      learningStyle: 0.8,
      informationSeeking: 0.7,
      stressResponse: 0.3,
    }));

    expect(profile.attachment.style).toBe('avoidant');
    expect(profile.bigFive.openness).toBeGreaterThan(0.55);
    expect(profile.bigFive.extraversion).toBeLessThan(0.5);
    expect(profile.locusOfControl.type).toBe('internal');
  });

  // --------------------------------------------------------------------------
  // Test 4 — Excluded (low-confidence) dimensions yield neutral Big Five
  // --------------------------------------------------------------------------
  test('all low-confidence dimensions yield neutral Big Five (0.5) with confidence <= 0.1', () => {
    const layer = new PsychologyLayer();
    const lowConf = (v: number): DimensionScore => score(v, 0.2); // below CONFIDENCE_MIN_THRESHOLD = 0.3
    const allLow = Object.fromEntries([
      'executionGap', 'emotionalVolatility', 'socialDependency', 'timePreference',
      'riskTolerance', 'decisionSpeed', 'learningStyle', 'informationSeeking', 'stressResponse',
    ].map(k => [k, lowConf(0.85)]));

    const profile = layer.analyze(allLow);

    expect(profile.bigFive.openness).toBe(0.5);
    expect(profile.bigFive.conscientiousness).toBe(0.5);
    expect(profile.bigFive.confidence).toBeLessThanOrEqual(0.1);
  });

  // --------------------------------------------------------------------------
  // Test 5 — Internal locus + high executionGap triggers execution_overconfidence
  // --------------------------------------------------------------------------
  test('internal locus + high executionGap triggers execution_overconfidence risk flag', () => {
    const layer = new PsychologyLayer();
    // Locus score = (1-timePreference)*0.4 + (1-executionGap)*0.35 + (1-socialDependency)*0.25
    // = (1-0.05)*0.4 + (1-0.75)*0.35 + (1-0.05)*0.25
    // = 0.38 + 0.0875 + 0.2375 = 0.705 > 0.7 → triggers execution_overconfidence
    const profile = layer.analyze(dims({
      executionGap: 0.75,
      socialDependency: 0.05,  // very independent
      timePreference: 0.05,    // very future-oriented
      riskTolerance: 0.8,
      emotionalVolatility: 0.3,
    }));

    expect(profile.locusOfControl.type).toBe('internal');
    expect(profile.locusOfControl.score).toBeGreaterThan(0.65);
    expect(profile.riskFlags.some(f => f.flag === 'execution_overconfidence')).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Test 6 — PsychologicalProfile has all required fields
  // --------------------------------------------------------------------------
  test('profile always has all required top-level fields', () => {
    const layer = new PsychologyLayer();
    const profile = layer.analyze(dims({}));
    expect(profile).toHaveProperty('bigFive');
    expect(profile).toHaveProperty('attachment');
    expect(profile).toHaveProperty('locusOfControl');
    expect(profile).toHaveProperty('temporalDiscounting');
    expect(profile).toHaveProperty('riskFlags');
    expect(profile).toHaveProperty('narrativeSummary');
    expect(profile).toHaveProperty('technicalSummary');
    expect(Array.isArray(profile.riskFlags)).toBe(true);
    expect(typeof profile.narrativeSummary).toBe('string');
  });
});
