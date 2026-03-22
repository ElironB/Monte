import { DimensionScore } from './personaCompressor.js';

// ---------------------------------------------------------------------------
// Weight constants — all mapping weights live here and nowhere else.
// Tune here without touching any logic functions.
// ---------------------------------------------------------------------------

const CONFIDENCE_MIN_THRESHOLD = 0.3;

const BIG_FIVE_WEIGHTS = {
  openness: {
    learningStyle: 0.5,          // high learningStyle = deep/exploratory = high O
    informationSeeking: 0.3,     // high informationSeeking = high O
  },
  conscientiousness: {
    executionGap: -0.6,          // INVERTED — high gap = low C
    decisionSpeed: -0.25,        // INVERTED — high speed (impulsive) = low C
    timePreference: -0.15,       // INVERTED — high timePreference (immediate) = low C
  },
  extraversion: {
    socialDependency: 0.4,
  },
  agreeableness: {
    socialDependency: 0.5,
    emotionalVolatility: 0.2,   // high anxiety often correlates with higher A
    riskTolerance: -0.15,       // low riskTolerance (loss-averse) → avoids conflict → high A
  },
  neuroticism: {
    emotionalVolatility: 0.6,
    riskTolerance: -0.25,       // low riskTolerance (loss-averse) → high N
    stressResponse: 0.15,       // high stressResponse = collapses under pressure = high N (direct)
  },
} as const;

const ATTACHMENT_WEIGHTS = {
  anxietyAxis: {
    emotionalVolatility: 0.5,
    riskTolerance_inverted: 0.3,  // (1 - riskTolerance)
    socialDependency: 0.2,
  },
  avoidanceAxis: {
    socialDependency_inverted: 0.6, // (1 - socialDependency)
    decisionSpeed: 0.4,
  },
} as const;

const LOCUS_WEIGHTS = {
  timePreference_inverted: 0.4,    // (1 - timePreference) = future-focused = internal
  executionGap_inverted: 0.35,     // (1 - executionGap) = follows through = internal
  socialDependency_inverted: 0.25, // (1 - socialDependency) = independent = internal
} as const;

const TEMPORAL_DISCOUNTING_WEIGHTS = {
  timePreference_inverted: 0.5,    // (1 - timePreference) = future orientation
  executionGap_inverted: 0.3,      // (1 - executionGap) = follows through
  riskTolerance: 0.2,              // high riskTolerance = not loss-averse = less present bias
} as const;

const PRESENT_BIAS_STRENGTH: Record<string, number> = {
  hyperbolic_severe: 0.85,
  hyperbolic_moderate: 0.55,
  near_rational: 0.20,
  future_biased: 0.05,
};

// ---------------------------------------------------------------------------
// Interfaces — all exported so they can be imported by personaCompressor.ts
// ---------------------------------------------------------------------------

export interface BigFiveProfile {
  openness: number;           // 0-1
  conscientiousness: number;  // 0-1
  extraversion: number;       // 0-1
  agreeableness: number;      // 0-1
  neuroticism: number;        // 0-1
  confidence: number;         // mean confidence of contributing dimensions
  dominantTrait: 'O' | 'C' | 'E' | 'A' | 'N';
  deficitTrait: 'O' | 'C' | 'E' | 'A' | 'N';
}

export type AttachmentStyle = 'secure' | 'anxious' | 'avoidant' | 'disorganized';

export interface AttachmentProfile {
  style: AttachmentStyle;
  confidence: number;
  anxietyAxis: number;
  avoidanceAxis: number;
  primarySignals: string[];
}

export type LocusOfControl = 'internal' | 'external' | 'mixed';

export interface LocusProfile {
  type: LocusOfControl;
  score: number;     // 0=fully external, 1=fully internal
  confidence: number;
  implication: string;
}

export interface TemporalDiscountingProfile {
  discountingRate: 'hyperbolic_severe' | 'hyperbolic_moderate' | 'near_rational' | 'future_biased';
  score: number;
  confidence: number;
  presentBiasStrength: number;
  mechanismDescription: string;
}

export interface RiskFlag {
  flag: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  affectedScenarios: string[];
}

export interface PsychologicalProfile {
  bigFive: BigFiveProfile;
  attachment: AttachmentProfile;
  locusOfControl: LocusProfile;
  temporalDiscounting: TemporalDiscountingProfile;
  riskFlags: RiskFlag[];
  narrativeSummary: string;
  technicalSummary: string;
}

