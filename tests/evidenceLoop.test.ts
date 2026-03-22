import { describe, expect, test } from 'vitest';
import { buildDecisionIntelligence } from '../src/simulation/experimentPlanner.js';
import { deriveEvidenceAdjustments } from '../src/simulation/evidenceLoop.js';
import { compileScenario } from '../src/simulation/scenarioCompiler.js';
import { cloneSimulationState } from '../src/simulation/state.js';
import type { CloneParameters, CloneResult, EvidenceResult } from '../src/simulation/types.js';
import { ScenarioType } from '../src/simulation/types.js';

const baseCloneParameters: CloneParameters = {
  riskTolerance: 0.55,
  timePreference: 0.48,
  socialDependency: 0.34,
  learningStyle: 0.62,
  decisionSpeed: 0.51,
  emotionalVolatility: 0.37,
  executionGap: 0.24,
  informationSeeking: 0.72,
  stressResponse: 0.44,
};

const baseScenarioInput = {
  scenarioType: ScenarioType.CUSTOM,
  name: 'OpenClaw runway bet',
  capitalAtRisk: 18_000,
  parameters: {
    primaryQuestion: 'Should you commit the next 18 months to OpenClaw?',
    timeframe: 18,
    runwayMonths: 12,
    fallbackPlan: 'keep consulting two days a week',
    keyUnknowns: [
      'Will design partners pay to pilot OpenClaw?',
      'Can you ship every week under pressure?',
      'How much runway exists before the thesis must prove itself?',
    ],
    reversibilityScore: 0.46,
    socialExposure: 0.58,
  },
};

function createEvidence(params: {
  id: string;
  uncertainty: string;
  focusMetric: string;
  recommendedExperiment: string;
  result: EvidenceResult['result'];
  observedSignal: string;
  causalTargets: EvidenceResult['causalTargets'];
  beliefTargets: EvidenceResult['beliefTargets'];
  confidence?: number;
}): EvidenceResult {
  const confidence = params.confidence ?? 0.85;
  const adjustments = deriveEvidenceAdjustments(
    params.result,
    confidence,
    params.causalTargets,
    params.beliefTargets,
  );

  return {
    id: params.id,
    uncertainty: params.uncertainty,
    focusMetric: params.focusMetric,
    recommendedExperiment: params.recommendedExperiment,
    result: params.result,
    confidence,
    observedSignal: params.observedSignal,
    createdAt: '2026-03-22T00:00:00.000Z',
    causalTargets: params.causalTargets,
    beliefTargets: params.beliefTargets,
    causalAdjustments: adjustments.causalAdjustments,
    beliefAdjustments: adjustments.beliefAdjustments,
  };
}

function makeCloneResult(
  scenario: ReturnType<typeof compileScenario>,
  cloneId: string,
  outcomeValue: number,
  overrides: {
    capital: number;
    happiness: number;
    health: number;
    evidenceQuality: number;
    executionQuality: number;
    burnRate: number;
    optionalityPreserved: number;
    socialPressure: number;
    thesisConfidence: number;
    uncertaintyLevel: number;
    commitmentLockIn: number;
    socialPressureLoad: number;
    downsideSalience: number;
  },
): CloneResult {
  const finalState = cloneSimulationState(scenario.initialState);
  finalState.capital = overrides.capital;
  finalState.happiness = overrides.happiness;
  finalState.health = overrides.health;
  finalState.outcome = outcomeValue >= 0.75 ? 'durable_success' : 'exhausted_collapse';
  finalState.metrics = {
    ...finalState.metrics,
    evidenceQuality: overrides.evidenceQuality,
    executionQuality: overrides.executionQuality,
    burnRate: overrides.burnRate,
    optionalityPreserved: overrides.optionalityPreserved,
    socialPressure: overrides.socialPressure,
  };
  finalState.beliefState = {
    ...finalState.beliefState,
    thesisConfidence: overrides.thesisConfidence,
    uncertaintyLevel: overrides.uncertaintyLevel,
    commitmentLockIn: overrides.commitmentLockIn,
    socialPressureLoad: overrides.socialPressureLoad,
    downsideSalience: overrides.downsideSalience,
  };

  return {
    cloneId,
    parameters: baseCloneParameters,
    stratification: {
      percentile: 50,
      category: 'typical',
    },
    path: [],
    finalState,
    metrics: {
      ...finalState.metrics,
      outcomeValue,
      beliefConfidence: finalState.beliefState.thesisConfidence,
      beliefUncertainty: finalState.beliefState.uncertaintyLevel,
      beliefDownsideSalience: finalState.beliefState.downsideSalience,
    },
    duration: 0,
  };
}

