import { getScenario, ScenarioType } from './decisionGraph.js';
import { cloneSimulationState, createDefaultBeliefState, refreshBeliefState } from './state.js';
import type { DecisionFrame, GraphNode, Scenario, SimulationState } from './types.js';

export interface ScenarioCompilationInput {
  scenarioType: string;
  name?: string;
  parameters?: Record<string, unknown>;
  capitalAtRisk?: number | null;
}

const DEFAULT_TIMEFRAME_MONTHS: Record<string, number> = {
  [ScenarioType.DAY_TRADING]: 18,
  [ScenarioType.STARTUP_FOUNDING]: 36,
  [ScenarioType.CAREER_CHANGE]: 18,
  [ScenarioType.ADVANCED_DEGREE]: 24,
  [ScenarioType.GEOGRAPHIC_RELOCATION]: 18,
  [ScenarioType.REAL_ESTATE_PURCHASE]: 84,
  [ScenarioType.HEALTH_FITNESS_GOAL]: 12,
  [ScenarioType.CUSTOM]: 18,
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

const asString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => typeof entry === 'string');
};

const formatScenarioLabel = (scenarioType: string): string => {
  return scenarioType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
};

const cloneGraph = (graph: GraphNode[]): GraphNode[] => {
  return JSON.parse(JSON.stringify(graph)) as GraphNode[];
};

const deriveCapitalAtRisk = (
  scenarioType: string,
  parameters: Record<string, unknown>,
  capitalAtRisk?: number | null,
): number => {
  const explicit = asNumber(capitalAtRisk)
    ?? asNumber(parameters.capitalAtRisk)
    ?? asNumber(parameters.purchasePrice)
    ?? asNumber(parameters.tuitionCost)
    ?? asNumber(parameters.savingsAmount)
    ?? asNumber(parameters.downPayment)
    ?? asNumber(parameters.movingCost);

  if (typeof explicit === 'number' && explicit > 0) {
    return explicit;
  }

  switch (scenarioType) {
    case ScenarioType.DAY_TRADING:
      return 50_000;
    case ScenarioType.STARTUP_FOUNDING:
      return 100_000;
    case ScenarioType.REAL_ESTATE_PURCHASE:
      return 60_000;
    case ScenarioType.ADVANCED_DEGREE:
      return 50_000;
    default:
      return 25_000;
  }
};

const deriveFallbackPlan = (
  scenarioType: string,
  parameters: Record<string, unknown>,
): string => {
  return asString(parameters.fallbackPlan)
    ?? asString(parameters.alternative)
    ?? (parameters.currentEmployment === true
      ? 'keep the current job while testing the thesis'
      : scenarioType === ScenarioType.CUSTOM
        ? 'preserve runway and keep a reversible backup path alive'
        : `fall back to the current ${formatScenarioLabel(scenarioType)} baseline`);
};

const deriveKeyUnknowns = (
  scenarioType: string,
  parameters: Record<string, unknown>,
): string[] => {
  const explicit = asStringArray(parameters.keyUnknowns);
  if (explicit.length > 0) {
    return explicit.slice(0, 4);
  }

  const scenarioDefaults: Record<string, string[]> = {
    [ScenarioType.DAY_TRADING]: [
      'Can you execute consistently under volatility?',
      'Is your edge real or just early variance?',
      'How much drawdown can you tolerate before behavior breaks?',
    ],
    [ScenarioType.STARTUP_FOUNDING]: [
      'Is there real demand strong enough to support the bet?',
      'Can you keep shipping under pressure without burning out?',
      'How much runway exists before the thesis must prove itself?',
    ],
    [ScenarioType.CAREER_CHANGE]: [
      'Can you close the skill gap fast enough to compete?',
      'Will the market pay for the new identity soon enough?',
      'How much uncertainty can your finances absorb during transition?',
    ],
    [ScenarioType.ADVANCED_DEGREE]: [
      'Will the degree actually open a better path than staying put?',
      'Can you complete the program without stress-induced capitulation?',
      'How long is the payback period if the best case does not land?',
    ],
    [ScenarioType.GEOGRAPHIC_RELOCATION]: [
      'Does the move materially improve opportunity access?',
      'Can your support network survive the disruption?',
      'How reversible is the move if the new city underdelivers?',
    ],
    [ScenarioType.REAL_ESTATE_PURCHASE]: [
      'How much optionality does the purchase remove?',
      'Can the monthly carrying cost survive a bad regime?',
      'Are you buying because the asset is right or because the pressure is social?',
    ],
    [ScenarioType.HEALTH_FITNESS_GOAL]: [
      'Can you sustain the plan after the novelty wears off?',
      'What failure mode most often breaks consistency?',
      'Which minimum viable routine would still compound if life gets chaotic?',
    ],
    [ScenarioType.CUSTOM]: [
      'Is the upside signal real enough to justify deeper commitment?',
      'What is the cheapest experiment that meaningfully de-risks the thesis?',
      'How much optionality disappears if you commit now?',
    ],
  };

  return (scenarioDefaults[scenarioType] ?? scenarioDefaults[ScenarioType.CUSTOM]).slice(0, 4);
};