// ---------------------------------------------------------------------------
// Internal helper type
// ---------------------------------------------------------------------------
interface DimInfo {
  value: number;
  included: boolean;
  confidence: number;
}

// ---------------------------------------------------------------------------
// PsychologyLayer — pure synchronous class, no database calls, no async.
// ---------------------------------------------------------------------------

export class PsychologyLayer {
  /**
   * Main entry point.
   * Takes the dimensionScores map produced by DimensionMapper and returns
   * a fully computed PsychologicalProfile.
   */
  analyze(dimensionScores: Record<string, DimensionScore>): PsychologicalProfile {
    const d = this.toValueMap(dimensionScores);
    const bigFive = this.mapToBigFive(dimensionScores, d);
    const attachment = this.mapToAttachment(dimensionScores, d);
    const locus = this.mapToLocus(dimensionScores, d);
    const discounting = this.mapToTemporalDiscounting(dimensionScores, d);
    const riskFlags = this.generateRiskFlags(bigFive, attachment, locus, discounting, d);
    return {
      bigFive,
      attachment,
      locusOfControl: locus,
      temporalDiscounting: discounting,
      riskFlags,
      narrativeSummary: this.buildNarrativeSummary(bigFive, attachment, locus, discounting, riskFlags),
      technicalSummary: this.buildTechnicalSummary(bigFive, attachment, locus, discounting, riskFlags),
    };
  }

  // --------------------------------------------------------------------------
  // Big Five
  // --------------------------------------------------------------------------

  private mapToBigFive(
    scores: Record<string, DimensionScore>,
    d: Record<string, number>
  ): BigFiveProfile {
    // --- Openness ---
    const oInfo = this.weightedAvg([
      { dim: 'learningStyle', weight: BIG_FIVE_WEIGHTS.openness.learningStyle, invert: false },
      { dim: 'informationSeeking', weight: BIG_FIVE_WEIGHTS.openness.informationSeeking, invert: false },
    ], scores, d);

    // --- Conscientiousness (all weights are inverted) ---
    const cInfo = this.weightedAvg([
      { dim: 'executionGap', weight: Math.abs(BIG_FIVE_WEIGHTS.conscientiousness.executionGap), invert: true },
      { dim: 'decisionSpeed', weight: Math.abs(BIG_FIVE_WEIGHTS.conscientiousness.decisionSpeed), invert: true },
      { dim: 'timePreference', weight: Math.abs(BIG_FIVE_WEIGHTS.conscientiousness.timePreference), invert: true },
    ], scores, d);

    // --- Extraversion ---
    const eRaw = this.weightedAvg([
      { dim: 'socialDependency', weight: BIG_FIVE_WEIGHTS.extraversion.socialDependency, invert: false },
    ], scores, d);
    // E confidence is capped at 0.5 — it's the least reliably measurable from Monte's data
    const eInfo = { value: eRaw.value, confidence: Math.min(0.5, eRaw.confidence) };

    // --- Agreeableness ---
    const aInfo = this.weightedAvg([
      { dim: 'socialDependency', weight: BIG_FIVE_WEIGHTS.agreeableness.socialDependency, invert: false },
      { dim: 'emotionalVolatility', weight: BIG_FIVE_WEIGHTS.agreeableness.emotionalVolatility, invert: false },
      { dim: 'riskTolerance', weight: Math.abs(BIG_FIVE_WEIGHTS.agreeableness.riskTolerance), invert: true },
    ], scores, d);

    // --- Neuroticism ---
    const nInfo = this.weightedAvg([
      { dim: 'emotionalVolatility', weight: BIG_FIVE_WEIGHTS.neuroticism.emotionalVolatility, invert: false },
      { dim: 'riskTolerance', weight: Math.abs(BIG_FIVE_WEIGHTS.neuroticism.riskTolerance), invert: true },
      { dim: 'stressResponse', weight: BIG_FIVE_WEIGHTS.neuroticism.stressResponse, invert: false },
    ], scores, d);

    const traits: Record<'O' | 'C' | 'E' | 'A' | 'N', number> = {
      O: oInfo.value,
      C: cInfo.value,
      E: eInfo.value,
      A: aInfo.value,
      N: nInfo.value,
    };

    const entries = Object.entries(traits) as Array<['O' | 'C' | 'E' | 'A' | 'N', number]>;
    const dominantTrait = entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    const deficitTrait = entries.reduce((a, b) => (b[1] < a[1] ? b : a))[0];

    const overallConfidence =
      (oInfo.confidence + cInfo.confidence + eInfo.confidence + aInfo.confidence + nInfo.confidence) / 5;

    return {
      openness: oInfo.value,
      conscientiousness: cInfo.value,
      extraversion: eInfo.value,
      agreeableness: aInfo.value,
      neuroticism: nInfo.value,
      confidence: overallConfidence,
      dominantTrait,
      deficitTrait,
    };
  }

