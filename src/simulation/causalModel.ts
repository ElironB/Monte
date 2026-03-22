import type {
  CausalState,
  CloneExecutionContext,
  DecisionFrame,
  EventNode,
  EventOutcome,
  SimulationState,
} from './types.js';
import { ScenarioType } from './types.js';

const clampUnitInterval = (value: number): number => {
  return Math.max(0, Math.min(1, value));
};

const getMetricValue = (state: SimulationState, key: string, fallback: number): number => {
  const value = state.metrics[key];
  return typeof value === 'number' ? value : fallback;
};

const blend = (current: number, target: number, weight: number): number => {
  return (current * (1 - weight)) + (target * weight);
};

const closenessToMiddle = (value: number): number => {
  return clampUnitInterval(1 - (Math.abs(value - 0.5) * 2));
};

const nudgeCausalState = (
  state: SimulationState,
  deltas: Partial<Record<keyof CausalState, number>>,
): void => {
  const current = state.causalState ?? createDefaultCausalState();

  state.causalState = {
    demandStrength: clampUnitInterval(current.demandStrength + (deltas.demandStrength ?? 0)),
    executionCapacity: clampUnitInterval(current.executionCapacity + (deltas.executionCapacity ?? 0)),
    runwayStress: clampUnitInterval(current.runwayStress + (deltas.runwayStress ?? 0)),
    marketTailwind: clampUnitInterval(current.marketTailwind + (deltas.marketTailwind ?? 0)),
    socialLegitimacy: clampUnitInterval(current.socialLegitimacy + (deltas.socialLegitimacy ?? 0)),
    reversibilityPressure: clampUnitInterval(current.reversibilityPressure + (deltas.reversibilityPressure ?? 0)),
    evidenceMomentum: clampUnitInterval(current.evidenceMomentum + (deltas.evidenceMomentum ?? 0)),
  };
};

export function createDefaultCausalState(overrides: Partial<CausalState> = {}): CausalState {
  return {
    demandStrength: 0.42,
    executionCapacity: 0.5,
    runwayStress: 0.25,
    marketTailwind: 0.5,
    socialLegitimacy: 0.45,
    reversibilityPressure: 0.22,
    evidenceMomentum: 0.3,
    ...overrides,
  };
}

export function seedCausalStateFromDecisionFrame(
  frame: DecisionFrame,
  metrics: Record<string, number> = {},
): CausalState {
  const opportunityAccess = typeof metrics.opportunityAccess === 'number' ? metrics.opportunityAccess : 0.4;
  const executionQuality = typeof metrics.executionQuality === 'number' ? metrics.executionQuality : 0.5;
  const learningVelocity = typeof metrics.learningVelocity === 'number' ? metrics.learningVelocity : 0.3;
  const evidenceQuality = typeof metrics.evidenceQuality === 'number' ? metrics.evidenceQuality : 0.3;
  const commitmentLevel = typeof metrics.commitmentLevel === 'number' ? metrics.commitmentLevel : 0.35;
  const runwayTension = clampUnitInterval(
    (frame.downsideSeverity * 0.45)
      + ((1 - Math.min(frame.runwayMonths, 24) / 24) * 0.35)
      + ((1 - frame.reversibilityScore) * 0.2),
  );

  return createDefaultCausalState({
    demandStrength: clampUnitInterval(
      0.42
        + ((opportunityAccess - 0.4) * 0.3)
        - (frame.uncertaintyLoad * 0.1)
        + (frame.socialExposure * 0.04),
    ),
    executionCapacity: clampUnitInterval(
      0.45
        + ((executionQuality - 0.5) * 0.5)
        + ((learningVelocity - 0.3) * 0.25)
        - (runwayTension * 0.1),
    ),
    runwayStress: runwayTension,
    marketTailwind: clampUnitInterval(
      0.5
        + ((opportunityAccess - 0.4) * 0.25)
        - (frame.downsideSeverity * 0.05),
    ),
    socialLegitimacy: clampUnitInterval(
      0.38
        + (frame.socialExposure * 0.2)
        + ((opportunityAccess - 0.4) * 0.15)
        - (frame.uncertaintyLoad * 0.08),
    ),
    reversibilityPressure: clampUnitInterval(
      ((1 - frame.reversibilityScore) * 0.72)
        + (frame.downsideSeverity * 0.18)
        + (commitmentLevel * 0.1),
    ),
    evidenceMomentum: clampUnitInterval(
      (evidenceQuality * 0.65)
        + ((1 - frame.uncertaintyLoad) * 0.25)
        + (learningVelocity * 0.1),
    ),
  });
}

