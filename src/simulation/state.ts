import {
  OutcomeEffect,
  SimulationState,
  type OutcomeNode,
} from './types.js';

const clampUnitInterval = (value: number): number => {
  return Math.max(0, Math.min(1, value));
};

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

  return nextState;
}
