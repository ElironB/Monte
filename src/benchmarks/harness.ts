import { aggregateBatch } from '../simulation/resultAggregator.js';
import { compileScenario } from '../simulation/scenarioCompiler.js';
import { SimulationEngine } from '../simulation/engine.js';
import { cloneSimulationState, refreshBeliefState } from '../simulation/state.js';
import type {
  AggregatedResults,
  CausalState,
  CloneResult,
  DecisionFrame,
  EvidenceResult,
  GraphNode,
  Scenario,
} from '../simulation/types.js';
import {
  BENCHMARK_CASES,
  BENCHMARK_CLONE_PROFILES,
  BENCHMARK_FIXTURE_VERSION,
  type BenchmarkCaseFixture,
  type BenchmarkEvidenceFixture,
  type BenchmarkPolicyBaseline,
} from './fixtures.js';

const roundMetric = (value: number, decimals: number = 4): number => {
  return Number.parseFloat(value.toFixed(decimals));
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

export interface BenchmarkRunSummary {
  successRate: number;
  meanCapital: number;
  meanHealth: number;
  meanHappiness: number;
  meanBeliefConfidence: number;
  meanBeliefUncertainty: number;
  meanDownsideSalience: number;
  utilityScore: number;
  topFocusMetric?: string;
  topUncertainty?: string;
  topExperiment?: string;
}

export interface BenchmarkPolicyBaselineSummary {
  id: string;
  label: string;
  run: BenchmarkRunSummary;
}

export interface BenchmarkEvidenceSummary {
  id: string;
  title: string;
  baseline: BenchmarkRunSummary;
  rerun: BenchmarkRunSummary;
  uncertaintyReduction: number;
  confidenceShift: number;
  downsideShift: number;
  utilityShift: number;
  topRecommendationChanged: boolean;
  pass: boolean;
  failures: string[];
}

export interface BenchmarkStabilitySummary {
  repeats: number;
  maxDrift: number;
  identical: boolean;
  repeatedRuns: BenchmarkRunSummary[];
}

export interface BenchmarkCaseSummary {
  id: string;
  title: string;
  run: BenchmarkRunSummary;
  expectedSuccessRate: number;
  calibrationError: number;
  staticPolicyRegret: number;
  bestStaticBaseline?: BenchmarkPolicyBaselineSummary;
  policyBaselines: BenchmarkPolicyBaselineSummary[];
  evidenceCases: BenchmarkEvidenceSummary[];
  stability: BenchmarkStabilitySummary;
  pass: boolean;
  failures: string[];
}

export interface BenchmarkSuiteSummary {
  version: string;
  generatedAt: string;
  fixtureCount: number;
  caseSummaries: BenchmarkCaseSummary[];
  metrics: {
    meanCalibrationError: number;
    meanStaticPolicyRegret: number;
    meanUncertaintyReduction: number;
    maxStabilityDrift: number;
    passRate: number;
  };
  pass: boolean;
}

type ScenarioRunOutput = {
  aggregated: AggregatedResults;
  summary: BenchmarkRunSummary;
};

const DEFAULT_STABILITY_REPEATS = 3;

function cloneDecisionFrame(frame?: DecisionFrame): DecisionFrame | undefined {
  return frame ? (JSON.parse(JSON.stringify(frame)) as DecisionFrame) : undefined;
}

function cloneGraph(graph: GraphNode[]): GraphNode[] {
  return JSON.parse(JSON.stringify(graph)) as GraphNode[];
}

function cloneScenarioForHarness(scenario: Scenario): Scenario {
  return {
    ...scenario,
    initialState: cloneSimulationState(scenario.initialState),
    graph: cloneGraph(scenario.graph),
    decisionFrame: cloneDecisionFrame(scenario.decisionFrame),
  };
}

function applyDecisionOverrides(
  scenario: Scenario,
  decisionOverrides: Record<string, string>,
): Scenario {
  const nextScenario = cloneScenarioForHarness(scenario);

  nextScenario.graph = nextScenario.graph.map((node) => {
    if (node.type !== 'decision') {
      return node;
    }

    const forcedOptionId = decisionOverrides[node.id];
    if (!forcedOptionId) {
      return node;
    }

    const forcedOptions = node.options.filter((option) => option.id === forcedOptionId);
    if (forcedOptions.length === 0) {
      throw new Error(`Decision override ${node.id}:${forcedOptionId} was not found in the scenario graph.`);
    }

    return {
      ...node,
      options: forcedOptions,
    };
  });

  return nextScenario;
}

function buildStartingState(
  scenario: Scenario,
  causalBias?: Partial<Record<keyof CausalState, number>>,
): Scenario['initialState'] | undefined {
  if (!causalBias) {
    return undefined;
  }

  const startingState = cloneSimulationState(scenario.initialState);
  for (const [rawKey, rawDelta] of Object.entries(causalBias)) {
    const key = rawKey as keyof CausalState;
    const delta = rawDelta;

    if (typeof delta === 'number') {
      startingState.causalState[key] = clamp(startingState.causalState[key] + delta, 0, 1);
    }
  }

  return refreshBeliefState(startingState);
}

function hashSeed(input: string): number {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state += 0x6D2B79F5;
    let next = Math.imul(state ^ (state >>> 15), state | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
  };
}

async function withSeededRandom<T>(seedInput: string, fn: () => Promise<T>): Promise<T> {
  const originalRandom = Math.random;
  Math.random = createSeededRandom(hashSeed(seedInput));

  try {
    return await fn();
  } finally {
    Math.random = originalRandom;
  }
}

function buildRunSeed(
  fixture: BenchmarkCaseFixture,
  options: {
    evidence?: EvidenceResult[];
    decisionOverrides?: Record<string, string>;
  },
  profileId: string,
): string {
  const overrideKey = options.decisionOverrides
    ? Object.entries(options.decisionOverrides)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([nodeId, optionId]) => `${nodeId}:${optionId}`)
      .join('|')
    : 'default';
  const evidenceKey = options.evidence && options.evidence.length > 0
    ? options.evidence.map((entry) => entry.id).join('|')
    : 'baseline';

  return [
    BENCHMARK_FIXTURE_VERSION,
    fixture.id,
    profileId,
    overrideKey,
    evidenceKey,
  ].join('::');
}

