import type {
  CloneResult,
  DecisionFrame,
  DecisionIntelligence,
  ExperimentRecommendation,
} from './types.js';

type Lens = {
  key: string;
  label: string;
  betterDirection: 'higher' | 'lower';
  whyItMatters: (gap: number, frame?: DecisionFrame) => string;
  recommendedExperiment: (frame?: DecisionFrame, uncertainty?: string) => string;
  successSignal: string;
  stopSignal: string;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const mean = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const getOutcomeBucket = (result: CloneResult): 'success' | 'failure' | 'neutral' => {
  const outcomeValue = typeof result.metrics.outcomeValue === 'number'
    ? result.metrics.outcomeValue
    : 0.5;

  if (outcomeValue >= 0.75) {
    return 'success';
  }

  if (outcomeValue <= 0.25) {
    return 'failure';
  }

  return 'neutral';
};

const getLensValue = (result: CloneResult, key: string): number => {
  if (key === 'beliefUncertainty') {
    return result.finalState.beliefState.uncertaintyLevel;
  }

  if (key === 'beliefConfidence') {
    return result.finalState.beliefState.thesisConfidence;
  }

  if (key === 'commitmentLockIn') {
    return result.finalState.beliefState.commitmentLockIn;
  }

  if (key === 'socialPressureLoad') {
    return result.finalState.beliefState.socialPressureLoad;
  }

  const directMetric = result.metrics[key];
  if (typeof directMetric === 'number') {
    return directMetric;
  }

  const finalMetric = result.finalState.metrics[key];
  if (typeof finalMetric === 'number') {
    return finalMetric;
  }

  return 0;
};

const lenses: Lens[] = [
  {
    key: 'evidenceQuality',
    label: 'evidence quality',
    betterDirection: 'higher',
    whyItMatters: (gap, frame) =>
      `Durable outcomes were separated most by better evidence quality${frame ? ` on "${frame.title}"` : ''}; the success/failure gap was ${(gap * 100).toFixed(0)} points.`,
    recommendedExperiment: (frame, uncertainty) =>
      `Run a two-week evidence sprint for ${uncertainty ?? 'the decision'} with direct user/customer conversations plus one behaviorally binding pilot before increasing commitment. ${frame ? `Fallback path: ${frame.fallbackPlan}.` : ''}`,
    successSignal: 'Outside actors commit with time, money, or repeated use instead of only offering verbal encouragement.',
    stopSignal: 'Interest remains polite and non-binding after direct asks or pilot offers.',
  },
  {
    key: 'executionQuality',
    label: 'execution reliability',
    betterDirection: 'higher',
    whyItMatters: (gap) =>
      `Success was strongly linked to higher execution quality; the branch gap was ${(gap * 100).toFixed(0)} points.`,
    recommendedExperiment: (frame, uncertainty) =>
      `Design a one- to two-week execution drill for ${uncertainty ?? 'the bet'} that forces a concrete deliverable under realistic constraints. ${frame ? `Only deepen commitment if you can ship while preserving ${frame.fallbackPlan}.` : ''}`,
    successSignal: 'You can repeatedly ship the critical deliverable on schedule without borrowing from emergency reserves.',
    stopSignal: 'The plan still looks good in theory, but output slips once real constraints appear.',
  },
  {
    key: 'burnRate',
    label: 'runway durability',
    betterDirection: 'lower',
    whyItMatters: (gap) =>
      `Failures burned runway much faster than wins; the burn gap was ${(gap * 100).toFixed(0)} points.`,
    recommendedExperiment: (frame) =>
      `Stress-test the downside with a conservative runway model. Cut fixed burn, pre-sell where possible, and do not escalate until the plan survives ${frame?.runwayMonths ?? 6} months of bad variance.`,
    successSignal: 'The plan survives a conservative downside case without forcing a panic retreat.',
    stopSignal: 'A single weak month would force you into irreversible or emotionally compromised decisions.',
  },
  {
    key: 'optionalityPreserved',
    label: 'optionality / reversibility',
    betterDirection: 'higher',
    whyItMatters: (gap) =>
      `The strongest paths kept more optionality alive; the reversibility gap was ${(gap * 100).toFixed(0)} points.`,
    recommendedExperiment: (frame) =>
      `Stage the decision so you can collect real evidence before closing escape hatches. ${frame ? `Preserve the fallback path: ${frame.fallbackPlan}.` : 'Preserve a backup path while the thesis is still uncertain.'}`,
    successSignal: 'You gain meaningful evidence without materially narrowing future options.',
    stopSignal: 'The plan requires identity, capital, or public commitments before evidence quality improves.',
  },
  {
    key: 'socialPressureLoad',
    label: 'social pressure contamination',
    betterDirection: 'lower',
    whyItMatters: (gap) =>
      `Collapses were more socially distorted than wins; the pressure gap was ${(gap * 100).toFixed(0)} points.`,
    recommendedExperiment: (frame) =>
      `Privately define go/no-go criteria with one trusted reviewer before announcing the bet publicly. ${frame ? `Do not let external attention outrun the evidence for "${frame.title}".` : 'Reduce social signaling until the evidence is real.'}`,
    successSignal: 'The decision still looks attractive when evaluated privately against explicit criteria.',
    stopSignal: 'Momentum only exists when social attention is high and disappears under private scrutiny.',
  },
  {
    key: 'beliefUncertainty',
    label: 'belief uncertainty',
    betterDirection: 'lower',
    whyItMatters: (gap) =>
      `The best paths collapsed uncertainty faster than the failures; the divergence was ${(gap * 100).toFixed(0)} points.`,
    recommendedExperiment: (_frame, uncertainty) =>
      `Run a falsification test specifically designed to break ${uncertainty ?? 'the thesis'} instead of confirm it.`,
    successSignal: 'The thesis remains robust after an adversarial test designed to invalidate it.',
    stopSignal: 'One direct falsification attempt meaningfully weakens confidence in the thesis.',
  },
];

const genericUnknowns = (frame?: DecisionFrame): string[] => {
  if (frame?.keyUnknowns && frame.keyUnknowns.length > 0) {
    return frame.keyUnknowns.slice(0, 3);
  }

  return [
    'Is the upside signal real enough to justify deeper commitment?',
    'What is the cheapest experiment that reduces the decision risk?',
    'How much optionality disappears if you escalate too early?',
  ];
};

const createGenericRecommendation = (
  uncertainty: string,
  priority: ExperimentRecommendation['priority'],
  learningValue: number,
  frame?: DecisionFrame,
): ExperimentRecommendation => {
  return {
    priority,
    uncertainty,
    whyItMatters: `This remains one of the load-bearing unknowns behind the current decision${frame ? ` for "${frame.title}"` : ''}.`,
    recommendedExperiment: `Design the smallest behaviorally binding test that resolves "${uncertainty}" before making the next irreversible move.${frame ? ` Preserve ${frame.fallbackPlan} while running it.` : ''}`,
    successSignal: 'The test produces outside-world evidence that survives contact with cost, friction, or commitment.',
    stopSignal: 'The thesis only survives when evidence is soft, delayed, or easy to rationalize.',
    learningValue,
  };
};

export function buildDecisionIntelligence(
  cloneResults: CloneResult[],
  decisionFrame?: DecisionFrame,
): DecisionIntelligence {
  const successes = cloneResults.filter((result) => getOutcomeBucket(result) === 'success');
  const failures = cloneResults.filter((result) => getOutcomeBucket(result) === 'failure');

  if (successes.length === 0 || failures.length === 0) {
    const dominantUncertainties = genericUnknowns(decisionFrame);
    return {
      summary: decisionFrame
        ? `Monte compiled "${decisionFrame.title}" but the result set does not yet separate cleanly into wins and failures, so the next move is to resolve the highest-leverage unknowns directly.`
        : 'The current run does not yet cleanly separate wins and failures, so the next move is to resolve the highest-leverage unknowns directly.',
      dominantUncertainties,
      recommendedExperiments: dominantUncertainties.map((uncertainty, index) => (
        createGenericRecommendation(
          uncertainty,
          index === 0 ? 'highest' : index === 1 ? 'high' : 'medium',
          clamp(0.72 - (index * 0.12), 0.35, 0.9),
          decisionFrame,
        )
      )),
    };
  }

  const scoredLenses = lenses
    .map((lens) => {
      const successMean = mean(successes.map((result) => getLensValue(result, lens.key)));
      const failureMean = mean(failures.map((result) => getLensValue(result, lens.key)));
      const gap = Math.abs(successMean - failureMean);
      const learningValue = clamp(gap, 0.1, 0.95);
      return {
        lens,
        successMean,
        failureMean,
        gap,
        learningValue,
      };
    })
    .sort((left, right) => right.gap - left.gap)
    .slice(0, 3);

  const dominantUncertainties = scoredLenses.map((entry, index) => {
    return decisionFrame?.keyUnknowns[index] ?? entry.lens.label;
  });

  const recommendedExperiments = scoredLenses.map((entry, index) => {
    const uncertainty = dominantUncertainties[index];
    return {
      priority: index === 0 ? 'highest' : index === 1 ? 'high' : 'medium',
      uncertainty,
      whyItMatters: entry.lens.whyItMatters(entry.gap, decisionFrame),
      recommendedExperiment: entry.lens.recommendedExperiment(decisionFrame, uncertainty),
      successSignal: entry.lens.successSignal,
      stopSignal: entry.lens.stopSignal,
      learningValue: entry.learningValue,
    } satisfies ExperimentRecommendation;
  });

  const summary = decisionFrame
    ? `Across ${cloneResults.length} clones, the biggest uncertainty drivers behind "${decisionFrame.title}" were ${dominantUncertainties.slice(0, 2).join(' and ')}. Monte recommends reducing those unknowns before making a deeper irreversible commitment.`
    : `Across ${cloneResults.length} clones, the biggest uncertainty drivers were ${dominantUncertainties.slice(0, 2).join(' and ')}. Monte recommends reducing those unknowns before deepening commitment.`;

  return {
    summary,
    dominantUncertainties,
    recommendedExperiments,
  };
}