  // --------------------------------------------------------------------------
  // Attachment Style
  // --------------------------------------------------------------------------

  private mapToAttachment(
    scores: Record<string, DimensionScore>,
    d: Record<string, number>
  ): AttachmentProfile {
    const get = (k: string) => d[k] ?? 0.5;

    const anxietyAxis =
      get('emotionalVolatility') * ATTACHMENT_WEIGHTS.anxietyAxis.emotionalVolatility +
      (1 - get('riskTolerance')) * ATTACHMENT_WEIGHTS.anxietyAxis.riskTolerance_inverted +
      get('socialDependency') * ATTACHMENT_WEIGHTS.anxietyAxis.socialDependency;

    const avoidanceAxis =
      (1 - get('socialDependency')) * ATTACHMENT_WEIGHTS.avoidanceAxis.socialDependency_inverted +
      get('decisionSpeed') * ATTACHMENT_WEIGHTS.avoidanceAxis.decisionSpeed;

    let style: AttachmentStyle;
    if (anxietyAxis > 0.6 && avoidanceAxis < 0.4) style = 'anxious';
    else if (anxietyAxis < 0.4 && avoidanceAxis > 0.6) style = 'avoidant';
    else if (anxietyAxis > 0.6 && avoidanceAxis > 0.6) style = 'disorganized';
    else style = 'secure';

    // Primary signals: dimensions contributing > 0.15 to either axis
    const primarySignals: string[] = [];
    if (get('emotionalVolatility') * 0.5 > 0.15) primarySignals.push('emotionalVolatility');
    if ((1 - get('riskTolerance')) * 0.3 > 0.15) primarySignals.push('riskTolerance');
    if (get('socialDependency') * 0.2 > 0.15) primarySignals.push('socialDependency (anxiety)');
    if ((1 - get('socialDependency')) * 0.6 > 0.15) {
      if (!primarySignals.includes('socialDependency (avoidance)')) {
        primarySignals.push('socialDependency (avoidance)');
      }
    }
    if (get('decisionSpeed') * 0.4 > 0.15) primarySignals.push('decisionSpeed');

    // Confidence: mean of relevant dimension confidences
    const relDims = ['emotionalVolatility', 'riskTolerance', 'socialDependency', 'decisionSpeed'];
    const confidence =
      relDims.reduce((sum, k) => sum + (scores[k]?.confidence ?? 0.1), 0) / relDims.length;

    return { style, confidence, anxietyAxis, avoidanceAxis, primarySignals };
  }

  // --------------------------------------------------------------------------
  // Locus of Control
  // --------------------------------------------------------------------------

  private mapToLocus(
    scores: Record<string, DimensionScore>,
    d: Record<string, number>
  ): LocusProfile {
    const get = (k: string) => d[k] ?? 0.5;

    const score =
      (1 - get('timePreference')) * LOCUS_WEIGHTS.timePreference_inverted +
      (1 - get('executionGap')) * LOCUS_WEIGHTS.executionGap_inverted +
      (1 - get('socialDependency')) * LOCUS_WEIGHTS.socialDependency_inverted;

    let type: LocusOfControl;
    if (score > 0.65) type = 'internal';
    else if (score < 0.35) type = 'external';
    else type = 'mixed';

    const implication = this.buildLocusImplication(type, d);

    const relDims = ['timePreference', 'executionGap', 'socialDependency'];
    const confidence =
      relDims.reduce((sum, k) => sum + (scores[k]?.confidence ?? 0.1), 0) / relDims.length;

    return { type, score, confidence, implication };
  }

  private buildLocusImplication(type: LocusOfControl, d: Record<string, number>): string {
    const isHighExecGap = (d.executionGap ?? 0.5) > 0.6;
    const isHighAnxiety = (d.emotionalVolatility ?? 0.5) > 0.6;
    if (type === 'internal' && !isHighExecGap)
      return 'Takes ownership of outcomes and follows through on plans';
    if (type === 'internal' && isHighExecGap)
      return "Believes they control outcomes but execution patterns suggest otherwise — high internal locus combined with high execution gap creates a painful self-awareness cycle";
    if (type === 'external' && isHighAnxiety)
      return "Attributes outcomes to external forces, which reduces agency in simulation scenarios — tends to wait for circumstances rather than create them";
    if (type === 'external')
      return "Relaxed external locus — goes with the flow, low urgency for self-directed change";
    return "Situational locus — takes ownership in familiar domains, defers in unfamiliar ones";
  }