export function syncMetricsFromCausalState(state: SimulationState): void {
  const causalState = state.causalState ?? createDefaultCausalState();
  state.causalState = causalState;

  const currentProgressRate = getMetricValue(state, 'progressRate', 0);
  const currentEvidenceQuality = getMetricValue(state, 'evidenceQuality', causalState.evidenceMomentum);
  const currentExecutionQuality = getMetricValue(state, 'executionQuality', causalState.executionCapacity);
  const currentBurnRate = getMetricValue(state, 'burnRate', 0.15);
  const currentOptionality = getMetricValue(state, 'optionalityPreserved', 1);
  const currentReversibility = getMetricValue(state, 'reversibility', 0.8);
  const currentSocialPressure = getMetricValue(state, 'socialPressure', 0.25);
  const currentConvictionStability = getMetricValue(state, 'convictionStability', 0.5);
  const currentOpportunityAccess = getMetricValue(state, 'opportunityAccess', 0.4);
  const currentLearningVelocity = getMetricValue(state, 'learningVelocity', 0.3);
  const currentCommitmentLevel = getMetricValue(state, 'commitmentLevel', 0.35);
  const currentAdaptationScore = getMetricValue(state, 'adaptationScore', 0.2);

  const targetProgressRate = clampUnitInterval(
    (causalState.demandStrength * 0.32)
      + (causalState.executionCapacity * 0.28)
      + (causalState.evidenceMomentum * 0.18)
      + (causalState.marketTailwind * 0.14)
      + (causalState.socialLegitimacy * 0.08)
      - (causalState.runwayStress * 0.12),
  );
  const targetBurnRate = clampUnitInterval(
    0.12
      + (causalState.runwayStress * 0.45)
      + (causalState.reversibilityPressure * 0.18)
      - (causalState.executionCapacity * 0.08),
  );
  const targetOptionality = clampUnitInterval(1 - (causalState.reversibilityPressure * 0.75));
  const targetReversibility = clampUnitInterval(1 - (causalState.reversibilityPressure * 0.85));
  const targetSocialPressure = clampUnitInterval(
    0.18
      + (causalState.runwayStress * 0.18)
      + ((1 - causalState.socialLegitimacy) * 0.22)
      + (causalState.reversibilityPressure * 0.15),
  );
  const targetConvictionStability = clampUnitInterval(
    0.2
      + (causalState.evidenceMomentum * 0.45)
      + (causalState.executionCapacity * 0.2)
      - (causalState.runwayStress * 0.15)
      + (causalState.socialLegitimacy * 0.1),
  );
  const targetOpportunityAccess = clampUnitInterval(
    0.18
      + (causalState.demandStrength * 0.38)
      + (causalState.marketTailwind * 0.22)
      + (causalState.socialLegitimacy * 0.22),
  );
  const targetLearningVelocity = clampUnitInterval(
    0.12
      + (causalState.evidenceMomentum * 0.42)
      + ((1 - causalState.reversibilityPressure) * 0.12)
      + (causalState.executionCapacity * 0.16),
  );
  const targetCommitmentLevel = clampUnitInterval(
    0.18
      + (causalState.reversibilityPressure * 0.48)
      + (causalState.socialLegitimacy * 0.12)
      + (causalState.demandStrength * 0.08),
  );
  const targetAdaptationScore = clampUnitInterval(
    0.15
      + (causalState.evidenceMomentum * 0.28)
      + ((1 - causalState.runwayStress) * 0.12)
      + ((1 - causalState.reversibilityPressure) * 0.12)
      + (causalState.executionCapacity * 0.18),
  );

  state.metrics.progressRate = clampUnitInterval(blend(currentProgressRate, targetProgressRate, 0.25));
  state.metrics.evidenceQuality = clampUnitInterval(blend(currentEvidenceQuality, causalState.evidenceMomentum, 0.45));
  state.metrics.executionQuality = clampUnitInterval(blend(currentExecutionQuality, causalState.executionCapacity, 0.45));
  state.metrics.burnRate = clampUnitInterval(blend(currentBurnRate, targetBurnRate, 0.35));
  state.metrics.optionalityPreserved = clampUnitInterval(blend(currentOptionality, targetOptionality, 0.35));
  state.metrics.reversibility = clampUnitInterval(blend(currentReversibility, targetReversibility, 0.35));
  state.metrics.socialPressure = clampUnitInterval(blend(currentSocialPressure, targetSocialPressure, 0.35));
  state.metrics.convictionStability = clampUnitInterval(blend(currentConvictionStability, targetConvictionStability, 0.3));
  state.metrics.opportunityAccess = clampUnitInterval(blend(currentOpportunityAccess, targetOpportunityAccess, 0.3));
  state.metrics.learningVelocity = clampUnitInterval(blend(currentLearningVelocity, targetLearningVelocity, 0.3));
  state.metrics.commitmentLevel = clampUnitInterval(blend(currentCommitmentLevel, targetCommitmentLevel, 0.3));
  state.metrics.adaptationScore = clampUnitInterval(blend(currentAdaptationScore, targetAdaptationScore, 0.28));

  const existingRunway = getMetricValue(state, 'runwayMonths', Math.max(3, Math.round(state.capital / 2_000)));
  const effectiveBurn = Math.max(
    0.04,
    state.metrics.burnRate * (0.8 + (causalState.runwayStress * 0.4)),
  );
  const projectedRunwayMonths = Math.max(
    0,
    Math.min(
      60,
      state.capital <= 0
        ? 0
        : state.capital / Math.max(1_200, state.capital * effectiveBurn * 0.08),
    ),
  );
  state.metrics.runwayMonths = Number.parseFloat(
    blend(existingRunway, projectedRunwayMonths, 0.25).toFixed(2),
  );

  state.metrics.demandStrength = causalState.demandStrength;
  state.metrics.executionCapacity = causalState.executionCapacity;
  state.metrics.runwayStress = causalState.runwayStress;
  state.metrics.marketTailwind = causalState.marketTailwind;
  state.metrics.socialLegitimacy = causalState.socialLegitimacy;
  state.metrics.reversibilityPressure = causalState.reversibilityPressure;
  state.metrics.evidenceMomentum = causalState.evidenceMomentum;
}