function getHistogramMean(results: AggregatedResults, metric: string): number {
  return results.histograms.find((entry) => entry.metric === metric)?.mean ?? 0;
}

function computeUtilityScore(results: AggregatedResults, scenario: Scenario): number {
  const initialCapital = Math.max(1, scenario.initialState.capital);
  const capitalPreservation = results.statistics.meanCapital / initialCapital;
  const normalizedCapital = clamp(capitalPreservation, 0, 1.4) / 1.4;

  return roundMetric(
    (results.statistics.successRate * 0.45)
      + (normalizedCapital * 0.2)
      + (results.statistics.meanHappiness * 0.2)
      + (results.statistics.meanHealth * 0.15),
  );
}

function summarizeRun(results: AggregatedResults, scenario: Scenario): BenchmarkRunSummary {
  return {
    successRate: roundMetric(results.statistics.successRate),
    meanCapital: roundMetric(results.statistics.meanCapital, 2),
    meanHealth: roundMetric(results.statistics.meanHealth),
    meanHappiness: roundMetric(results.statistics.meanHappiness),
    meanBeliefConfidence: roundMetric(getHistogramMean(results, 'beliefConfidence')),
    meanBeliefUncertainty: roundMetric(getHistogramMean(results, 'beliefUncertainty')),
    meanDownsideSalience: roundMetric(getHistogramMean(results, 'beliefDownsideSalience')),
    utilityScore: computeUtilityScore(results, scenario),
    topFocusMetric: results.decisionIntelligence?.recommendedExperiments[0]?.focusMetric,
    topUncertainty: results.decisionIntelligence?.dominantUncertainties[0],
    topExperiment: results.decisionIntelligence?.recommendedExperiments[0]?.recommendedExperiment,
  };
}

