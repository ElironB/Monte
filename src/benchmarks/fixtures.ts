import { deriveEvidenceAdjustments } from '../simulation/evidenceLoop.js';
import type { CausalState, CloneParameters, EvidenceResult } from '../simulation/types.js';
import { ScenarioType } from '../simulation/types.js';

export interface BenchmarkCloneProfile {
  id: string;
  stratification: {
    percentile: number;
    category: 'edge' | 'central' | 'typical';
  };
  parameters: CloneParameters;
}

export interface BenchmarkPolicyBaseline {
  id: string;
  label: string;
  decisionOverrides: Record<string, string>;
}

export interface BenchmarkEvidenceExpectation {
  minUncertaintyReduction: number;
  confidenceDirection?: 'increase' | 'decrease';
  minAbsoluteConfidenceShift?: number;
  downsideDirection?: 'increase' | 'decrease';
  allowedTopFocusMetrics?: string[];
  mustChangeTopRecommendation?: boolean;
}

export interface BenchmarkEvidenceFixture {
  id: string;
  title: string;
  evidence: EvidenceResult[];
  expectations: BenchmarkEvidenceExpectation;
}

export interface BenchmarkCaseFixture {
  id: string;
  title: string;
  causalBias?: Partial<Record<keyof CausalState, number>>;
  scenario: {
    scenarioType: ScenarioType;
    name: string;
    capitalAtRisk: number;
    parameters: Record<string, unknown>;
  };
  expectedSuccessRate: number;
  calibrationTolerance: number;
  maxStaticPolicyRegret: number;
  policyBaselines: BenchmarkPolicyBaseline[];
  evidenceFixtures?: BenchmarkEvidenceFixture[];
}

const aggressiveParameters: CloneParameters = {
  riskTolerance: 0.9,
  timePreference: 0.72,
  socialDependency: 0.24,
  learningStyle: 0.36,
  decisionSpeed: 0.84,
  emotionalVolatility: 0.7,
  executionGap: 0.24,
  informationSeeking: 0.34,
  stressResponse: 0.26,
};

const cautiousParameters: CloneParameters = {
  riskTolerance: 0.2,
  timePreference: 0.24,
  socialDependency: 0.76,
  learningStyle: 0.84,
  decisionSpeed: 0.24,
  emotionalVolatility: 0.36,
  executionGap: 0.18,
  informationSeeking: 0.9,
  stressResponse: 0.66,
};

const operatorParameters: CloneParameters = {
  riskTolerance: 0.56,
  timePreference: 0.44,
  socialDependency: 0.34,
  learningStyle: 0.48,
  decisionSpeed: 0.58,
  emotionalVolatility: 0.32,
  executionGap: 0.12,
  informationSeeking: 0.58,
  stressResponse: 0.41,
};

const researcherParameters: CloneParameters = {
  riskTolerance: 0.34,
  timePreference: 0.32,
  socialDependency: 0.38,
  learningStyle: 0.88,
  decisionSpeed: 0.28,
  emotionalVolatility: 0.29,
  executionGap: 0.16,
  informationSeeking: 0.94,
  stressResponse: 0.37,
};

const socialBuilderParameters: CloneParameters = {
  riskTolerance: 0.48,
  timePreference: 0.42,
  socialDependency: 0.82,
  learningStyle: 0.52,
  decisionSpeed: 0.47,
  emotionalVolatility: 0.43,
  executionGap: 0.22,
  informationSeeking: 0.62,
  stressResponse: 0.46,
};

const impatientBuilderParameters: CloneParameters = {
  riskTolerance: 0.68,
  timePreference: 0.82,
  socialDependency: 0.31,
  learningStyle: 0.39,
  decisionSpeed: 0.78,
  emotionalVolatility: 0.58,
  executionGap: 0.26,
  informationSeeking: 0.41,
  stressResponse: 0.54,
};

const resilientGeneralistParameters: CloneParameters = {
  riskTolerance: 0.46,
  timePreference: 0.4,
  socialDependency: 0.29,
  learningStyle: 0.57,
  decisionSpeed: 0.52,
  emotionalVolatility: 0.22,
  executionGap: 0.1,
  informationSeeking: 0.66,
  stressResponse: 0.28,
};