  // --------------------------------------------------------------------------
  // Temporal Discounting
  // --------------------------------------------------------------------------

  private mapToTemporalDiscounting(
    scores: Record<string, DimensionScore>,
    d: Record<string, number>
  ): TemporalDiscountingProfile {
    const get = (k: string) => d[k] ?? 0.5;

    const score =
      (1 - get('timePreference')) * TEMPORAL_DISCOUNTING_WEIGHTS.timePreference_inverted +
      (1 - get('executionGap')) * TEMPORAL_DISCOUNTING_WEIGHTS.executionGap_inverted +
      get('riskTolerance') * TEMPORAL_DISCOUNTING_WEIGHTS.riskTolerance;

    let discountingRate: TemporalDiscountingProfile['discountingRate'];
    if (score < 0.25) discountingRate = 'hyperbolic_severe';
    else if (score < 0.45) discountingRate = 'hyperbolic_moderate';
    else if (score < 0.70) discountingRate = 'near_rational';
    else discountingRate = 'future_biased';

    const mechanismDescription = {
      hyperbolic_severe: "Strongly discounts future outcomes — present-self consistently overrides future-self's plans, causing predictable execution failures at the commitment stage",
      hyperbolic_moderate: "Moderate present bias — can plan for the future but willpower erodes under stress or competing immediate rewards",
      near_rational: "Reasonably consistent time preferences — discounts future at near-rational rate, executes on most plans with occasional slippage",
      future_biased: "Strong future orientation — may sacrifice present quality of life for future gains, occasionally to an irrational degree",
    }[discountingRate];

    const relDims = ['timePreference', 'executionGap', 'riskTolerance'];
    const confidence =
      relDims.reduce((sum, k) => sum + (scores[k]?.confidence ?? 0.1), 0) / relDims.length;

    return {
      discountingRate,
      score,
      confidence,
      presentBiasStrength: PRESENT_BIAS_STRENGTH[discountingRate],
      mechanismDescription,
    };
  }

  // --------------------------------------------------------------------------
  // Risk Flags
  // --------------------------------------------------------------------------

  private generateRiskFlags(
    bigFive: BigFiveProfile,
    attachment: AttachmentProfile,
    locus: LocusProfile,
    discounting: TemporalDiscountingProfile,
    d: Record<string, number>
  ): RiskFlag[] {
    const flags: RiskFlag[] = [];

    // 1. execution_overconfidence
    if (locus.score > 0.7 && (d.executionGap ?? 0.5) > 0.65) {
      flags.push({
        flag: 'execution_overconfidence',
        severity: 'high',
        description:
          "High internal locus combined with high execution gap — believes strongly in personal agency but behavioral data shows consistent follow-through failure. Will likely underestimate probability of simulation failure scenarios.",
        affectedScenarios: ['day_trading', 'startup_founding', 'career_change'],
      });
    }

    // 2. social_financial_contamination
    if (attachment.style === 'anxious' && (d.riskTolerance ?? 0.5) < 0.3) {
      flags.push({
        flag: 'social_financial_contamination',
        severity: 'high',
        description:
          "Anxious attachment combined with high loss aversion — financial decisions likely contaminated by social approval seeking. Will struggle to exit losing positions when doing so creates social friction.",
        affectedScenarios: ['day_trading', 'startup_founding', 'real_estate_purchase'],
      });
    }

    // 3. planning_paralysis
    if (
      bigFive.conscientiousness > 0.7 &&
      discounting.discountingRate === 'hyperbolic_moderate' &&
      (d.informationSeeking ?? 0.5) > 0.7
    ) {
      flags.push({
        flag: 'planning_paralysis',
        severity: 'medium',
        description:
          "High conscientiousness combined with information over-seeking and moderate present bias — creates a planning loop where more research substitutes for action. Plans are detailed and well-researched but execution timing is perpetually delayed.",
        affectedScenarios: ['career_change', 'real_estate_purchase', 'advanced_degree'],
      });
    }

    // 4. stress_capitulation
    if (attachment.style === 'disorganized' || (bigFive.neuroticism > 0.75 && (d.stressResponse ?? 0.5) > 0.65)) {
      flags.push({
        flag: 'stress_capitulation',
        severity: 'high',
        description:
          "High emotional volatility under stress — simulation scenarios involving sustained pressure (market downturns, business setbacks) are likely to trigger capitulation behavior that statistical models underestimate.",
        affectedScenarios: ['day_trading', 'startup_founding', 'health_fitness_goal'],
      });
    }

    // 5. autonomous_drift
    if (
      locus.type === 'external' &&
      (d.socialDependency ?? 0.5) > 0.7 &&
      (d.executionGap ?? 0.5) > 0.5
    ) {
      flags.push({
        flag: 'autonomous_drift',
        severity: 'medium',
        description:
          "External locus combined with high social dependence and execution gap — this user may commit to decisions primarily based on social momentum rather than personal conviction, leading to high abandonment rates when social reinforcement fades.",
        affectedScenarios: ['geographic_relocation', 'advanced_degree', 'health_fitness_goal'],
      });
    }

    return flags;
  }