const deriveReversibilityScore = (
  scenarioType: string,
  parameters: Record<string, unknown>,
): number => {
  const explicit = asNumber(parameters.reversibilityScore);
  if (typeof explicit === 'number') {
    return clamp(explicit, 0.05, 0.95);
  }

  if (parameters.currentEmployment === true && scenarioType === ScenarioType.STARTUP_FOUNDING) {
    return 0.55;
  }

  switch (scenarioType) {
    case ScenarioType.REAL_ESTATE_PURCHASE:
      return 0.28;
    case ScenarioType.GEOGRAPHIC_RELOCATION:
      return 0.42;
    case ScenarioType.ADVANCED_DEGREE:
      return 0.36;
    case ScenarioType.CUSTOM:
      return 0.58;
    default:
      return 0.52;
  }
};

const deriveRunwayMonths = (
  scenarioType: string,
  timeframeMonths: number,
  parameters: Record<string, unknown>,
): number => {
  const explicit = asNumber(parameters.runwayMonths);
  if (typeof explicit === 'number') {
    return Math.max(3, Math.round(explicit));
  }

  const scenarioDefault = scenarioType === ScenarioType.STARTUP_FOUNDING
    ? 18
    : scenarioType === ScenarioType.CUSTOM
      ? 12
      : Math.max(6, Math.round(timeframeMonths * 0.5));
  return scenarioDefault;
};

const summarizeContext = (parameters: Record<string, unknown>): string => {
  const entries = Object.entries(parameters)
    .filter(([, value]) => {
      return (
        typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
        || Array.isArray(value)
      );
    })
    .slice(0, 6)
    .map(([key, value]) => {
      const prettyKey = key.replace(/([A-Z])/g, ' $1').toLowerCase();
      if (Array.isArray(value)) {
        return `${prettyKey}: ${value.join(', ')}`;
      }

      return `${prettyKey}: ${String(value)}`;
    });

  return entries.length > 0 ? entries.join(' | ') : 'No additional structured context provided.';
};

export function buildDecisionFrame(input: ScenarioCompilationInput): DecisionFrame {
  const parameters = input.parameters ?? {};
  const title = asString(parameters.title)
    ?? asString(parameters.primaryQuestion)
    ?? input.name
    ?? formatScenarioLabel(input.scenarioType);
  const timeframeMonths = Math.max(
    3,
    Math.round(asNumber(parameters.timeframe) ?? DEFAULT_TIMEFRAME_MONTHS[input.scenarioType] ?? 18),
  );
  const capitalAtRisk = deriveCapitalAtRisk(input.scenarioType, parameters, input.capitalAtRisk);
  const reversibilityScore = deriveReversibilityScore(input.scenarioType, parameters);
  const runwayMonths = deriveRunwayMonths(input.scenarioType, timeframeMonths, parameters);
  const socialExposure = clamp(
    asNumber(parameters.socialExposure)
      ?? (parameters.currentEmployment === true ? 0.55 : undefined)
      ?? (input.scenarioType === ScenarioType.GEOGRAPHIC_RELOCATION ? 0.6 : 0.4),
    0.05,
    0.95,
  );
  const keyUnknowns = deriveKeyUnknowns(input.scenarioType, parameters);
  const uncertaintyLoad = clamp(0.45 + (keyUnknowns.length * 0.08) - (reversibilityScore * 0.1), 0.25, 0.92);
  const downsideSeverity = clamp(
    (capitalAtRisk / Math.max(1, capitalAtRisk + 25_000)) + ((1 - reversibilityScore) * 0.35),
    0.2,
    0.95,
  );
  const primaryQuestion = asString(parameters.primaryQuestion)
    ?? `${title}${title.endsWith('?') ? '' : ': what is the smartest commitment path?'}`;

  return {
    title,
    primaryQuestion,
    contextSummary: summarizeContext(parameters),
    timeframeMonths,
    capitalAtRisk,
    runwayMonths,
    fallbackPlan: deriveFallbackPlan(input.scenarioType, parameters),
    reversibilityScore,
    socialExposure,
    uncertaintyLoad,
    downsideSeverity,
    keyUnknowns,
  };
}