async function executeScenarioRun(
  fixture: BenchmarkCaseFixture,
  options: {
    label: string;
    evidence?: EvidenceResult[];
    decisionOverrides?: Record<string, string>;
  },
): Promise<ScenarioRunOutput> {
  const compiledScenario = compileScenario({
    scenarioType: fixture.scenario.scenarioType,
    name: fixture.scenario.name,
    capitalAtRisk: fixture.scenario.capitalAtRisk,
    parameters: fixture.scenario.parameters,
    evidence: options.evidence,
  });
  const runnableScenario = options.decisionOverrides
    ? applyDecisionOverrides(compiledScenario, options.decisionOverrides)
    : compiledScenario;
  const engine = new SimulationEngine(runnableScenario, {
    useLLM: false,
    useChaos: false,
  });
  const startingState = buildStartingState(runnableScenario, fixture.causalBias);
  const cloneResults: CloneResult[] = [];
  for (const profile of BENCHMARK_CLONE_PROFILES) {
    cloneResults.push(
      await withSeededRandom(
        buildRunSeed(fixture, options, profile.id),
        () => engine.executeClone(
          `${fixture.id}:${options.label}:${profile.id}`,
          profile.parameters,
          profile.stratification,
          startingState,
        ),
      ),
    );
  }

  const aggregated = aggregateBatch(runnableScenario.id, cloneResults, runnableScenario.decisionFrame);

  return {
    aggregated,
    summary: summarizeRun(aggregated, runnableScenario),
  };
}

function didTopRecommendationChange(
  baseline: BenchmarkRunSummary,
  rerun: BenchmarkRunSummary,
): boolean {
  return baseline.topFocusMetric !== rerun.topFocusMetric
    || baseline.topUncertainty !== rerun.topUncertainty
    || baseline.topExperiment !== rerun.topExperiment;
}

async function evaluateEvidenceFixture(
  fixture: BenchmarkCaseFixture,
  baseline: ScenarioRunOutput,
  evidenceFixture: BenchmarkEvidenceFixture,
): Promise<BenchmarkEvidenceSummary> {
  const rerun = await executeScenarioRun(fixture, {
    label: `evidence:${evidenceFixture.id}`,
    evidence: evidenceFixture.evidence,
  });

  const uncertaintyReduction = roundMetric(
    baseline.summary.meanBeliefUncertainty - rerun.summary.meanBeliefUncertainty,
  );
  const confidenceShift = roundMetric(
    rerun.summary.meanBeliefConfidence - baseline.summary.meanBeliefConfidence,
  );
  const downsideShift = roundMetric(
    rerun.summary.meanDownsideSalience - baseline.summary.meanDownsideSalience,
  );
  const utilityShift = roundMetric(
    rerun.summary.utilityScore - baseline.summary.utilityScore,
  );
  const topRecommendationChanged = didTopRecommendationChange(baseline.summary, rerun.summary);

  const failures: string[] = [];
  if (uncertaintyReduction < evidenceFixture.expectations.minUncertaintyReduction) {
    failures.push(
      `uncertainty reduction ${uncertaintyReduction} was below ${evidenceFixture.expectations.minUncertaintyReduction}`,
    );
  }

  if (evidenceFixture.expectations.confidenceDirection === 'increase') {
    if (confidenceShift <= 0) {
      failures.push(`confidence shift ${confidenceShift} did not increase after evidence`);
    }
  } else if (evidenceFixture.expectations.confidenceDirection === 'decrease') {
    if (confidenceShift >= 0) {
      failures.push(`confidence shift ${confidenceShift} did not decrease after evidence`);
    }
  }

  if (
    typeof evidenceFixture.expectations.minAbsoluteConfidenceShift === 'number'
    && Math.abs(confidenceShift) < evidenceFixture.expectations.minAbsoluteConfidenceShift
  ) {
    failures.push(
      `absolute confidence shift ${Math.abs(confidenceShift)} was below ${evidenceFixture.expectations.minAbsoluteConfidenceShift}`,
    );
  }

  if (evidenceFixture.expectations.downsideDirection === 'increase' && downsideShift <= 0) {
    failures.push(`downside shift ${downsideShift} did not increase after evidence`);
  } else if (evidenceFixture.expectations.downsideDirection === 'decrease' && downsideShift >= 0) {
    failures.push(`downside shift ${downsideShift} did not decrease after evidence`);
  }

  if (
    evidenceFixture.expectations.allowedTopFocusMetrics
    && evidenceFixture.expectations.allowedTopFocusMetrics.length > 0
    && rerun.summary.topFocusMetric
    && !evidenceFixture.expectations.allowedTopFocusMetrics.includes(rerun.summary.topFocusMetric)
  ) {
    failures.push(
      `top focus metric ${rerun.summary.topFocusMetric} was not in ${evidenceFixture.expectations.allowedTopFocusMetrics.join(', ')}`,
    );
  }

  if (evidenceFixture.expectations.mustChangeTopRecommendation && !topRecommendationChanged) {
    failures.push('top recommendation did not change after evidence');
  }

  return {
    id: evidenceFixture.id,
    title: evidenceFixture.title,
    baseline: baseline.summary,
    rerun: rerun.summary,
    uncertaintyReduction,
    confidenceShift,
    downsideShift,
    utilityShift,
    topRecommendationChanged,
    pass: failures.length === 0,
    failures,
  };
}

