import { afterEach, describe, expect, test, vi } from 'vitest';
import { SimulationEngine } from '../src/simulation/engine.js';
import { buildDecisionIntelligence } from '../src/simulation/experimentPlanner.js';
import { compileScenario } from '../src/simulation/scenarioCompiler.js';
import { cloneSimulationState } from '../src/simulation/state.js';
import type { CloneResult, CloneParameters, DecisionNode } from '../src/simulation/types.js';
import { ScenarioType } from '../src/simulation/types.js';

const aggressiveParameters: CloneParameters = {
  riskTolerance: 0.9,
  timePreference: 0.72,
  socialDependency: 0.24,
  learningStyle: 0.36,
  decisionSpeed: 0.84,
  emotionalVolatility: 0.7,
  executionGap: 0.24,
  informationSeeking: 0.34,
  stressResponse: 0.26,
};

const cautiousParameters: CloneParameters = {
  riskTolerance: 0.2,
  timePreference: 0.24,
  socialDependency: 0.76,
  learningStyle: 0.84,
  decisionSpeed: 0.24,
  emotionalVolatility: 0.36,
  executionGap: 0.18,
  informationSeeking: 0.9,
  stressResponse: 0.66,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('decision intelligence foundation', () => {
  test('compiles custom decision context into a parameterized scenario frame', () => {
    const scenario = compileScenario({
      scenarioType: ScenarioType.CUSTOM,
      name: 'OpenClaw runway bet',
      capitalAtRisk: 18_000,
      parameters: {
        primaryQuestion: 'Should you commit the next 18 months to OpenClaw?',
        timeframe: 18,
        runwayMonths: 14,
        fallbackPlan: 'keep consulting two days a week',
        keyUnknowns: [
          'Will design partners pay to pilot OpenClaw?',
          'Can you ship every week under pressure?',
          'How much optionality disappears if you hire too early?',
        ],
        reversibilityScore: 0.42,
        socialExposure: 0.68,
      },
    });

    expect(scenario.decisionFrame?.runwayMonths).toBe(14);
    expect(scenario.initialState.metrics.decisionCapitalAtRisk).toBe(18_000);
    expect(scenario.initialState.beliefState.uncertaintyLevel).toBeGreaterThan(0.4);
    expect((scenario.graph[0] as DecisionNode).prompt).toContain('OpenClaw');
    expect((scenario.graph[0] as DecisionNode).prompt).toContain('keep consulting two days a week');
  });

  test('opposite personas end with materially different belief states on the same compiled decision', async () => {
    const scenario = compileScenario({
      scenarioType: ScenarioType.CUSTOM,
      name: 'OpenClaw runway bet',
      capitalAtRisk: 18_000,
      parameters: {
        timeframe: 18,
        runwayMonths: 12,
        fallbackPlan: 'keep consulting two days a week',
        keyUnknowns: [
          'Will design partners pay to pilot OpenClaw?',
          'Can you ship every week under pressure?',
        ],
      },
    });
    const engine = new SimulationEngine(scenario, { useLLM: false, useChaos: false });

    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const aggressive = await engine.executeClone('aggressive-beliefs', aggressiveParameters, {
      percentile: 95,
      category: 'edge',
    });
    const cautious = await engine.executeClone('cautious-beliefs', cautiousParameters, {
      percentile: 5,
      category: 'edge',
    });

    expect(aggressive.finalState.beliefState.commitmentLockIn).not.toBe(cautious.finalState.beliefState.commitmentLockIn);
    expect(aggressive.finalState.beliefState.thesisConfidence).not.toBe(cautious.finalState.beliefState.thesisConfidence);
    expect(aggressive.finalState.beliefState.updateNarrative).not.toEqual(cautious.finalState.beliefState.updateNarrative);
  });

  test('experiment planner turns clone divergence into ranked next-step experiments', () => {
    const scenario = compileScenario({
      scenarioType: ScenarioType.CUSTOM,
      name: 'OpenClaw runway bet',
      capitalAtRisk: 18_000,
      parameters: {
        fallbackPlan: 'keep consulting two days a week',
        keyUnknowns: [
          'Will design partners pay to pilot OpenClaw?',
          'Can you ship every week under pressure?',
          'How much optionality disappears if you hire too early?',
        ],
      },
    });

    const makeClone = (
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
      },
    ): CloneResult => {
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
      };

      return {
        cloneId,
        parameters: aggressiveParameters,
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
        },
        duration: 0,
      };
    };

    const intelligence = buildDecisionIntelligence([
      makeClone('success-1', 1, {
        capital: 34_000,
        happiness: 0.78,
        health: 0.82,
        evidenceQuality: 0.82,
        executionQuality: 0.84,
        burnRate: 0.22,
        optionalityPreserved: 0.72,
        socialPressure: 0.24,
        thesisConfidence: 0.76,
        uncertaintyLevel: 0.28,
        commitmentLockIn: 0.48,
        socialPressureLoad: 0.24,
      }),
      makeClone('success-2', 1, {
        capital: 31_000,
        happiness: 0.74,
        health: 0.79,
        evidenceQuality: 0.78,
        executionQuality: 0.8,
        burnRate: 0.24,
        optionalityPreserved: 0.69,
        socialPressure: 0.28,
        thesisConfidence: 0.72,
        uncertaintyLevel: 0.32,
        commitmentLockIn: 0.5,
        socialPressureLoad: 0.26,
      }),
      makeClone('failure-1', 0, {
        capital: 9_000,
        happiness: 0.36,
        health: 0.48,
        evidenceQuality: 0.28,
        executionQuality: 0.34,
        burnRate: 0.72,
        optionalityPreserved: 0.22,
        socialPressure: 0.7,
        thesisConfidence: 0.24,
        uncertaintyLevel: 0.82,
        commitmentLockIn: 0.82,
        socialPressureLoad: 0.74,
      }),
      makeClone('failure-2', 0, {
        capital: 11_000,
        happiness: 0.4,
        health: 0.52,
        evidenceQuality: 0.32,
        executionQuality: 0.38,
        burnRate: 0.68,
        optionalityPreserved: 0.26,
        socialPressure: 0.66,
        thesisConfidence: 0.28,
        uncertaintyLevel: 0.78,
        commitmentLockIn: 0.8,
        socialPressureLoad: 0.69,
      }),
    ], scenario.decisionFrame);

    expect(intelligence.summary).toContain('OpenClaw runway bet');
    expect(intelligence.recommendedExperiments).toHaveLength(3);
    expect(intelligence.recommendedExperiments[0].priority).toBe('highest');
    expect(intelligence.recommendedExperiments[0].learningValue).toBeGreaterThan(0.1);
    expect(intelligence.recommendedExperiments[0].recommendedExperiment.toLowerCase()).toMatch(
      /evidence|execution|runway|fallback/,
    );
  });
});