const applyDecisionFrameToState = (
  state: SimulationState,
  frame: DecisionFrame,
  scenarioType: string,
): SimulationState => {
  const nextState = cloneSimulationState(state);

  const seededCommitment = clamp(
    0.24 + ((1 - frame.reversibilityScore) * 0.18) + (frame.downsideSeverity * 0.08),
    0.08,
    0.78,
  );
  const seededEvidenceQuality = clamp(
    0.22 + ((1 - frame.uncertaintyLoad) * 0.12),
    0.12,
    0.55,
  );

  nextState.metrics.decisionCapitalAtRisk = frame.capitalAtRisk;
  nextState.metrics.decisionHorizonMonths = frame.timeframeMonths;
  nextState.metrics.runwayMonths = frame.runwayMonths;
  nextState.metrics.reversibility = frame.reversibilityScore;
  nextState.metrics.socialPressure = frame.socialExposure;
  nextState.metrics.downsideSeverity = frame.downsideSeverity;
  nextState.metrics.commitmentLevel = clamp(
    Math.max(getMetricValue(nextState.metrics, 'commitmentLevel', seededCommitment), seededCommitment),
    0,
    1,
  );
  nextState.metrics.optionalityPreserved = clamp(
    Math.min(
      getMetricValue(nextState.metrics, 'optionalityPreserved', frame.reversibilityScore),
      Math.max(frame.reversibilityScore, 1 - seededCommitment + 0.1),
    ),
    0,
    1,
  );
  nextState.metrics.evidenceQuality = clamp(
    Math.max(getMetricValue(nextState.metrics, 'evidenceQuality', seededEvidenceQuality), seededEvidenceQuality),
    0,
    1,
  );
  nextState.metrics.learningVelocity = clamp(
    Math.max(getMetricValue(nextState.metrics, 'learningVelocity', 0.28), 0.2 + ((1 - frame.uncertaintyLoad) * 0.18)),
    0,
    1,
  );

  if (scenarioType === ScenarioType.CUSTOM) {
    nextState.metrics.burnRate = clamp(
      getMetricValue(nextState.metrics, 'burnRate', 0.15) + (frame.downsideSeverity * 0.08),
      0.05,
      0.95,
    );
  }

  nextState.beliefState = createDefaultBeliefState({
    thesisConfidence: clamp(0.42 - (frame.uncertaintyLoad * 0.08) + (frame.reversibilityScore * 0.04), 0.22, 0.68),
    uncertaintyLevel: frame.uncertaintyLoad,
    evidenceClarity: nextState.metrics.evidenceQuality,
    reversibilityConfidence: frame.reversibilityScore,
    commitmentLockIn: clamp(nextState.metrics.commitmentLevel * 0.75, 0.08, 0.9),
    socialPressureLoad: frame.socialExposure,
    downsideSalience: frame.downsideSeverity,
    learningVelocity: nextState.metrics.learningVelocity,
    latestSignal: 'neutral',
    updateNarrative: `Decision compiled around "${frame.title}" with ${frame.keyUnknowns.length} major unknowns still unresolved.`,
  });

  return refreshBeliefState(nextState);
};

const getMetricValue = (metrics: Record<string, number>, key: string, fallback: number): number => {
  const value = metrics[key];
  return typeof value === 'number' ? value : fallback;
};

const parameterizeCustomGraph = (graph: GraphNode[], frame: DecisionFrame): GraphNode[] => {
  return graph.map((node) => {
    if (node.type !== 'decision') {
      return node;
    }

    if (node.id === 'start') {
      return {
        ...node,
        prompt: `${frame.primaryQuestion}\nHorizon: ${frame.timeframeMonths} months. Capital at risk: $${Math.round(frame.capitalAtRisk).toLocaleString('en-US')}. Fallback: ${frame.fallbackPlan}. Key unknowns: ${frame.keyUnknowns.slice(0, 2).join(' | ')}. How do you structure the initial bet?`,
      };
    }

    if (node.id === 'evidence_strategy') {
      return {
        ...node,
        prompt: `For "${frame.title}", which uncertainty do you attack first while evidence is still noisy? Highest-value unknowns: ${frame.keyUnknowns.join(' | ')}.`,
      };
    }

    if (node.id === 'pressure_response') {
      return {
        ...node,
        prompt: `Reality is answering back on "${frame.title}". Runway: ${frame.runwayMonths} months. Fallback still available: ${frame.fallbackPlan}. Do you double down, pivot, or preserve runway?`,
      };
    }

    if (node.id === 'final_tradeoff') {
      return {
        ...node,
        prompt: `At the critical moment for "${frame.title}", which tradeoff do you choose? Reversibility: ${(frame.reversibilityScore * 100).toFixed(0)}%. Social exposure: ${(frame.socialExposure * 100).toFixed(0)}%.`,
      };
    }

    return {
      ...node,
      prompt: `${node.prompt}\nDecision focus: ${frame.title}.`,
    };
  });
};

export function compileScenario(input: ScenarioCompilationInput): Scenario {
  const baseScenario = getScenario(input.scenarioType);
  const decisionFrame = buildDecisionFrame(input);
  const graph = cloneGraph(baseScenario.graph);

  const compiledGraph = input.scenarioType === ScenarioType.CUSTOM
    ? parameterizeCustomGraph(graph, decisionFrame)
    : graph;

  const compiledState = applyDecisionFrameToState(
    cloneSimulationState(baseScenario.initialState),
    decisionFrame,
    input.scenarioType,
  );

  return {
    ...baseScenario,
    description: `${baseScenario.description} Decision focus: ${decisionFrame.title}.`,
    timeframe: `${decisionFrame.timeframeMonths} months`,
    initialState: compiledState,
    graph: compiledGraph,
    decisionFrame,
  };
}
