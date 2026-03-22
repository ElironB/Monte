import { createDefaultCausalState } from './causalModel.js';
import { refreshBeliefState } from './state.js';
import type {
  AggregatedResults,
  BeliefState,
  CausalState,
  DecisionFrame,
  EvidenceResult,
  EvidenceResultStatus,
  RerunComparison,
  SimulationState,
} from './types.js';

const clampUnitInterval = (value: number): number => {
  return Math.max(0, Math.min(1, value));
};

const roundDelta = (value: number): number => {
  return Number.parseFloat(value.toFixed(3));
};

const CAUSAL_DIRECTION: Record<keyof CausalState, 1 | -1> = {
  demandStrength: 1,
  executionCapacity: 1,
  runwayStress: -1,
  marketTailwind: 1,
  socialLegitimacy: 1,
  reversibilityPressure: -1,
  evidenceMomentum: 1,
};

type NumericBeliefTarget = EvidenceResult['beliefTargets'][number];

const THESIS_BELIEF_DIRECTION: Partial<Record<NumericBeliefTarget, 1 | -1>> = {
  thesisConfidence: 1,
  reversibilityConfidence: 1,
  commitmentLockIn: 1,
  socialPressureLoad: -1,
  downsideSalience: -1,
};

const RESOLUTION_BELIEF_DIRECTION: Partial<Record<NumericBeliefTarget, 1 | -1>> = {
  uncertaintyLevel: -1,
  evidenceClarity: 1,
  learningVelocity: 1,
};

const getThesisMultiplier = (result: EvidenceResultStatus): number => {
  switch (result) {
    case 'positive':
      return 1;
    case 'negative':
      return -1;
    case 'mixed':
      return 0.2;
    default:
      return 0;
  }
};

const getResolutionMultiplier = (result: EvidenceResultStatus): number => {
  switch (result) {
    case 'positive':
    case 'negative':
      return 1;
    case 'mixed':
      return 0.65;
    default:
      return 0.2;
  }
};

const getSignalMagnitude = (confidence: number, result: EvidenceResultStatus): number => {
  const base = 0.045 + (clampUnitInterval(confidence) * 0.11);
  return result === 'mixed'
    ? base * 0.65
    : result === 'inconclusive'
      ? base * 0.22
      : base;
};

const summarizeEvidence = (evidence: EvidenceResult[]): string => {
  if (evidence.length === 0) {
    return 'No external evidence has been accepted yet.';
  }

  const descriptors = evidence.slice(0, 2).map((entry) => {
    return `${entry.result} evidence on "${entry.uncertainty}"`;
  });

  if (evidence.length === 1) {
    return `Evidence incorporated: ${descriptors[0]}.`;
  }

  if (evidence.length === 2) {
    return `Evidence incorporated: ${descriptors.join(' and ')}.`;
  }

  return `Evidence incorporated: ${descriptors.join(', ')}, plus ${evidence.length - 2} more experiment results.`;
};

const deriveFollowOnUnknown = (entry: EvidenceResult): string => {
  switch (entry.result) {
    case 'positive':
      return `What is the next cheapest way to scale after validating "${entry.uncertainty}"?`;
    case 'negative':
      return `Does the decision still survive now that "${entry.uncertainty}" looks weaker than expected?`;
    case 'mixed':
      return `What cleaner falsification test resolves the mixed signal around "${entry.uncertainty}"?`;
    default:
      return `How can "${entry.uncertainty}" be tested with a stronger signal instead of soft evidence?`;
  }
};

const getHistogramMean = (results: AggregatedResults, metric: string): number => {
  const histogram = results.histograms.find((entry) => entry.metric === metric);
  return histogram?.mean ?? 0;
};

const uniqueStrings = (values: string[]): string[] => {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
};