export const BENCHMARK_CLONE_PROFILES: BenchmarkCloneProfile[] = [
  {
    id: 'edge_aggressive',
    stratification: { percentile: 95, category: 'edge' },
    parameters: aggressiveParameters,
  },
  {
    id: 'edge_cautious',
    stratification: { percentile: 5, category: 'edge' },
    parameters: cautiousParameters,
  },
  {
    id: 'typical_operator',
    stratification: { percentile: 55, category: 'typical' },
    parameters: operatorParameters,
  },
  {
    id: 'typical_researcher',
    stratification: { percentile: 35, category: 'typical' },
    parameters: researcherParameters,
  },
  {
    id: 'central_social_builder',
    stratification: { percentile: 62, category: 'central' },
    parameters: socialBuilderParameters,
  },
  {
    id: 'central_impatient_builder',
    stratification: { percentile: 42, category: 'central' },
    parameters: impatientBuilderParameters,
  },
  {
    id: 'typical_resilient_generalist',
    stratification: { percentile: 70, category: 'typical' },
    parameters: resilientGeneralistParameters,
  },
];


function createEvidenceFixture(params: {
  id: string;
  uncertainty: string;
  focusMetric: string;
  recommendedExperiment: string;
  result: EvidenceResult['result'];
  confidence: number;
  observedSignal: string;
  causalTargets: EvidenceResult['causalTargets'];
  beliefTargets: EvidenceResult['beliefTargets'];
  notes?: string;
}): EvidenceResult {
  const adjustments = deriveEvidenceAdjustments(
    params.result,
    params.confidence,
    params.causalTargets,
    params.beliefTargets,
  );

  return {
    id: params.id,
    uncertainty: params.uncertainty,
    focusMetric: params.focusMetric,
    recommendedExperiment: params.recommendedExperiment,
    result: params.result,
    confidence: params.confidence,
    observedSignal: params.observedSignal,
    notes: params.notes,
    createdAt: '2026-03-22T00:00:00.000Z',
    causalTargets: params.causalTargets,
    beliefTargets: params.beliefTargets,
    causalAdjustments: adjustments.causalAdjustments,
    beliefAdjustments: adjustments.beliefAdjustments,
  };
}
const STARTUP_POLICY_BASELINES: BenchmarkPolicyBaseline[] = [
  {
    id: 'always_bootstrap',
    label: 'Always bootstrap immediately',
    decisionOverrides: { start: 'bootstrap' },
  },
  {
    id: 'always_seed_raise',
    label: 'Always seek seed funding immediately',
    decisionOverrides: { start: 'seed_raise' },
  },
  {
    id: 'always_validate_first',
    label: 'Always validate before quitting',
    decisionOverrides: { start: 'validate_first' },
  },
];

const REAL_ESTATE_POLICY_BASELINES: BenchmarkPolicyBaseline[] = [
  {
    id: 'always_buy_now',
    label: 'Always buy immediately',
    decisionOverrides: { start: 'buy_now' },
  },
  {
    id: 'always_save_more',
    label: 'Always wait and save more',
    decisionOverrides: { start: 'save_more' },
  },
  {
    id: 'always_rent_invest',
    label: 'Always keep renting and invest instead',
    decisionOverrides: { start: 'rent_invest' },
  },
];

const DAY_TRADING_POLICY_BASELINES: BenchmarkPolicyBaseline[] = [
  {
    id: 'always_cautious',
    label: 'Always start cautiously',
    decisionOverrides: { start: 'cautious' },
  },
  {
    id: 'always_moderate',
    label: 'Always start with the moderate live-trading path',
    decisionOverrides: { start: 'moderate' },
  },
  {
    id: 'always_aggressive',
    label: 'Always start aggressively',
    decisionOverrides: { start: 'aggressive' },
  },
];

export const BENCHMARK_FIXTURE_VERSION = 'phase3-v2';