describe('evidence loop', () => {
  test('positive evidence reruns start with higher confidence and lower uncertainty', () => {
    const baselineScenario = compileScenario(baseScenarioInput);
    const positiveEvidence = createEvidence({
      id: 'evidence-positive',
      uncertainty: 'Will design partners pay to pilot OpenClaw?',
      focusMetric: 'evidenceQuality',
      recommendedExperiment: 'Run a two-week evidence sprint with direct pilot asks.',
      result: 'positive',
      observedSignal: 'Three design partners agreed to paid pilots inside ten days.',
      causalTargets: ['demandStrength', 'evidenceMomentum', 'marketTailwind'],
      beliefTargets: ['thesisConfidence', 'uncertaintyLevel', 'evidenceClarity'],
    });
    const rerunScenario = compileScenario({
      ...baseScenarioInput,
      evidence: [positiveEvidence],
    });

    expect(rerunScenario.initialState.beliefState.thesisConfidence)
      .toBeGreaterThan(baselineScenario.initialState.beliefState.thesisConfidence);
    expect(rerunScenario.initialState.beliefState.uncertaintyLevel)
      .toBeLessThan(baselineScenario.initialState.beliefState.uncertaintyLevel);
    expect(rerunScenario.decisionFrame?.contextSummary).toContain('Evidence incorporated');
  });

  test('negative runway evidence produces a different top recommendation on rerun', () => {
    const baselineScenario = compileScenario(baseScenarioInput);
    const rerunScenario = compileScenario({
      ...baseScenarioInput,
      evidence: [
        createEvidence({
          id: 'evidence-runway',
          uncertainty: 'How much runway exists before the thesis must prove itself?',
          focusMetric: 'burnRate',
          recommendedExperiment: 'Stress-test the downside with a conservative runway model.',
          result: 'negative',
          observedSignal: 'The downside model showed one weak month would force a panic retreat.',
          causalTargets: ['runwayStress', 'reversibilityPressure'],
          beliefTargets: ['downsideSalience', 'uncertaintyLevel', 'reversibilityConfidence'],
        }),
      ],
    });

    const baselineIntelligence = buildDecisionIntelligence([
      makeCloneResult(baselineScenario, 'base-success-1', 1, {
        capital: 33_000,
        happiness: 0.76,
        health: 0.81,
        evidenceQuality: 0.84,
        executionQuality: 0.73,
        burnRate: 0.28,
        optionalityPreserved: 0.64,
        socialPressure: 0.26,
        thesisConfidence: 0.76,
        uncertaintyLevel: 0.3,
        commitmentLockIn: 0.5,
        socialPressureLoad: 0.28,
        downsideSalience: 0.28,
      }),
      makeCloneResult(baselineScenario, 'base-success-2', 1, {
        capital: 30_000,
        happiness: 0.73,
        health: 0.78,
        evidenceQuality: 0.79,
        executionQuality: 0.7,
        burnRate: 0.31,
        optionalityPreserved: 0.61,
        socialPressure: 0.29,
        thesisConfidence: 0.71,
        uncertaintyLevel: 0.34,
        commitmentLockIn: 0.52,
        socialPressureLoad: 0.3,
        downsideSalience: 0.3,
      }),
      makeCloneResult(baselineScenario, 'base-failure-1', 0, {
        capital: 10_000,
        happiness: 0.38,
        health: 0.49,
        evidenceQuality: 0.31,
        executionQuality: 0.55,
        burnRate: 0.55,
        optionalityPreserved: 0.39,
        socialPressure: 0.48,
        thesisConfidence: 0.31,
        uncertaintyLevel: 0.78,
        commitmentLockIn: 0.63,
        socialPressureLoad: 0.5,
        downsideSalience: 0.6,
      }),
      makeCloneResult(baselineScenario, 'base-failure-2', 0, {
        capital: 11_500,
        happiness: 0.41,
        health: 0.53,
        evidenceQuality: 0.35,
        executionQuality: 0.52,
        burnRate: 0.58,
        optionalityPreserved: 0.41,
        socialPressure: 0.46,
        thesisConfidence: 0.34,
        uncertaintyLevel: 0.74,
        commitmentLockIn: 0.61,
        socialPressureLoad: 0.48,
        downsideSalience: 0.56,
      }),
    ], baselineScenario.decisionFrame);

    const rerunIntelligence = buildDecisionIntelligence([
      makeCloneResult(rerunScenario, 'rerun-success-1', 1, {
        capital: 27_000,
        happiness: 0.71,
        health: 0.77,
        evidenceQuality: 0.65,
        executionQuality: 0.69,
        burnRate: 0.19,
        optionalityPreserved: 0.67,
        socialPressure: 0.27,
        thesisConfidence: 0.62,
        uncertaintyLevel: 0.34,
        commitmentLockIn: 0.44,
        socialPressureLoad: 0.28,
        downsideSalience: 0.25,
      }),
      makeCloneResult(rerunScenario, 'rerun-success-2', 1, {
        capital: 25_000,
        happiness: 0.68,
        health: 0.74,
        evidenceQuality: 0.63,
        executionQuality: 0.66,
        burnRate: 0.23,
        optionalityPreserved: 0.63,
        socialPressure: 0.29,
        thesisConfidence: 0.58,
        uncertaintyLevel: 0.37,
        commitmentLockIn: 0.42,
        socialPressureLoad: 0.29,
        downsideSalience: 0.29,
      }),
      makeCloneResult(rerunScenario, 'rerun-failure-1', 0, {
        capital: 8_000,
        happiness: 0.35,
        health: 0.46,
        evidenceQuality: 0.6,
        executionQuality: 0.54,
        burnRate: 0.79,
        optionalityPreserved: 0.2,
        socialPressure: 0.44,
        thesisConfidence: 0.24,
        uncertaintyLevel: 0.66,
        commitmentLockIn: 0.67,
        socialPressureLoad: 0.49,
        downsideSalience: 0.81,
      }),
      makeCloneResult(rerunScenario, 'rerun-failure-2', 0, {
        capital: 9_000,
        happiness: 0.37,
        health: 0.48,
        evidenceQuality: 0.61,
        executionQuality: 0.56,
        burnRate: 0.83,
        optionalityPreserved: 0.18,
        socialPressure: 0.47,
        thesisConfidence: 0.27,
        uncertaintyLevel: 0.63,
        commitmentLockIn: 0.69,
        socialPressureLoad: 0.52,
        downsideSalience: 0.79,
      }),
    ], rerunScenario.decisionFrame);

    expect(baselineIntelligence.recommendedExperiments[0].focusMetric).toBe('evidenceQuality');
    expect(rerunIntelligence.recommendedExperiments[0].focusMetric).toBe('burnRate');
    expect(rerunIntelligence.recommendedExperiments[0].recommendedExperiment.toLowerCase()).toContain('runway');
    expect(rerunScenario.decisionFrame?.keyUnknowns)
      .not.toContain('How much runway exists before the thesis must prove itself?');
    expect(
      rerunScenario.decisionFrame?.keyUnknowns.some((entry) => entry.includes('Does the decision still survive')),
    ).toBe(true);
  });
});
