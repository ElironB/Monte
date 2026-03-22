import { describe, expect, test } from 'vitest';
import { categorizeOutcome, getInitialState } from '../src/simulation/decisionGraph.js';
import { ResultAggregator } from '../src/simulation/resultAggregator.js';
import { ScenarioType, type CloneParameters, type CloneResult } from '../src/simulation/types.js';

const baseParameters: CloneParameters = {
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

function makeCustomResult(overrides: {
  cloneId: string;
  capital: number;
  happiness: number;
  outcome?: string;
  metrics?: Record<string, number>;
}): CloneResult {
  const initialState = getInitialState(ScenarioType.CUSTOM);

  return {
    cloneId: overrides.cloneId,
    parameters: baseParameters,
    stratification: {
      percentile: 50,
      category: 'typical',
    },
    path: [],
    finalState: {
      ...initialState,
      capital: overrides.capital,
      happiness: overrides.happiness,
      outcome: overrides.outcome,
      metrics: {
        ...initialState.metrics,
        progressRate: 0.2,
        adaptationScore: 0.4,
        optionalityPreserved: 0.7,
        evidenceQuality: 0.45,
        executionQuality: 0.55,
        burnRate: 0.25,
        reversibility: 0.6,
        ...(overrides.metrics ?? {}),
      },
    },
    metrics: {
      ...initialState.metrics,
      progressRate: 0.2,
      adaptationScore: 0.4,
      optionalityPreserved: 0.7,
      evidenceQuality: 0.45,
      executionQuality: 0.55,
      burnRate: 0.25,
      reversibility: 0.6,
      ...(overrides.metrics ?? {}),
    },
    duration: 1_000,
  };
}

describe('custom scenario outcome classification', () => {
  test('marks clearly degraded custom outcomes as failures', () => {
    const failureState = makeCustomResult({
      cloneId: 'failure',
      capital: 12_000,
      happiness: 0.42,
      outcome: 'exhausted_collapse',
      metrics: {
        progressRate: 0.1,
        adaptationScore: 0.1,
        optionalityPreserved: 0.3,
        burnRate: 0.8,
        setbackCount: 3,
        reversibility: 0.2,
      },
    }).finalState;

    expect(categorizeOutcome(failureState, ScenarioType.CUSTOM)).toBe('failure');
  });

  test('keeps early exits and mediocre recoveries neutral', () => {
    const neutralState = makeCustomResult({
      cloneId: 'neutral',
      capital: 20_500,
      happiness: 0.55,
      outcome: 'contained_failure',
      metrics: {
        progressRate: 0.18,
        adaptationScore: 0.72,
        optionalityPreserved: 0.86,
        evidenceQuality: 0.58,
        executionQuality: 0.57,
        reversibility: 0.8,
      },
    }).finalState;

    expect(categorizeOutcome(neutralState, ScenarioType.CUSTOM)).toBe('neutral');
  });

  test('requires strong preservation and progress to call a custom run successful', () => {
    const successState = makeCustomResult({
      cloneId: 'success',
      capital: 22_500,
      happiness: 0.74,
      outcome: 'durable_success',
      metrics: {
        progressRate: 0.56,
        adaptationScore: 0.7,
        optionalityPreserved: 0.82,

        evidenceQuality: 0.72,
        executionQuality: 0.76,
        reversibility: 0.62,
      },
    }).finalState;

    expect(categorizeOutcome(successState, ScenarioType.CUSTOM)).toBe('success');
  });
});

describe('result aggregation success classification', () => {
  test('does not auto-promote contained failures or fragile wins to success', () => {
    const aggregator = new ResultAggregator(ScenarioType.CUSTOM);

    expect((aggregator as any).categorizeResult(makeCustomResult({
      cloneId: 'retreat',
      capital: 20_200,
      happiness: 0.58,
      outcome: 'contained_failure',
      metrics: {
        adaptationScore: 0.75,
        optionalityPreserved: 0.9,
        reversibility: 0.82,
      },
    }))).toBe('neutral');

    expect((aggregator as any).categorizeResult(makeCustomResult({
      cloneId: 'fragile',
      capital: 19_800,
      happiness: 0.6,
      outcome: 'fragile_win',
      metrics: {
        progressRate: 0.42,
        adaptationScore: 0.45,
        optionalityPreserved: 0.3,
        burnRate: 0.68,
        executionQuality: 0.52,
        reversibility: 0.3,
      },
    }))).toBe('neutral');
  });

  test('requires both capital preservation and happiness to count as success', () => {
    const aggregator = new ResultAggregator(ScenarioType.CUSTOM);

    expect((aggregator as any).categorizeResult(makeCustomResult({
      cloneId: 'thin-margin',
      capital: 19_500,
      happiness: 0.78,
      outcome: 'fragile_win',
      metrics: {
        progressRate: 0.52,
        adaptationScore: 0.7,
        optionalityPreserved: 0.68,
        evidenceQuality: 0.74,
        executionQuality: 0.74,
        reversibility: 0.5,
      },
    }))).toBe('neutral');

    expect((aggregator as any).categorizeResult(makeCustomResult({
      cloneId: 'strong-finish',
      capital: 26_000,
      happiness: 0.72,
      outcome: 'durable_success',
      metrics: {
        progressRate: 0.58,
        adaptationScore: 0.72,
        optionalityPreserved: 0.84,
        evidenceQuality: 0.75,
        executionQuality: 0.78,
        reversibility: 0.62,
      },
    }))).toBe('success');
  });
});