export function deriveEvidenceAdjustments(
  result: EvidenceResultStatus,
  confidence: number,
  causalTargets: EvidenceResult['causalTargets'],
  beliefTargets: EvidenceResult['beliefTargets'],
): Pick<EvidenceResult, 'causalAdjustments' | 'beliefAdjustments'> {
  const thesisMultiplier = getThesisMultiplier(result);
  const resolutionMultiplier = getResolutionMultiplier(result);
  const magnitude = getSignalMagnitude(confidence, result);
  const causalAdjustments: EvidenceResult['causalAdjustments'] = {};
  const beliefAdjustments: EvidenceResult['beliefAdjustments'] = {};

  for (const target of causalTargets) {
    causalAdjustments[target] = roundDelta(CAUSAL_DIRECTION[target] * thesisMultiplier * magnitude);
  }

  for (const target of beliefTargets) {
    const thesisDirection = THESIS_BELIEF_DIRECTION[target];
    if (thesisDirection) {
      beliefAdjustments[target] = roundDelta(thesisDirection * thesisMultiplier * magnitude * 0.85);
      continue;
    }

    const resolutionDirection = RESOLUTION_BELIEF_DIRECTION[target];
    if (resolutionDirection) {
      beliefAdjustments[target] = roundDelta(
        resolutionDirection * resolutionMultiplier * magnitude * (target === 'uncertaintyLevel' ? 0.95 : 0.8),
      );
    }
  }

  return {
    causalAdjustments,
    beliefAdjustments,
  };
}

export function applyEvidenceToState(
  state: SimulationState,
  evidence: EvidenceResult[],
): SimulationState {
  if (evidence.length === 0) {
    return state;
  }

  const seededState: SimulationState = {
    ...state,
    metrics: { ...state.metrics },
    beliefState: { ...state.beliefState },
    causalState: { ...(state.causalState ?? createDefaultCausalState()) },
  };

  for (const entry of evidence) {
    for (const target of Object.keys(entry.causalAdjustments) as Array<keyof CausalState>) {
      const currentValue = seededState.causalState[target];
      const delta = entry.causalAdjustments[target];

      if (typeof delta === 'number') {
        seededState.causalState[target] = clampUnitInterval(currentValue + delta);
      }
    }
  }

  const refreshedState = refreshBeliefState(seededState);

  for (const entry of evidence) {
    for (const target of Object.keys(entry.beliefAdjustments) as NumericBeliefTarget[]) {
      const delta = entry.beliefAdjustments[target];
      const currentValue = refreshedState.beliefState[target];

      if (typeof delta === 'number' && typeof currentValue === 'number') {
        refreshedState.beliefState[target] = clampUnitInterval(currentValue + delta) as BeliefState[typeof target];
      }
    }
  }

  const latestEvidence = evidence[evidence.length - 1];
  refreshedState.beliefState.latestSignal = latestEvidence.result === 'inconclusive'
    ? refreshedState.beliefState.latestSignal
    : latestEvidence.result === 'mixed'
      ? 'mixed'
      : latestEvidence.result;
  refreshedState.beliefState.updateNarrative = `${summarizeEvidence(evidence)} ${latestEvidence.observedSignal}`.trim();

  return refreshedState;
}

