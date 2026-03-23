import { describe, expect, test } from 'vitest';
import { buildDecideJsonPayload } from '../src/cli/commands/decide.js';
import type { AggregatedResults } from '../src/simulation/types.js';

function makeResults(): AggregatedResults {
  return {
    scenarioId: 'startup_founding',
    cloneCount: 200,
    histograms: [],
    timeline: {
      months: [],
      metrics: {},
    },
    outcomeDistribution: {
      success: 0.52,
      failure: 0.28,
      neutral: 0.20,
      byCategory: {
        edge: { success: 0.1, failure: 0.02, neutral: 0.01 },
        typical: { success: 0.32, failure: 0.18, neutral: 0.12 },
        central: { success: 0.1, failure: 0.08, neutral: 0.07 },
      },
    },
    statistics: {
      meanCapital: 125000,
      medianCapital: 90000,
      meanHealth: 0.71,
      meanHappiness: 0.66,
      successRate: 0.52,
      averageDuration: 18,
    },
    stratifiedBreakdown: {
      edge: { count: 20, avgOutcome: 0.81 },
      typical: { count: 140, avgOutcome: 0.49 },
      central: { count: 40, avgOutcome: 0.54 },
    },
    decisionIntelligence: {
      summary: 'The biggest unresolved variable is whether early demand is durable.',
      dominantUncertainties: [
        'Will early pilot demand convert into repeat usage?',
        'Can execution quality stay high under stress?',
      ],
      recommendedExperiments: [
        {
          priority: 'highest',
          focusMetric: 'demandStrength',
          uncertainty: 'Will early pilot demand convert into repeat usage?',
          whyItMatters: 'Demand durability separates the best and worst outcomes.',
          recommendedExperiment: 'Run a two-week paid pilot with explicit renewal asks.',
          successSignal: 'At least two users renew or extend.',
          stopSignal: 'Usage stalls after initial onboarding.',
          learningValue: 0.88,
          causalTargets: ['demandStrength'],
          beliefTargets: ['thesisConfidence', 'uncertaintyLevel'],
        },
      ],
    },
    rerunComparison: {
      sourceSimulationId: 'sim-001',
      evidenceCount: 1,
      summary: 'Confidence increased after a positive pilot.',
      beliefDelta: {
        thesisConfidence: 0.08,
        uncertaintyLevel: -0.11,
        downsideSalience: -0.04,
      },
      recommendationDelta: {
        changed: true,
        previousTopUncertainty: 'Will early pilot demand convert into repeat usage?',
        newTopUncertainty: 'Can execution quality stay high under stress?',
        previousTopExperiment: 'Run a two-week paid pilot with explicit renewal asks.',
        newTopExperiment: 'Stress-test the team with a constrained delivery sprint.',
      },
    },
  };
}

describe('decide command', () => {
  test('builds an async polling payload when the simulation is queued', () => {
    const payload = buildDecideJsonPayload({
      simulation: {
        simulationId: 'sim-123',
        status: 'pending',
        cloneCount: 200,
        scenarioType: 'startup_founding',
        name: 'Should I quit my job to build this?',
      },
      mode: 'standard',
    });

    expect(payload).toEqual({
      ok: true,
      simulation: {
        id: 'sim-123',
        name: 'Should I quit my job to build this?',
        scenarioType: 'startup_founding',
        status: 'pending',
        cloneCount: 200,
        mode: 'standard',
      },
      poll: {
        progressCommand: 'monte simulate progress sim-123 --json',
        resultsCommand: 'monte simulate results sim-123 -f json',
      },
    });
  });

  test('builds a completed decision bundle when results are available', () => {
    const results = makeResults();
    const payload = buildDecideJsonPayload({
      simulation: {
        simulationId: 'sim-456',
        status: 'completed',
        cloneCount: 200,
        scenarioType: 'startup_founding',
        name: 'Should I quit my job to build this?',
      },
      mode: 'standard',
      results,
    });

    expect(payload.ok).toBe(true);
    expect(payload.simulation).toEqual({
      id: 'sim-456',
      name: 'Should I quit my job to build this?',
      scenarioType: 'startup_founding',
      status: 'completed',
      cloneCount: 200,
      mode: 'standard',
    });
    expect(payload.decision).toMatchObject({
      summary: 'The biggest unresolved variable is whether early demand is durable.',
      successRate: 0.52,
      failureRate: 0.28,
      neutralRate: 0.2,
      meanCapital: 125000,
      meanHealth: 0.71,
      meanHappiness: 0.66,
      topUncertainties: [
        'Will early pilot demand convert into repeat usage?',
        'Can execution quality stay high under stress?',
      ],
      rerunComparison: results.rerunComparison,
    });
    expect(payload.results).toEqual(results);
  });
});