export function applyDecisionCausalTransition(
  state: SimulationState,
  scenarioId: string,
  decisionId: string,
  optionId: string,
): void {
  if (scenarioId !== ScenarioType.CUSTOM) {
    return;
  }

  switch (`${decisionId}:${optionId}`) {
    case 'start:full_commit':
      nudgeCausalState(state, {
        demandStrength: 0.04,
        executionCapacity: 0.04,
        runwayStress: 0.14,
        socialLegitimacy: 0.06,
        reversibilityPressure: 0.2,
        evidenceMomentum: -0.04,
      });
      return;
    case 'start:barbell_commit':
      nudgeCausalState(state, {
        demandStrength: 0.03,
        executionCapacity: 0.05,
        runwayStress: 0.04,
        socialLegitimacy: 0.04,
        reversibilityPressure: -0.02,
        evidenceMomentum: 0.02,
      });
      return;
    case 'start:test_commit':
      nudgeCausalState(state, {
        runwayStress: -0.05,
        marketTailwind: 0.02,
        reversibilityPressure: -0.08,
        evidenceMomentum: 0.12,
      });
      return;
    case 'evidence_strategy:ship_fast':
      nudgeCausalState(state, {
        demandStrength: 0.06,
        executionCapacity: 0.04,
        runwayStress: 0.05,
        socialLegitimacy: 0.06,
        reversibilityPressure: 0.03,
        evidenceMomentum: 0.04,
      });
      return;
    case 'evidence_strategy:run_experiment':
      nudgeCausalState(state, {
        demandStrength: 0.05,
        executionCapacity: 0.03,
        runwayStress: -0.04,
        reversibilityPressure: -0.06,
        evidenceMomentum: 0.14,
      });
      return;
    case 'evidence_strategy:research_more':
      nudgeCausalState(state, {
        executionCapacity: 0.05,
        runwayStress: 0.01,
        marketTailwind: -0.02,
        reversibilityPressure: -0.03,
        evidenceMomentum: 0.1,
      });
      return;
    case 'pressure_response:double_down':
      nudgeCausalState(state, {
        demandStrength: 0.05,
        executionCapacity: -0.04,
        runwayStress: 0.12,
        socialLegitimacy: 0.03,
        reversibilityPressure: 0.14,
        evidenceMomentum: 0.02,
      });
      return;
    case 'pressure_response:pivot':
      nudgeCausalState(state, {
        demandStrength: 0.02,
        executionCapacity: 0.08,
        runwayStress: -0.03,
        marketTailwind: 0.02,
        reversibilityPressure: -0.08,
        evidenceMomentum: 0.12,
      });
      return;
    case 'pressure_response:preserve_runway':
      nudgeCausalState(state, {
        executionCapacity: 0.02,
        runwayStress: -0.12,
        marketTailwind: -0.01,
        reversibilityPressure: -0.14,
        evidenceMomentum: 0.03,
      });
      return;
    case 'final_tradeoff:scale':
      nudgeCausalState(state, {
        demandStrength: 0.06,
        executionCapacity: -0.06,
        runwayStress: 0.16,
        socialLegitimacy: 0.05,
        reversibilityPressure: 0.14,
      });
      return;
    case 'final_tradeoff:consolidate':
      nudgeCausalState(state, {
        executionCapacity: 0.12,
        runwayStress: -0.05,
        socialLegitimacy: 0.03,
        reversibilityPressure: -0.06,
        evidenceMomentum: 0.05,
      });
      return;
    case 'final_tradeoff:retreat':
      nudgeCausalState(state, {
        demandStrength: -0.02,
        runwayStress: -0.1,
        socialLegitimacy: -0.02,
        reversibilityPressure: -0.16,
        evidenceMomentum: 0.04,
      });
      return;
    default:
      return;
  }
}