function compareRunSummaries(
  baseline: BenchmarkRunSummary,
  repeatedRuns: BenchmarkRunSummary[],
): BenchmarkStabilitySummary {
  const drifts = repeatedRuns.map((run) => {
    return Math.max(
      Math.abs(run.successRate - baseline.successRate),
      Math.abs(run.utilityScore - baseline.utilityScore),
      Math.abs(run.meanBeliefConfidence - baseline.meanBeliefConfidence),
      Math.abs(run.meanBeliefUncertainty - baseline.meanBeliefUncertainty),
      run.topFocusMetric === baseline.topFocusMetric ? 0 : 1,
      run.topExperiment === baseline.topExperiment ? 0 : 1,
    );
  });

  const maxDrift = drifts.length > 0 ? Math.max(...drifts) : 0;
  return {
    repeats: repeatedRuns.length + 1,
    maxDrift: roundMetric(maxDrift),
    identical: maxDrift === 0,
    repeatedRuns,
  };
}

async function evaluateCase(fixture: BenchmarkCaseFixture): Promise<BenchmarkCaseSummary> {
  const baseRun = await executeScenarioRun(fixture, { label: 'baseline' });
  const policyBaselines: BenchmarkPolicyBaselineSummary[] = [];

  for (const baseline of fixture.policyBaselines) {
    const run = await executeScenarioRun(fixture, {
      label: `baseline:${baseline.id}`,
      decisionOverrides: baseline.decisionOverrides,
    });
    policyBaselines.push({
      id: baseline.id,
      label: baseline.label,
      run: run.summary,
    });
  }

  const bestStaticBaseline = policyBaselines
    .slice()
    .sort((left, right) => right.run.utilityScore - left.run.utilityScore)[0];
  const staticPolicyRegret = bestStaticBaseline
    ? roundMetric(bestStaticBaseline.run.utilityScore - baseRun.summary.utilityScore)
    : 0;

  const evidenceCases: BenchmarkEvidenceSummary[] = [];
  for (const evidenceFixture of fixture.evidenceFixtures ?? []) {
    evidenceCases.push(await evaluateEvidenceFixture(fixture, baseRun, evidenceFixture));
  }

  const repeatedRuns: BenchmarkRunSummary[] = [];
  for (let repeatIndex = 1; repeatIndex < DEFAULT_STABILITY_REPEATS; repeatIndex++) {
    const repeatRun = await executeScenarioRun(fixture, { label: `repeat:${repeatIndex}` });
    repeatedRuns.push(repeatRun.summary);
  }
  const stability = compareRunSummaries(baseRun.summary, repeatedRuns);

  const calibrationError = roundMetric(Math.abs(baseRun.summary.successRate - fixture.expectedSuccessRate));
  const failures: string[] = [];

  if (calibrationError > fixture.calibrationTolerance) {
    failures.push(
      `calibration error ${calibrationError} exceeded tolerance ${fixture.calibrationTolerance}`,
    );
  }

  if (staticPolicyRegret > fixture.maxStaticPolicyRegret) {
    failures.push(
      `static policy regret ${staticPolicyRegret} exceeded ${fixture.maxStaticPolicyRegret}`,
    );
  }

  if (!stability.identical) {
    failures.push(`deterministic stability drifted by ${stability.maxDrift}`);
  }

  for (const evidenceCase of evidenceCases) {
    if (!evidenceCase.pass) {
      failures.push(`evidence case ${evidenceCase.id} failed: ${evidenceCase.failures.join('; ')}`);
    }
  }

  return {
    id: fixture.id,
    title: fixture.title,
    run: baseRun.summary,
    expectedSuccessRate: fixture.expectedSuccessRate,
    calibrationError,
    staticPolicyRegret,
    bestStaticBaseline,
    policyBaselines,
    evidenceCases,
    stability,
    pass: failures.length === 0,
    failures,
  };
}

