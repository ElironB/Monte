import { describe, expect, test } from 'vitest';
import { compileScenario } from '../src/simulation/scenarioCompiler.js';
import {
  buildCompletedSimulationGraphSnapshot,
  buildLiveSimulationGraphSnapshot,
  buildSimulationGraphStructure,
  mergeSimulationGraphSnapshots,
} from '../src/simulation/graphSnapshot.js';
import type {
  CloneResult,
  Scenario,
  SimulationState,
} from '../src/simulation/types.js';
import { ScenarioType } from '../src/simulation/types.js';

function createState(overrides: Partial<SimulationState> = {}): SimulationState {
  return {
    capital: 10_000,
    health: 0.8,
    happiness: 0.7,
    timeElapsed: 1,
    decisions: [],
    events: [],
    metrics: {},
    beliefState: {
      thesisConfidence: 0.5,
      uncertaintyLevel: 0.5,
      evidenceClarity: 0.5,
      reversibilityConfidence: 0.5,
      commitmentLockIn: 0.5,
      socialPressureLoad: 0.3,
      downsideSalience: 0.4,
      learningVelocity: 0.5,
      latestSignal: 'neutral',
      updateNarrative: 'steady',
    },
    causalState: {
      demandStrength: 0.5,
      executionCapacity: 0.5,
      runwayStress: 0.4,
      marketTailwind: 0.5,
      socialLegitimacy: 0.4,
      reversibilityPressure: 0.3,
      evidenceMomentum: 0.5,
    },
    ...overrides,
  };
}

function createSimpleScenario(): Scenario {
  return {
    id: 'custom',
    name: 'Simple graph',
    description: 'Simple graph for tests',
    timeframe: '12 months',
    entryNodeId: 'start',
    initialState: createState(),
    graph: [
      {
        id: 'start',
        type: 'decision',
        prompt: 'Do you stage the move or commit immediately?',
        options: [
          { id: 'test', label: 'Stage a small pilot', value: 'test', nextNodeId: 'pilot' },
          { id: 'commit', label: 'Commit now', value: 'commit', nextNodeId: 'failure' },
        ],
      },
      {
        id: 'pilot',
        type: 'event',
        name: 'Pilot feedback',
        description: 'Reality arrives with signal quality.',
        probability: 1,
        outcomes: [
          { id: 'yes', label: 'Pilot confirms the thesis', effects: [], nextNodeId: 'success' },
          { id: 'mixed', label: 'Pilot is still ambiguous', effects: [], nextNodeId: 'neutral' },
        ],
      },
      {
        id: 'success',
        type: 'outcome',
        results: { outcome: 'success' },
      },
      {
        id: 'neutral',
        type: 'outcome',
        results: { outcome: 'neutral' },
      },
      {
        id: 'failure',
        type: 'outcome',
        results: { outcome: 'failure' },
      },
    ],
  };
}