export function applyEventOutcomeCausalTransition(
  state: SimulationState,
  scenarioId: string,
  eventId: string,
  outcomeId: string,
): void {
  if (scenarioId !== ScenarioType.CUSTOM) {
    return;
  }

  switch (`${eventId}:${outcomeId}`) {
    case 'market_feedback:early_traction':
      nudgeCausalState(state, {
        demandStrength: 0.16,
        executionCapacity: 0.06,
        marketTailwind: 0.08,
        socialLegitimacy: 0.1,
        evidenceMomentum: 0.18,
        runwayStress: -0.04,
      });
      return;
    case 'market_feedback:mixed_signal':
      nudgeCausalState(state, {
        demandStrength: 0.02,
        executionCapacity: -0.01,
        runwayStress: 0.05,
        socialLegitimacy: -0.02,
        evidenceMomentum: 0.08,
        reversibilityPressure: 0.05,
      });
      return;
    case 'market_feedback:weak_demand':
      nudgeCausalState(state, {
        demandStrength: -0.18,
        executionCapacity: -0.08,
        runwayStress: 0.12,
        marketTailwind: -0.06,
        socialLegitimacy: -0.08,
        reversibilityPressure: 0.08,
        evidenceMomentum: 0.04,
      });
      return;
    case 'pressure_builds:unexpected_setback':
      nudgeCausalState(state, {
        executionCapacity: -0.08,
        runwayStress: 0.12,
        marketTailwind: -0.06,
        socialLegitimacy: -0.04,
        reversibilityPressure: 0.06,
      });
      return;
    case 'pressure_builds:hidden_costs':
      nudgeCausalState(state, {
        demandStrength: -0.03,
        runwayStress: 0.1,
        socialLegitimacy: -0.03,
        reversibilityPressure: 0.12,
        evidenceMomentum: -0.02,
      });
      return;
    case 'pressure_builds:supportive_momentum':
      nudgeCausalState(state, {
        demandStrength: 0.06,
        executionCapacity: 0.04,
        runwayStress: -0.05,
        marketTailwind: 0.07,
        socialLegitimacy: 0.14,
        evidenceMomentum: 0.06,
      });
      return;
    case 'final_resolution:durable_success':
      nudgeCausalState(state, {
        demandStrength: 0.1,
        executionCapacity: 0.12,
        runwayStress: -0.08,
        marketTailwind: 0.06,
        socialLegitimacy: 0.08,
        reversibilityPressure: -0.06,
        evidenceMomentum: 0.08,
      });
      return;
    case 'final_resolution:fragile_win':
      nudgeCausalState(state, {
        demandStrength: 0.05,
        executionCapacity: -0.03,
        runwayStress: 0.06,
        socialLegitimacy: 0.02,
        reversibilityPressure: 0.1,
        evidenceMomentum: 0.03,
      });
      return;
    case 'final_resolution:contained_failure':
      nudgeCausalState(state, {
        demandStrength: -0.06,
        executionCapacity: -0.02,
        runwayStress: 0.03,
        socialLegitimacy: -0.01,
        reversibilityPressure: -0.08,
        evidenceMomentum: 0.06,
      });
      return;
    case 'final_resolution:exhausted_collapse':
      nudgeCausalState(state, {
        demandStrength: -0.12,
        executionCapacity: -0.1,
        runwayStress: 0.16,
        marketTailwind: -0.06,
        socialLegitimacy: -0.08,
        reversibilityPressure: 0.14,
        evidenceMomentum: -0.08,
      });
      return;
    default:
      return;
  }
}

