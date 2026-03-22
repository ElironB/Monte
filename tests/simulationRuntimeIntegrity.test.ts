import { afterEach, describe, expect, test, vi } from 'vitest';
import { ChaosInjector } from '../src/simulation/chaosInjector.js';
import { getScenario } from '../src/simulation/decisionGraph.js';
import { SimulationEngine } from '../src/simulation/engine.js';
import { buildSimulationPersonaRuntimeProfile } from '../src/simulation/personaRuntime.js';
import { applyEffectsToState } from '../src/simulation/state.js';
import { ScenarioType, type CloneParameters } from '../src/simulation/types.js';

const aggressiveParameters: CloneParameters = {
  riskTolerance: 0.92,
  timePreference: 0.72,
  socialDependency: 0.28,
  learningStyle: 0.35,
  decisionSpeed: 0.86,
  emotionalVolatility: 0.74,
  executionGap: 0.22,
  informationSeeking: 0.32,
  stressResponse: 0.24,
  confidenceScores: {
    riskTolerance: 0.9,
    decisionSpeed: 0.84,
    informationSeeking: 0.78,
  },
};

const cautiousParameters: CloneParameters = {
  riskTolerance: 0.18,
  timePreference: 0.24,
  socialDependency: 0.74,
  learningStyle: 0.82,
  decisionSpeed: 0.24,
  emotionalVolatility: 0.38,
  executionGap: 0.18,
  informationSeeking: 0.88,
  stressResponse: 0.68,
  confidenceScores: {
    riskTolerance: 0.86,
    decisionSpeed: 0.8,
    informationSeeking: 0.9,
  },
  psychologyModifiers: {
    socialPressureSensitivity: 1.2,
    capitulationThreshold: 0.42,
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('simulation runtime integrity', () => {
  test('does not mutate the scenario initial state while clones execute', async () => {
    const scenario = getScenario(ScenarioType.CUSTOM);
    const engine = new SimulationEngine(scenario, { useLLM: false, useChaos: false });

    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    await engine.executeClone('clone-isolation', aggressiveParameters, {
      percentile: 50,
      category: 'typical',
    });

    expect(scenario.initialState.decisions).toHaveLength(0);
    expect(scenario.initialState.events).toHaveLength(0);
    expect(scenario.initialState.metrics.progressRate).toBe(0);
    expect(scenario.initialState.metrics.optionalityPreserved).toBe(1);
  });

  test('applies percentage capital effects consistently across shared state and chaos paths', () => {
    const state = getScenario(ScenarioType.CUSTOM).initialState;
    state.capital = 1_000;

    const increased = applyEffectsToState(state, [
      { target: 'capital', delta: 0.25, type: 'percentage' },
    ]);
    const decreased = new ChaosInjector().applyEvent(state, {
      id: 'test-chaos',
      type: 'market_crash',
      name: 'Test Chaos',
      description: 'Synthetic test event',
      baseProbability: 0,
      impact: [{ target: 'capital', delta: -0.4, type: 'percentage' }],
    });

    expect(increased.capital).toBe(1_250);
    expect(decreased.capital).toBe(600);
    expect(state.capital).toBe(1_000);
  });

  test('opposite personas take materially different paths through the hard-decision scenario', async () => {
    const scenario = getScenario(ScenarioType.CUSTOM);
    const engine = new SimulationEngine(scenario, { useLLM: false, useChaos: false });

    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const aggressive = await engine.executeClone('aggressive', aggressiveParameters, {
      percentile: 95,
      category: 'edge',
    });
    const cautious = await engine.executeClone('cautious', cautiousParameters, {
      percentile: 5,
      category: 'edge',
    });

    expect(aggressive.path).not.toEqual(cautious.path);
  });

  test('runtime persona projection separates aggressive and cautious world baselines', () => {
    const aggressiveProfile = buildSimulationPersonaRuntimeProfile(aggressiveParameters);
    const cautiousProfile = buildSimulationPersonaRuntimeProfile(cautiousParameters);

    expect(aggressiveProfile.investmentAggressiveness).toBeGreaterThan(cautiousProfile.investmentAggressiveness);
    expect(cautiousProfile.informationDepth).toBeGreaterThan(aggressiveProfile.informationDepth);
    expect(cautiousProfile.supportNetworkSize).toBeGreaterThan(aggressiveProfile.supportNetworkSize);
  });
});
