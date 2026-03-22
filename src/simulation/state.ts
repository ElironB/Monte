import {
  BeliefState,
  OutcomeEffect,
  SimulationState,
  type OutcomeNode,
} from './types.js';
import {
  createDefaultCausalState,
  syncMetricsFromCausalState,
} from './causalModel.js';

const clampUnitInterval = (value: number): number => {
  return Math.max(0, Math.min(1, value));
};

const getMetricValue = (state: SimulationState, key: string, fallback: number): number => {
  const value = state.metrics[key];
  return typeof value === 'number' ? value : fallback;
};

const inferCapitalPressure = (state: SimulationState): number => {
  const initialCapital = getMetricValue(state, 'decisionCapitalAtRisk', Math.max(1, state.capital || 1));
  if (initialCapital <= 0) {
    return state.capital < 0 ? 0.8 : 0.2;
  }

  const preservation = clampUnitInterval(state.capital / initialCapital);
  return clampUnitInterval(1 - preservation);
};

const inferLatestSignal = (
  thesisConfidence: number,
  uncertaintyLevel: number,
  progressRate: number,
  setbacks: number,
  capitalPressure: number,
): BeliefState['latestSignal'] => {
  if (thesisConfidence >= 0.68 && uncertaintyLevel <= 0.4 && progressRate >= 0.45) {
    return 'positive';
  }

  if (capitalPressure >= 0.45 || setbacks >= 0.5 || thesisConfidence <= 0.35) {
    return 'negative';
  }

  if (uncertaintyLevel >= 0.62 || (progressRate >= 0.25 && progressRate <= 0.45)) {
    return 'mixed';
  }

  return 'neutral';
};

const summarizeBeliefUpdate = (
  latestSignal: BeliefState['latestSignal'],
  thesisConfidence: number,
  uncertaintyLevel: number,
  reversibilityConfidence: number,
): string => {
  if (latestSignal === 'positive') {
    return `Evidence is compounding in favor of the thesis; confidence is ${(thesisConfidence * 100).toFixed(0)}% with uncertainty falling to ${(uncertaintyLevel * 100).toFixed(0)}%.`;
  }

  if (latestSignal === 'negative') {
    return `Recent signals are eroding the thesis; downside risk is becoming more salient and reversibility is ${(reversibilityConfidence * 100).toFixed(0)}%.`;
  }

  if (latestSignal === 'mixed') {
    return `The path is still ambiguous: some evidence is promising, but uncertainty remains ${(uncertaintyLevel * 100).toFixed(0)}%.`;
  }

  return 'The decision is still early and evidence remains noisy.';
};

export function createDefaultBeliefState(overrides: Partial<BeliefState> = {}): BeliefState {
  return {
    thesisConfidence: 0.45,
    uncertaintyLevel: 0.65,
    evidenceClarity: 0.3,
    reversibilityConfidence: 0.6,
    commitmentLockIn: 0.35,
    socialPressureLoad: 0.2,
    downsideSalience: 0.35,
    learningVelocity: 0.3,
    latestSignal: 'neutral',
    updateNarrative: 'The decision is still early and evidence remains noisy.',
    ...overrides,
  };
}

export function deriveBeliefState(state: SimulationState): BeliefState {
  const evidenceClarity = clampUnitInterval(
    getMetricValue(state, 'evidenceQuality', state.beliefState?.evidenceClarity ?? 0.3),
  );
  const executionQuality = clampUnitInterval(getMetricValue(state, 'executionQuality', 0.5));
  const progressRate = clampUnitInterval(getMetricValue(state, 'progressRate', 0.3));
  const learningVelocity = clampUnitInterval(
    getMetricValue(state, 'learningVelocity', state.beliefState?.learningVelocity ?? progressRate),
  );
  const reversibilityConfidence = clampUnitInterval(
    getMetricValue(state, 'reversibility', state.beliefState?.reversibilityConfidence ?? 0.6),
  );
  const optionalityPreserved = clampUnitInterval(getMetricValue(state, 'optionalityPreserved', 0.5));
  const commitmentLevel = clampUnitInterval(getMetricValue(state, 'commitmentLevel', 0.35));
  const burnRate = clampUnitInterval(getMetricValue(state, 'burnRate', 0.2));
  const socialPressure = clampUnitInterval(getMetricValue(state, 'socialPressure', 0.2));
  const socialDisruption = clampUnitInterval(getMetricValue(state, 'socialDisruption', 0));
  const setbacks = clampUnitInterval(getMetricValue(state, 'setbackCount', 0) / 4);
  const capitalPressure = inferCapitalPressure(state);

  const thesisConfidence = clampUnitInterval(
    0.18
      + (evidenceClarity * 0.28)
      + (executionQuality * 0.18)
      + (progressRate * 0.18)
      + (state.happiness * 0.08)
      + (optionalityPreserved * 0.05)
      - (setbacks * 0.18)
      - (socialPressure * 0.06)
      - (capitalPressure * 0.12),
  );

  const uncertaintyLevel = clampUnitInterval(
    0.78
      - (evidenceClarity * 0.35)
      - (learningVelocity * 0.15)
      - (progressRate * 0.08)
      + (socialPressure * 0.12)
      + (setbacks * 0.12)
      + (burnRate * 0.1)
      + (capitalPressure * 0.08),
  );

  const commitmentLockIn = clampUnitInterval(
    (commitmentLevel * 0.65)
      + ((1 - optionalityPreserved) * 0.2)
      + ((1 - reversibilityConfidence) * 0.15),
  );

  const socialPressureLoad = clampUnitInterval(
    (socialPressure * 0.7)
      + (socialDisruption * 0.2)
      + ((state.beliefState?.socialPressureLoad ?? 0.2) * 0.1),
  );

  const downsideSalience = clampUnitInterval(
    0.2
      + (burnRate * 0.35)
      + (capitalPressure * 0.25)
      + (setbacks * 0.15)
      + (socialPressure * 0.05),
  );

  const latestSignal = inferLatestSignal(
    thesisConfidence,
    uncertaintyLevel,
    progressRate,
    setbacks,
    capitalPressure,
  );

  return createDefaultBeliefState({
    thesisConfidence,
    uncertaintyLevel,
    evidenceClarity,
    reversibilityConfidence,
    commitmentLockIn,
    socialPressureLoad,
    downsideSalience,
    learningVelocity,
    latestSignal,
    updateNarrative: summarizeBeliefUpdate(
      latestSignal,
      thesisConfidence,
      uncertaintyLevel,
      reversibilityConfidence,
    ),
  });
}