export function applyExternalCausalTransition(
  state: SimulationState,
  eventType: string,
): void {
  switch (eventType) {
    case 'bull_market':
      nudgeCausalState(state, {
        demandStrength: 0.05,
        marketTailwind: 0.18,
        socialLegitimacy: 0.04,
        evidenceMomentum: 0.03,
      });
      return;
    case 'market_crash':
    case 'market_crash_personal':
    case 'inflation_erosion':
      nudgeCausalState(state, {
        demandStrength: -0.05,
        runwayStress: 0.12,
        marketTailwind: -0.16,
        socialLegitimacy: -0.04,
        reversibilityPressure: 0.08,
        evidenceMomentum: -0.05,
      });
      return;
    case 'job_loss':
    case 'company_collapse':
    case 'layoff_economic':
      nudgeCausalState(state, {
        executionCapacity: -0.06,
        runwayStress: 0.16,
        socialLegitimacy: -0.04,
        reversibilityPressure: 0.08,
      });
      return;
    case 'promotion':
    case 'job_offer':
      nudgeCausalState(state, {
        demandStrength: 0.04,
        executionCapacity: 0.08,
        runwayStress: -0.06,
        socialLegitimacy: 0.1,
        evidenceMomentum: 0.04,
      });
      return;
    case 'voluntary_resignation':
      nudgeCausalState(state, {
        executionCapacity: -0.02,
        runwayStress: 0.08,
        socialLegitimacy: -0.02,
        reversibilityPressure: 0.04,
      });
      return;
    case 'relationship_strain':
    case 'loneliness_crisis':
    case 'relationship_end':
    case 'family_crisis':
      nudgeCausalState(state, {
        executionCapacity: -0.06,
        runwayStress: 0.08,
        socialLegitimacy: -0.1,
      });
      return;
    case 'social_support':
    case 'new_connection':
    case 'relationship_milestone':
      nudgeCausalState(state, {
        executionCapacity: 0.03,
        runwayStress: -0.04,
        socialLegitimacy: 0.12,
        evidenceMomentum: 0.05,
      });
      return;
    case 'medical_emergency':
    case 'serious_illness':
      nudgeCausalState(state, {
        executionCapacity: -0.12,
        runwayStress: 0.18,
        reversibilityPressure: 0.08,
      });
      return;
    case 'natural_disaster':
    case 'identity_theft':
    case 'legal_trouble':
      nudgeCausalState(state, {
        runwayStress: 0.16,
        marketTailwind: -0.04,
        reversibilityPressure: 0.1,
      });
      return;
    default:
      return;
  }
}

