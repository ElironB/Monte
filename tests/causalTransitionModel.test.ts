import { afterEach, describe, expect, test, vi } from 'vitest';
import { applyExternalCausalTransition, createDefaultCausalState } from '../src/simulation/causalModel.js';
import { SimulationEngine } from '../src/simulation/engine.js';
import { compileScenario } from '../src/simulation/scenarioCompiler.js';
import { cloneSimulationState, refreshBeliefState } from '../src/simulation/state.js';
import type { CloneParameters } from '../src/simulation/types.js';
import { ScenarioType } from '../src/simulation/types.js';

const baselineParameters: CloneParameters = {
  riskTolerance: 0.52,
  timePreference: 0.48,
  socialDependency: 0.46,
  learningStyle: 0.55,
  decisionSpeed: 0.5,
  emotionalVolatility: 0.42,
  executionGap: 0.28,
  informationSeeking: 0.62,
  stressResponse: 0.44,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('causal transition model', () => {
  test('seeds harsher decisions with more runway stress and reversibility pressure', () => {
    const softScenario = compileScenario({
      scenarioType: ScenarioType.CUSTOM,
      name: 'Soft reversible test',
      capitalAtRisk: 8_000,
      parameters: {
        timeframe: 18,
        runwayMonths: 18,
        reversibilityScore: 0.82,
        socialExposure: 0.28,
        keyUnknowns: [
          'Will users finish the pilot?',
          'Can the test run without leaving the day job?',
        ],
      },
    });

    const harshScenario = compileScenario({
      scenarioType: ScenarioType.CUSTOM,
      name: 'High-pressure commitment',
      capitalAtRisk: 45_000,
      parameters: {
        timeframe: 18,
        runwayMonths: 6,
        reversibilityScore: 0.22,
        socialExposure: 0.72,
        keyUnknowns: [
          'Will customers pay fast enough to stop the burn?',
          'Can the team execute under pressure?',
          'How much identity cost is created if this fails publicly?',
        ],
      },
    });

    expect(harshScenario.initialState.causalState.runwayStress).toBeGreaterThan(
      softScenario.initialState.causalState.runwayStress,
    );
    expect(harshScenario.initialState.causalState.reversibilityPressure).toBeGreaterThan(
      softScenario.initialState.causalState.reversibilityPressure,
    );
    expect(harshScenario.initialState.metrics.burnRate).toBeGreaterThan(
      softScenario.initialState.metrics.burnRate,
    );
  });

  test('same graph resolves differently under favorable versus hostile causal priors', async () => {
    const scenario = compileScenario({
      scenarioType: ScenarioType.CUSTOM,
      name: 'OpenClaw evidence loop',
      capitalAtRisk: 18_000,
      parameters: {
        timeframe: 18,
        runwayMonths: 12,
        fallbackPlan: 'keep consulting two days a week',
        keyUnknowns: [
          'Will design partners pay to pilot OpenClaw?',
          'Can you ship every week under pressure?',
          'How much optionality disappears if you hire too early?',
        ],
      },
    });

    const favorableStart = refreshBeliefState({
      ...cloneSimulationState(scenario.initialState),
      causalState: createDefaultCausalState({
        demandStrength: 0.84,
        executionCapacity: 0.8,
        runwayStress: 0.22,
        marketTailwind: 0.72,
        socialLegitimacy: 0.74,
        reversibilityPressure: 0.28,
        evidenceMomentum: 0.76,
      }),
    });

    const hostileStart = refreshBeliefState({
      ...cloneSimulationState(scenario.initialState),
      causalState: createDefaultCausalState({
        demandStrength: 0.22,
        executionCapacity: 0.3,
        runwayStress: 0.8,
        marketTailwind: 0.28,
        socialLegitimacy: 0.26,
        reversibilityPressure: 0.78,
        evidenceMomentum: 0.24,
      }),
    });

    const engine = new SimulationEngine(scenario, { useLLM: false, useChaos: false });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const favorable = await engine.executeClone(
      'favorable-world',
      baselineParameters,
      { percentile: 75, category: 'typical' },
      favorableStart,
    );
    const hostile = await engine.executeClone(
      'hostile-world',
      baselineParameters,
      { percentile: 75, category: 'typical' },
      hostileStart,
    );

    expect(favorable.finalState.events.some((event) => event.outcomeId === 'early_traction')).toBe(true);
    expect(favorable.finalState.events.map((event) => event.outcomeId)).not.toEqual(
      hostile.finalState.events.map((event) => event.outcomeId),
    );
    expect(favorable.finalState.metrics.progressRate).toBeGreaterThan(hostile.finalState.metrics.progressRate);
    expect(favorable.finalState.beliefState.thesisConfidence).toBeGreaterThan(
      hostile.finalState.beliefState.thesisConfidence,
    );
  });

  test('external shocks degrade derived metrics and beliefs through causal state', () => {
    const scenario = compileScenario({
      scenarioType: ScenarioType.CUSTOM,
      name: 'Shock sensitivity',
      capitalAtRisk: 15_000,
      parameters: {
        timeframe: 12,
        runwayMonths: 10,
        reversibilityScore: 0.5,
      },
    });

    const baseline = refreshBeliefState(cloneSimulationState(scenario.initialState));
    const shocked = cloneSimulationState(baseline);
    applyExternalCausalTransition(shocked, 'market_crash');
    const refreshed = refreshBeliefState(shocked);

    expect(refreshed.causalState.marketTailwind).toBeLessThan(baseline.causalState.marketTailwind);
    expect(refreshed.metrics.burnRate).toBeGreaterThan(baseline.metrics.burnRate);
    expect(refreshed.beliefState.thesisConfidence).toBeLessThan(baseline.beliefState.thesisConfidence);
  });
});