  // --------------------------------------------------------------------------
  // Text generation helpers
  // --------------------------------------------------------------------------

  private buildNarrativeSummary(
    bigFive: BigFiveProfile,
    attachment: AttachmentProfile,
    locus: LocusProfile,
    discounting: TemporalDiscountingProfile,
    riskFlags: RiskFlag[]
  ): string {
    const sentences: string[] = [];

    // Sentence 1: Core behavioral identity
    const highN = bigFive.neuroticism > 0.65;
    const highC = bigFive.conscientiousness > 0.6;
    const lowC = bigFive.conscientiousness < 0.4;
    const highO = bigFive.openness > 0.65;

    if (highC && !highN) {
      sentences.push(
        "This person is generally disciplined and follows through on commitments — their strongest asset is the ability to execute plans consistently over time."
      );
    } else if (lowC && highN) {
      sentences.push(
        "This person has strong analytical abilities and genuinely wants to make good decisions, but their behavioral data shows a consistent pattern of planning without executing — especially under time pressure or when the stakes feel high."
      );
    } else if (highO && lowC) {
      sentences.push(
        "This person is intellectually curious and generates excellent plans, but tends to move on to the next interesting idea before finishing the current one."
      );
    } else {
      sentences.push(
        "This person demonstrates moderate consistency between intention and action, with behaviors that vary depending on the domain and stress level."
      );
    }

    // Sentence 2: Social / attachment pattern
    if (attachment.style === 'anxious') {
      sentences.push(
        "They tend to seek external validation before committing to major decisions, which slows them down and makes them vulnerable to social pressure."
      );
    } else if (attachment.style === 'avoidant') {
      sentences.push(
        "They prefer to operate independently and make decisions without consulting others, which can be a strength in familiar domains but a liability in scenarios requiring collaboration or mentorship."
      );
    } else if (attachment.style === 'disorganized') {
      sentences.push(
        "Their relationship with social input is inconsistent — they oscillate between strong social dependence and avoidance, which makes their decision-making hard to predict in group or high-stakes social contexts."
      );
    } else {
      sentences.push(
        "Their relationship with social input is balanced — they seek relevant advice without being overly reliant on external validation."
      );
    }

    // Sentence 3: Stress / discounting behavior
    if (discounting.discountingRate === 'hyperbolic_severe') {
      sentences.push(
        "Under stress they're highly likely to abandon long-term plans in favor of immediate relief — the gap between stated intentions and actual behavior widens significantly when conditions deteriorate."
      );
    } else if (discounting.discountingRate === 'hyperbolic_moderate') {
      sentences.push(
        "Under stress they're likely to abandon positions too early or delay commitments too long — moderate present bias means willpower erodes when competing immediate demands appear."
      );
    } else if (discounting.discountingRate === 'future_biased') {
      sentences.push(
        "They have a strong tendency to sacrifice present comfort for future gains — valuable for long-term compounding scenarios, but may underinvest in present wellbeing or relationships."
      );
    } else {
      sentences.push(
        "Their time preferences are reasonably consistent — they can commit to multi-month plans and generally follow through with occasional slippage."
      );
    }

    // Sentence 4: Asset/liability summary
    const highFlags = riskFlags.filter(f => f.severity === 'high');
    if (highFlags.length > 0) {
      const flagLabel = highFlags[0].flag.replace(/_/g, ' ');
      sentences.push(
        `Their biggest liability is the ${flagLabel} pattern — behavioral data suggests this is the most likely failure mode across simulation scenarios.`
      );
    } else if (locus.type === 'internal' && bigFive.conscientiousness > 0.6) {
      sentences.push(
        "Their strongest asset is internal ownership combined with consistent execution — simulation outcomes improve significantly when the decision domain matches their competence zone."
      );
    } else {
      sentences.push(
        `Their ${bigFive.dominantTrait === 'O' ? 'openness and adaptability' : bigFive.dominantTrait === 'C' ? 'conscientiousness' : 'analytical depth'} is their strongest asset in simulation scenarios that reward it.`
      );
    }

    return sentences.join(' ');
  }