export function calculateEventProbability(
  context: CloneExecutionContext,
  node: EventNode,
): number {
  const causalState = context.state.causalState ?? createDefaultCausalState();
  let probability = node.probability;

  if (node.probabilityModifiers) {
    for (const modifier of node.probabilityModifiers) {
      const rawTraitValue = context.parameters[modifier.condition.split(' ')[0] as keyof typeof context.parameters];
      if (typeof rawTraitValue === 'number') {
        const threshold = Number.parseFloat(modifier.condition.split(' ')[2]);
        const operator = modifier.condition.split(' ')[1];

        let conditionMet = false;
        if (operator === '>') conditionMet = rawTraitValue > threshold;
        else if (operator === '<') conditionMet = rawTraitValue < threshold;
        else if (operator === '>=') conditionMet = rawTraitValue >= threshold;
        else if (operator === '<=') conditionMet = rawTraitValue <= threshold;

        if (conditionMet) {
          probability *= modifier.factor;
        }
      }
    }
  }

  if (node.id.includes('market') || node.name.toLowerCase().includes('market')) {
    probability *= 0.8 + (causalState.marketTailwind * 0.4);
  }

  if (node.id.includes('pressure') || node.name.toLowerCase().includes('pressure')) {
    probability *= 0.75 + (causalState.runwayStress * 0.45) + (causalState.reversibilityPressure * 0.15);
  }

  if (node.id.includes('feedback') || node.name.toLowerCase().includes('feedback')) {
    probability *= 0.8 + (causalState.evidenceMomentum * 0.25) + (causalState.demandStrength * 0.15);
  }

  if (node.id.includes('final_resolution')) {
    probability *= 0.85 + (causalState.executionCapacity * 0.2) + (causalState.evidenceMomentum * 0.15);
  }

  return Math.min(1, Math.max(0, probability));
}