describe('simulation graph snapshots', () => {
  test('builds structure from compiled custom scenarios with parameterized copy', () => {
    const scenario = compileScenario({
      scenarioType: ScenarioType.CUSTOM,
      name: 'OpenClaw runway bet',
      capitalAtRisk: 18_000,
      parameters: {
        primaryQuestion: 'Should you commit the next 18 months to OpenClaw?',
        fallbackPlan: 'keep consulting two days a week',
      },
    });

    const structure = buildSimulationGraphStructure(scenario);
    expect(structure.entryNodeId).toBe('start');
    expect(structure.nodes.length).toBeGreaterThan(5);
    expect(structure.edges.some((edge) => edge.kind === 'decision')).toBe(true);
    expect(structure.nodes[0]?.detail).toContain('OpenClaw');
  });

  test('aggregates completed clone visits and transitions', () => {
    const structure = buildSimulationGraphStructure(createSimpleScenario());
    const results: CloneResult[] = [
      {
        cloneId: 'clone-success',
        parameters: {} as any,
        stratification: { percentile: 95, category: 'edge' },
        path: ['start', 'pilot', 'success'],
        finalState: createState({
          decisions: [{
            nodeId: 'start',
            choice: 'test',
            timestamp: 1,
            evaluatedByLLM: false,
          }],
          events: [{
            nodeId: 'pilot',
            occurred: true,
            outcomeId: 'yes',
            timestamp: 2,
            source: 'graph',
          }],
        }),
        metrics: { outcomeValue: 1 },
        duration: 100,
      },
      {
        cloneId: 'clone-failure',
        parameters: {} as any,
        stratification: { percentile: 50, category: 'typical' },
        path: ['start', 'failure'],
        finalState: createState({
          decisions: [{
            nodeId: 'start',
            choice: 'commit',
            timestamp: 1,
            evaluatedByLLM: false,
          }],
        }),
        metrics: { outcomeValue: 0 },
        duration: 100,
      },
    ];

    const snapshot = buildCompletedSimulationGraphSnapshot(structure, results, 12);
    const startStats = snapshot.nodes.find((node) => node.nodeId === 'start');
    const pilotStats = snapshot.nodes.find((node) => node.nodeId === 'pilot');
    const stagedEdge = snapshot.edges.find((edge) => edge.edgeId === 'decision:start:test');
    const commitEdge = snapshot.edges.find((edge) => edge.edgeId === 'decision:start:commit');
    const pilotEdge = snapshot.edges.find((edge) => edge.edgeId === 'event:pilot:yes');

    expect(snapshot.mode).toBe('completed');
    expect(snapshot.completedClones).toBe(2);
    expect(startStats).toMatchObject({
      visitCount: 2,
      completedCount: 2,
      successCount: 1,
      failureCount: 1,
    });
    expect(pilotStats?.visitCount).toBe(1);
    expect(stagedEdge?.transitionCount).toBe(1);
    expect(commitEdge?.transitionCount).toBe(1);
    expect(pilotEdge?.transitionCount).toBe(1);
  });

  test('builds live snapshots with active occupancy and waiting counts', () => {
    const structure = buildSimulationGraphStructure(createSimpleScenario());
    const completedResults: CloneResult[] = [
      {
        cloneId: 'clone-success',
        parameters: {} as any,
        stratification: { percentile: 90, category: 'edge' },
        path: ['start', 'pilot', 'success'],
        finalState: createState({
          decisions: [{
            nodeId: 'start',
            choice: 'test',
            timestamp: 1,
            evaluatedByLLM: false,
          }],
          events: [{
            nodeId: 'pilot',
            occurred: true,
            outcomeId: 'yes',
            timestamp: 2,
            source: 'graph',
          }],
        }),
        metrics: { outcomeValue: 1 },
        duration: 100,
      },
    ];

    const liveSnapshot = buildLiveSimulationGraphSnapshot({
      structure,
      cloneCount: 2,
      completedResults,
      activeTraces: [
        {
          cloneId: 'clone-live',
          category: 'central',
          currentNodeId: 'pilot',
          pathNodeIds: ['start'],
          state: createState({
            decisions: [{
              nodeId: 'start',
              choice: 'test',
              timestamp: 1,
              evaluatedByLLM: false,
            }],
          }),
        },
      ],
      waitingNodeIds: ['pilot'],
      sampledTraceLimit: 12,
    });

    const pilotStats = liveSnapshot.nodes.find((node) => node.nodeId === 'pilot');
    const stagedEdge = liveSnapshot.edges.find((edge) => edge.edgeId === 'decision:start:test');

    expect(liveSnapshot.mode).toBe('live');
    expect(liveSnapshot.activeClones).toBe(1);
    expect(liveSnapshot.waitingClones).toBe(1);
    expect(pilotStats).toMatchObject({
      visitCount: 2,
      activeCount: 1,
      waitingCount: 1,
      completedCount: 1,
    });
    expect(stagedEdge?.transitionCount).toBe(2);
  });

  test('merges graph snapshots across batches', () => {
    const structure = buildSimulationGraphStructure(createSimpleScenario());
    const first = buildCompletedSimulationGraphSnapshot(structure, [{
      cloneId: 'batch-a',
      parameters: {} as any,
      stratification: { percentile: 90, category: 'edge' },
      path: ['start', 'failure'],
      finalState: createState({
        decisions: [{
          nodeId: 'start',
          choice: 'commit',
          timestamp: 1,
          evaluatedByLLM: false,
        }],
      }),
      metrics: { outcomeValue: 0 },
      duration: 10,
    }]);
    const second = buildLiveSimulationGraphSnapshot({
      structure,
      cloneCount: 1,
      completedResults: [],
      activeTraces: [{
        cloneId: 'batch-b',
        category: 'typical',
        currentNodeId: 'pilot',
        pathNodeIds: ['start'],
        state: createState({
          decisions: [{
            nodeId: 'start',
            choice: 'test',
            timestamp: 1,
            evaluatedByLLM: false,
          }],
        }),
      }],
      waitingNodeIds: ['pilot'],
    });

    const merged = mergeSimulationGraphSnapshots(structure, [first, second], 'live');
    const startStats = merged.nodes.find((node) => node.nodeId === 'start');

    expect(merged.cloneCount).toBe(2);
    expect(merged.completedClones).toBe(1);
    expect(merged.activeClones).toBe(1);
    expect(startStats?.visitCount).toBe(2);
    expect(merged.sampledTraces.length).toBe(2);
  });
});