export function applyEvidenceToDecisionFrame(
  frame: DecisionFrame,
  evidence: EvidenceResult[],
): DecisionFrame {
  if (evidence.length === 0) {
    return frame;
  }

  const clarityGain = evidence.reduce((sum, entry) => {
    return sum + (getSignalMagnitude(entry.confidence, entry.result) * getResolutionMultiplier(entry.result) * 0.7);
  }, 0);
  const downsideShift = evidence.reduce((sum, entry) => {
    return sum + ((entry.beliefAdjustments.downsideSalience ?? 0) * 0.55);
  }, 0);
  const socialExposureShift = evidence.reduce((sum, entry) => {
    return sum + ((entry.beliefAdjustments.socialPressureLoad ?? 0) * 0.7);
  }, 0);
  const reversibilityShift = evidence.reduce((sum, entry) => {
    return sum - ((entry.causalAdjustments.reversibilityPressure ?? 0) * 0.85);
  }, 0);

  const resolved = new Set(
    evidence
      .filter((entry) => entry.result === 'positive' || entry.result === 'negative')
      .map((entry) => entry.uncertainty.toLowerCase()),
  );

  const unresolvedUnknowns = frame.keyUnknowns.filter((unknown) => !resolved.has(unknown.toLowerCase()));
  const followOnUnknowns = evidence.map((entry) => deriveFollowOnUnknown(entry));
  const keyUnknowns = uniqueStrings([...unresolvedUnknowns, ...followOnUnknowns]).slice(0, 4);

  return {
    ...frame,
    contextSummary: `${frame.contextSummary} ${summarizeEvidence(evidence)}`.trim(),
    uncertaintyLoad: clampUnitInterval(frame.uncertaintyLoad - Math.min(0.32, clarityGain)),
    downsideSeverity: clampUnitInterval(frame.downsideSeverity + downsideShift),
    socialExposure: clampUnitInterval(frame.socialExposure + socialExposureShift),
    reversibilityScore: clampUnitInterval(frame.reversibilityScore + reversibilityShift),
    keyUnknowns: keyUnknowns.length > 0 ? keyUnknowns : frame.keyUnknowns,
  };
}

export function buildRerunComparison(
  sourceSimulationId: string,
  baselineResults: AggregatedResults,
  rerunResults: AggregatedResults,
  evidence: EvidenceResult[],
): RerunComparison {
  const beliefDelta = {
    thesisConfidence: roundDelta(
      getHistogramMean(rerunResults, 'beliefConfidence') - getHistogramMean(baselineResults, 'beliefConfidence'),
    ),
    uncertaintyLevel: roundDelta(
      getHistogramMean(rerunResults, 'beliefUncertainty') - getHistogramMean(baselineResults, 'beliefUncertainty'),
    ),
    downsideSalience: roundDelta(
      getHistogramMean(rerunResults, 'beliefDownsideSalience')
        - getHistogramMean(baselineResults, 'beliefDownsideSalience'),
    ),
  };

  const previousTopUncertainty = baselineResults.decisionIntelligence?.dominantUncertainties[0];
  const newTopUncertainty = rerunResults.decisionIntelligence?.dominantUncertainties[0];
  const previousTopExperiment = baselineResults.decisionIntelligence?.recommendedExperiments[0]?.recommendedExperiment;
  const newTopExperiment = rerunResults.decisionIntelligence?.recommendedExperiments[0]?.recommendedExperiment;

  const confidenceShift = beliefDelta.thesisConfidence;
  const uncertaintyShift = beliefDelta.uncertaintyLevel;
  const confidenceSummary = confidenceShift === 0
    ? 'Confidence stayed effectively flat'
    : confidenceShift > 0
      ? `Confidence increased by ${(confidenceShift * 100).toFixed(1)} points`
      : `Confidence fell by ${Math.abs(confidenceShift * 100).toFixed(1)} points`;
  const uncertaintySummary = uncertaintyShift === 0
    ? 'uncertainty stayed flat'
    : uncertaintyShift < 0
      ? `uncertainty dropped by ${Math.abs(uncertaintyShift * 100).toFixed(1)} points`
      : `uncertainty increased by ${(uncertaintyShift * 100).toFixed(1)} points`;

  return {
    sourceSimulationId,
    evidenceCount: evidence.length,
    summary: `${confidenceSummary} and ${uncertaintySummary} after applying ${evidence.length} evidence result${evidence.length === 1 ? '' : 's'}.`,
    beliefDelta,
    recommendationDelta: {
      changed: previousTopExperiment !== newTopExperiment || previousTopUncertainty !== newTopUncertainty,
      previousTopUncertainty,
      newTopUncertainty,
      previousTopExperiment,
      newTopExperiment,
    },
  };
}