const scoreCustomOutcome = (
  causalState: CausalState,
  eventId: string,
  outcomeId: string,
): number | null => {
  switch (`${eventId}:${outcomeId}`) {
    case 'market_feedback:early_traction':
      return 0.15
        + (causalState.demandStrength * 0.35)
        + (causalState.executionCapacity * 0.25)
        + (causalState.evidenceMomentum * 0.2)
        + (causalState.marketTailwind * 0.12)
        + (causalState.socialLegitimacy * 0.08)
        - (causalState.runwayStress * 0.12);
    case 'market_feedback:mixed_signal':
      return 0.2
        + (closenessToMiddle(causalState.demandStrength) * 0.16)
        + (closenessToMiddle(causalState.evidenceMomentum) * 0.16)
        + (causalState.runwayStress * 0.08);
    case 'market_feedback:weak_demand':
      return 0.15
        + ((1 - causalState.demandStrength) * 0.35)
        + ((1 - causalState.executionCapacity) * 0.2)
        + (causalState.runwayStress * 0.15)
        + ((1 - causalState.socialLegitimacy) * 0.1);
    case 'pressure_builds:unexpected_setback':
      return 0.2
        + (causalState.runwayStress * 0.3)
        + ((1 - causalState.executionCapacity) * 0.15)
        + ((1 - causalState.marketTailwind) * 0.1);
    case 'pressure_builds:hidden_costs':
      return 0.18
        + (causalState.reversibilityPressure * 0.28)
        + (causalState.runwayStress * 0.18)
        + ((1 - causalState.evidenceMomentum) * 0.08);
    case 'pressure_builds:supportive_momentum':
      return 0.16
        + (causalState.socialLegitimacy * 0.3)
        + (causalState.marketTailwind * 0.18)
        + (causalState.evidenceMomentum * 0.12)
        - (causalState.runwayStress * 0.1);
    case 'final_resolution:durable_success':
      return 0.12
        + (causalState.demandStrength * 0.25)
        + (causalState.executionCapacity * 0.24)
        + (causalState.evidenceMomentum * 0.18)
        + (causalState.socialLegitimacy * 0.1)
        + (causalState.marketTailwind * 0.08)
        + ((1 - causalState.runwayStress) * 0.08)
        + ((1 - causalState.reversibilityPressure) * 0.05);
    case 'final_resolution:fragile_win':
      return 0.14
        + (causalState.demandStrength * 0.18)
        + (causalState.marketTailwind * 0.08)
        + (causalState.reversibilityPressure * 0.18)
        + (causalState.runwayStress * 0.14)
        + (causalState.socialLegitimacy * 0.04)
        - (causalState.executionCapacity * 0.04);
    case 'final_resolution:contained_failure':
      return 0.14
        + ((1 - causalState.demandStrength) * 0.1)
        + ((1 - causalState.executionCapacity) * 0.08)
        + (causalState.evidenceMomentum * 0.12)
        + ((1 - causalState.reversibilityPressure) * 0.18)
        + ((1 - causalState.runwayStress) * 0.12);
    case 'final_resolution:exhausted_collapse':
      return 0.1
        + ((1 - causalState.demandStrength) * 0.18)
        + ((1 - causalState.executionCapacity) * 0.18)
        + (causalState.runwayStress * 0.24)
        + (causalState.reversibilityPressure * 0.15)
        + ((1 - causalState.socialLegitimacy) * 0.08);
    default:
      return null;
  }
};

export function selectEventOutcome(
  state: SimulationState,
  scenarioId: string,
  node: EventNode,
): EventOutcome {
  if (node.outcomes.length === 1) {
    return node.outcomes[0];
  }

  const causalState = state.causalState ?? createDefaultCausalState();
  const weightedOutcomes = node.outcomes.map((outcome) => {
    if (scenarioId === ScenarioType.CUSTOM) {
      const customScore = scoreCustomOutcome(causalState, node.id, outcome.id);
      if (typeof customScore === 'number') {
        return {
          outcome,
          weight: Math.max(0.05, customScore),
        };
      }
    }

    return {
      outcome,
      weight: 1,
    };
  });

  const totalWeight = weightedOutcomes.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    return node.outcomes[Math.floor(Math.random() * node.outcomes.length)];
  }

  let roll = Math.random() * totalWeight;
  for (const entry of weightedOutcomes) {
    roll -= entry.weight;
    if (roll <= 0) {
      return entry.outcome;
    }
  }

  return weightedOutcomes[weightedOutcomes.length - 1].outcome;
}