export async function runBenchmarkSuite(): Promise<BenchmarkSuiteSummary> {
  const caseSummaries: BenchmarkCaseSummary[] = [];
  for (const fixture of BENCHMARK_CASES) {
    caseSummaries.push(await evaluateCase(fixture));
  }

  const allEvidenceCases = caseSummaries.flatMap((entry) => entry.evidenceCases);
  const meanCalibrationError = caseSummaries.length > 0
    ? roundMetric(caseSummaries.reduce((sum, entry) => sum + entry.calibrationError, 0) / caseSummaries.length)
    : 0;
  const meanStaticPolicyRegret = caseSummaries.length > 0
    ? roundMetric(caseSummaries.reduce((sum, entry) => sum + entry.staticPolicyRegret, 0) / caseSummaries.length)
    : 0;
  const meanUncertaintyReduction = allEvidenceCases.length > 0
    ? roundMetric(allEvidenceCases.reduce((sum, entry) => sum + entry.uncertaintyReduction, 0) / allEvidenceCases.length)
    : 0;
  const maxStabilityDrift = caseSummaries.length > 0
    ? roundMetric(Math.max(...caseSummaries.map((entry) => entry.stability.maxDrift)))
    : 0;
  const passCount = caseSummaries.filter((entry) => entry.pass).length;
  const passRate = caseSummaries.length > 0
    ? roundMetric(passCount / caseSummaries.length)
    : 1;

  return {
    version: BENCHMARK_FIXTURE_VERSION,
    generatedAt: new Date().toISOString(),
    fixtureCount: caseSummaries.length,
    caseSummaries,
    metrics: {
      meanCalibrationError,
      meanStaticPolicyRegret,
      meanUncertaintyReduction,
      maxStabilityDrift,
      passRate,
    },
    pass: caseSummaries.every((entry) => entry.pass),
  };
}

export function formatBenchmarkSummary(summary: BenchmarkSuiteSummary): string {
  const lines: string[] = [];
  lines.push(`Benchmark suite ${summary.pass ? 'PASS' : 'FAIL'} (${summary.version})`);
  lines.push(`Fixtures: ${summary.fixtureCount} | Pass rate: ${(summary.metrics.passRate * 100).toFixed(0)}%`);
  lines.push(
    `Calibration MAE: ${summary.metrics.meanCalibrationError.toFixed(3)} | Policy regret: ${summary.metrics.meanStaticPolicyRegret.toFixed(3)} | Uncertainty reduction: ${summary.metrics.meanUncertaintyReduction.toFixed(3)} | Max drift: ${summary.metrics.maxStabilityDrift.toFixed(3)}`,
  );
  lines.push('');

  for (const caseSummary of summary.caseSummaries) {
    lines.push(`- ${caseSummary.id}: ${caseSummary.pass ? 'PASS' : 'FAIL'}`);
    lines.push(
      `  success=${caseSummary.run.successRate.toFixed(3)} target=${caseSummary.expectedSuccessRate.toFixed(3)} calibrationError=${caseSummary.calibrationError.toFixed(3)} utility=${caseSummary.run.utilityScore.toFixed(3)} regret=${caseSummary.staticPolicyRegret.toFixed(3)}`,
    );

    if (caseSummary.bestStaticBaseline) {
      lines.push(
        `  best baseline=${caseSummary.bestStaticBaseline.id} (${caseSummary.bestStaticBaseline.run.utilityScore.toFixed(3)}) | top focus=${caseSummary.run.topFocusMetric ?? 'n/a'}`,
      );
    }

    for (const evidenceCase of caseSummary.evidenceCases) {
      lines.push(
        `  evidence ${evidenceCase.id}: ${evidenceCase.pass ? 'PASS' : 'FAIL'} | uncertaintyReduction=${evidenceCase.uncertaintyReduction.toFixed(3)} confidenceShift=${evidenceCase.confidenceShift.toFixed(3)} downsideShift=${evidenceCase.downsideShift.toFixed(3)} focus=${evidenceCase.rerun.topFocusMetric ?? 'n/a'}`,
      );
    }

    lines.push(
      `  stability: repeats=${caseSummary.stability.repeats} drift=${caseSummary.stability.maxDrift.toFixed(3)}`,
    );

    if (caseSummary.failures.length > 0) {
      for (const failure of caseSummary.failures) {
        lines.push(`    failure: ${failure}`);
      }
    }
  }

  return lines.join('\n');
}