const applyNumericDelta = (currentValue: number, delta: number, type: OutcomeEffect['type']): number => {
  if (type === 'percentage') {
    return currentValue * (1 + delta);
  }

  return currentValue + delta;
};

export function cloneSimulationState(state: SimulationState): SimulationState {
  return {
    ...state,
    decisions: state.decisions.map((decision) => ({ ...decision })),
    events: state.events.map((event) => ({ ...event })),
    metrics: { ...state.metrics },
    beliefState: { ...state.beliefState },
    causalState: { ...(state.causalState ?? createDefaultCausalState()) },
  };
}

export function applyEffectToState(state: SimulationState, effect: OutcomeEffect): void {
  const { target, delta, type } = effect;

  if (target === 'capital') {
    state.capital = applyNumericDelta(state.capital, delta, type);
    return;
  }

  if (target === 'health') {
    state.health = clampUnitInterval(applyNumericDelta(state.health, delta, type));
    return;
  }

  if (target === 'happiness') {
    state.happiness = clampUnitInterval(applyNumericDelta(state.happiness, delta, type));
    return;
  }

  if (target.startsWith('metrics.')) {
    const metricKey = target.replace('metrics.', '');
    const rawValue = state.metrics[metricKey];
    const currentValue = typeof rawValue === 'number' ? rawValue : 0;
    state.metrics[metricKey] = applyNumericDelta(currentValue, delta, type);
    return;
  }

  if (target.startsWith('belief.') || target.startsWith('beliefState.')) {
    const beliefKey = target.replace('beliefState.', '').replace('belief.', '') as keyof BeliefState;
    const rawValue = state.beliefState[beliefKey];

    if (typeof rawValue === 'number') {
      ((state.beliefState as unknown) as Record<string, number | string>)[beliefKey] = applyNumericDelta(rawValue, delta, type);
    }

    return;
  }

  if (target.startsWith('causal.') || target.startsWith('causalState.')) {
    const causalKey = target.replace('causalState.', '').replace('causal.', '');
    const causalState = (state.causalState as unknown) as Record<string, number | undefined>;
    const rawValue = causalState[causalKey];

    if (typeof rawValue === 'number') {
      ((state.causalState as unknown) as Record<string, number>)[causalKey] = clampUnitInterval(
        applyNumericDelta(rawValue, delta, type),
      );
    }
  }
}

export function applyEffectsToState(
  state: SimulationState,
  effects: OutcomeEffect[],
): SimulationState {
  const nextState = cloneSimulationState(state);

  for (const effect of effects) {
    applyEffectToState(nextState, effect);
  }
  nextState.beliefState = deriveBeliefState(nextState);

  return nextState;
}

export function refreshBeliefState(state: SimulationState): SimulationState {
  const nextState = cloneSimulationState(state);
  syncMetricsFromCausalState(nextState);
  nextState.beliefState = deriveBeliefState(nextState);
  return nextState;
}

export function applyOutcomeNodeResults(
  state: SimulationState,
  results: OutcomeNode['results'] | undefined,
): SimulationState {
  if (!results) {
    return state;
  }

  const nextState = cloneSimulationState(state);

  for (const [key, value] of Object.entries(results)) {
    if (key === 'finalCapital' && typeof value === 'number') {
      nextState.capital = value;
    } else if (key === 'outcome' && typeof value === 'string') {
      nextState.outcome = value;
    } else if (key === 'healthImpact' && typeof value === 'number') {
      nextState.health = clampUnitInterval(nextState.health + value);
    } else if (key === 'happinessImpact' && typeof value === 'number') {
      nextState.happiness = clampUnitInterval(nextState.happiness + value);
    } else if (typeof value === 'number') {
      nextState.metrics[key] = value;
    } else if (typeof value === 'boolean') {
      nextState.metrics[key] = value ? 1 : 0;
    }
  }
  nextState.beliefState = deriveBeliefState(nextState);

  return nextState;
}