  private buildTechnicalSummary(
    bigFive: BigFiveProfile,
    attachment: AttachmentProfile,
    locus: LocusProfile,
    discounting: TemporalDiscountingProfile,
    riskFlags: RiskFlag[]
  ): string {
    const fmt = (n: number) => n.toFixed(2);

    const bf = `Big Five: O[${fmt(bigFive.openness)}] C[${fmt(bigFive.conscientiousness)}] E[${fmt(bigFive.extraversion)}] A[${fmt(bigFive.agreeableness)}] N[${fmt(bigFive.neuroticism)}] — dominant ${bigFive.dominantTrait}, deficit ${bigFive.deficitTrait}.`;
    const att = `Attachment: ${attachment.style} (anxiety=${fmt(attachment.anxietyAxis)}, avoidance=${fmt(attachment.avoidanceAxis)}) — ${attachment.primarySignals.slice(0, 2).join(', ') || 'no dominant signals'}.`;
    const loc = `Locus: ${locus.type} (${fmt(locus.score)}) — ${locus.implication.slice(0, 60)}${locus.implication.length > 60 ? '...' : ''}.`;
    const td = `Temporal discounting: ${discounting.discountingRate} (${fmt(discounting.score)}) — ${discounting.mechanismDescription.slice(0, 80)}${discounting.mechanismDescription.length > 80 ? '...' : ''}.`;
    const rf =
      riskFlags.length > 0
        ? `Risk flags: ${riskFlags.map(f => `${f.flag}[${f.severity}]`).join(', ')}.`
        : 'Risk flags: none.';

    return [bf, att, loc, td, rf].join('\n');
  }

  // --------------------------------------------------------------------------
  // Internal arithmetic helpers
  // --------------------------------------------------------------------------

  /**
   * Converts Record<string, DimensionScore> → plain {[dim]: value}
   * Uses 0.5 as the neutral fallback for any missing dimension.
   */
  private toValueMap(scores: Record<string, DimensionScore>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(scores)) {
      out[k] = v.value;
    }
    return out;
  }

  /**
   * Returns info about a single dimension for weighted average purposes.
   * A dimension is "excluded" if its confidence < threshold or isEstimated.
   */
  private getDimensionInfo(
    dim: string,
    scores: Record<string, DimensionScore>,
    d: Record<string, number>
  ): DimInfo {
    const score = scores[dim];
    if (!score) return { value: 0.5, included: false, confidence: 0.1 };
    const included = score.confidence >= CONFIDENCE_MIN_THRESHOLD && !score.isEstimated;
    return { value: d[dim] ?? 0.5, included, confidence: score.confidence };
  }

  /**
   * Weighted average over a list of {dim, weight, invert} entries.
   * Only included dimensions contribute. If none are included, returns
   * { value: 0.5, confidence: 0.1 }.
   */
  private weightedAvg(
    inputs: Array<{ dim: string; weight: number; invert: boolean }>,
    scores: Record<string, DimensionScore>,
    d: Record<string, number>
  ): { value: number; confidence: number } {
    let weightedSum = 0;
    let totalWeight = 0;
    let confidenceSum = 0;
    let includedCount = 0;

    for (const { dim, weight, invert } of inputs) {
      const info = this.getDimensionInfo(dim, scores, d);
      if (!info.included) continue;
      const v = invert ? 1 - info.value : info.value;
      weightedSum += v * weight;
      totalWeight += weight;
      confidenceSum += info.confidence;
      includedCount++;
    }

    if (totalWeight === 0) return { value: 0.5, confidence: 0.1 };
    return {
      value: Math.max(0, Math.min(1, weightedSum / totalWeight)),
      confidence: confidenceSum / includedCount,
    };
  }
}