export const BENCHMARK_CASES: BenchmarkCaseFixture[] = [
  {
    id: 'startup_founding_seeded_corpus',
    title: 'Startup founding — seeded market variance',
    scenario: {
      scenarioType: ScenarioType.STARTUP_FOUNDING,
      name: 'Startup founding benchmark',
      capitalAtRisk: 100_000,
      parameters: {
        timeframe: 36,
        runwayMonths: 12,
        reversibilityScore: 0.34,
        socialExposure: 0.65,
        keyUnknowns: [
          'Will demand support the bet?',
          'Can you keep shipping without burning out?',
          'How much runway exists before the thesis breaks?',
        ],
      },
    },
    expectedSuccessRate: 4 / 7,
    calibrationTolerance: 0.05,
    maxStaticPolicyRegret: 0.18,
    policyBaselines: STARTUP_POLICY_BASELINES,
    evidenceFixtures: [
      {
        id: 'startup_paid_pilot_signal',
        title: 'Positive paid-pilot demand evidence',
        evidence: [
          createEvidenceFixture({
            id: 'evidence-startup-paid-pilots',
            uncertainty: 'Will demand support the bet?',
            focusMetric: 'beliefUncertainty',
            recommendedExperiment: 'Run direct paid-pilot asks with real budget owners before hiring.',
            result: 'positive',
            confidence: 0.86,
            observedSignal: 'Four design partners agreed to paid pilots after seeing the roadmap and pricing.',
            causalTargets: ['demandStrength', 'evidenceMomentum', 'marketTailwind'],
            beliefTargets: ['thesisConfidence', 'uncertaintyLevel', 'evidenceClarity'],
          }),
        ],
        expectations: {
          minUncertaintyReduction: 0.04,
          confidenceDirection: 'increase',
          minAbsoluteConfidenceShift: 0.02,
        },
      },
    ],
  },
  {
    id: 'real_estate_purchase_carry_costs',
    title: 'Real estate purchase — carrying-cost stress',
    scenario: {
      scenarioType: ScenarioType.REAL_ESTATE_PURCHASE,
      name: 'Real estate benchmark',
      capitalAtRisk: 60_000,
      parameters: {
        timeframe: 84,
        runwayMonths: 16,
        reversibilityScore: 0.28,
        socialExposure: 0.58,
        keyUnknowns: [
          'Can the monthly carrying cost survive a bad regime?',
          'How much optionality does the purchase remove?',
          'Are you buying because the asset is right or because the pressure is social?',
        ],
      },
    },
    expectedSuccessRate: 3 / 7,
    calibrationTolerance: 0.05,
    maxStaticPolicyRegret: 0.33,
    policyBaselines: REAL_ESTATE_POLICY_BASELINES,
    evidenceFixtures: [
      {
        id: 'real_estate_downside_model',
        title: 'Negative mortgage downside evidence',
        evidence: [
          createEvidenceFixture({
            id: 'evidence-real-estate-downside',
            uncertainty: 'Can the monthly carrying cost survive a bad regime?',
            focusMetric: 'burnRate',
            recommendedExperiment: 'Stress-test the payment with taxes, maintenance, and one bad income shock.',
            result: 'negative',
            confidence: 0.91,
            observedSignal: 'The downside model showed one modest shock would force a painful loss of flexibility.',
            causalTargets: ['runwayStress', 'reversibilityPressure'],
            beliefTargets: ['thesisConfidence', 'downsideSalience', 'uncertaintyLevel', 'reversibilityConfidence'],
          }),
        ],
        expectations: {
          minUncertaintyReduction: 0.03,
          downsideDirection: 'increase',
        },
      },
    ],
  },
  {
    id: 'day_trading_edge_discipline',
    title: 'Day trading — edge durability and drawdown discipline',
    scenario: {
      scenarioType: ScenarioType.DAY_TRADING,
      name: 'Day trading benchmark',
      capitalAtRisk: 50_000,
      parameters: {
        timeframe: 18,
        runwayMonths: 8,
        reversibilityScore: 0.46,
        socialExposure: 0.55,
        keyUnknowns: [
          'Is there a real edge?',
          'Can you execute under volatility?',
          'How much drawdown breaks discipline?',
        ],
      },
    },
    expectedSuccessRate: 4 / 7,
    calibrationTolerance: 0.05,
    maxStaticPolicyRegret: 0.28,
    policyBaselines: DAY_TRADING_POLICY_BASELINES,
    evidenceFixtures: [
      {
        id: 'day_trading_edge_validation',
        title: 'Positive live-edge validation',
        evidence: [
          createEvidenceFixture({
            id: 'evidence-day-trading-edge',
            uncertainty: 'Is there a real edge?',
            focusMetric: 'burnRate',
            recommendedExperiment: 'Validate the edge with slippage-adjusted live-size trades instead of paper gains.',
            result: 'positive',
            confidence: 0.79,
            observedSignal: 'Thirty live-size sessions stayed profitable after fees and slippage adjustments.',
            causalTargets: ['evidenceMomentum', 'executionCapacity', 'marketTailwind'],
            beliefTargets: ['thesisConfidence', 'uncertaintyLevel', 'evidenceClarity'],
          }),
        ],
        expectations: {
          minUncertaintyReduction: 0.03,
          confidenceDirection: 'increase',
          minAbsoluteConfidenceShift: 0.015,
        },
      },
    ],
  },
];
