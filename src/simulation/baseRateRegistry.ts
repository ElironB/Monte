export interface BaseRate {
  id: string;
  domain: string;
  scenario: string;
  metric: string;
  // Usually normalized 0-1, but some metrics are absolute values like years or months.
  rate: number;
  confidenceInterval: [number, number];
  source: string;
  sourceUrl?: string;
  sampleSize?: number;
  dataYear: number;
  conditions: string[];
  version: number;
}

const BASE_RATES: BaseRate[] = [
  {
    id: 'dt-ruin-12m',
    domain: 'finance',
    scenario: 'day_trading',
    metric: 'capital_ruin_12m',
    rate: 0.9,
    confidenceInterval: [0.85, 0.93],
    source: 'ESMA retail trader study',
    sourceUrl: 'https://www.esma.europa.eu/sites/default/files/library/2019-esma35-43-1957_final_report_on_cfd_provider.pdf',
    sampleSize: 280000,
    dataYear: 2018,
    conditions: ['retail_trader', 'cfd_leverage'],
    version: 1,
  },
  {
    id: 'dt-breakeven',
    domain: 'finance',
    scenario: 'day_trading',
    metric: 'break_even',
    rate: 0.08,
    confidenceInterval: [0.05, 0.12],
    source: 'ESMA retail trader study',
    dataYear: 2018,
    conditions: ['retail_trader'],
    version: 1,
  },
  {
    id: 'su-fail-5yr',
    domain: 'career',
    scenario: 'startup_founding',
    metric: 'failure_5yr',
    rate: 0.5,
    confidenceInterval: [0.45, 0.55],
    source: 'BLS Business Employment Dynamics',
    sourceUrl: 'https://www.bls.gov/bdm/entrepreneurship/entrepreneurship.htm',
    dataYear: 2023,
    conditions: ['all_industries'],
    version: 1,
  },
  {
    id: 'su-fail-10yr',
    domain: 'career',
    scenario: 'startup_founding',
    metric: 'failure_10yr',
    rate: 0.9,
    confidenceInterval: [0.87, 0.93],
    source: 'BLS Business Employment Dynamics',
    dataYear: 2023,
    conditions: ['all_industries'],
    version: 1,
  },
  {
    id: 'su-vc-funding',
    domain: 'finance',
    scenario: 'startup_founding',
    metric: 'vc_funding_success',
    rate: 0.006,
    confidenceInterval: [0.004, 0.01],
    source: 'Crunchbase 2023 annual report',
    dataYear: 2023,
    conditions: ['us_market', 'seed_stage'],
    version: 1,
  },
  {
    id: 'ed-bachelors-completion',
    domain: 'education',
    scenario: 'advanced_degree',
    metric: 'completion_rate_bachelors',
    rate: 0.62,
    confidenceInterval: [0.58, 0.66],
    source: 'NCES 2023 Digest of Education Statistics',
    sourceUrl: 'https://nces.ed.gov/programs/digest/',
    dataYear: 2023,
    conditions: ['4yr_institution', 'first_time_students'],
    version: 1,
  },
  {
    id: 'ed-masters-completion',
    domain: 'education',
    scenario: 'advanced_degree',
    metric: 'completion_rate_masters',
    rate: 0.78,
    confidenceInterval: [0.74, 0.82],
    source: 'NCES 2023',
    dataYear: 2023,
    conditions: ['graduate_program'],
    version: 1,
  },
  {
    id: 'ed-mba-completion',
    domain: 'education',
    scenario: 'advanced_degree',
    metric: 'completion_rate_mba',
    rate: 0.95,
    confidenceInterval: [0.92, 0.97],
    source: 'AACSB International',
    dataYear: 2022,
    conditions: ['accredited_program'],
    version: 1,
  },
  {
    id: 'ed-bootcamp-completion',
    domain: 'education',
    scenario: 'career_change',
    metric: 'completion_rate_bootcamp',
    rate: 0.71,
    confidenceInterval: [0.65, 0.77],
    source: 'CIRR outcomes reporting',
    dataYear: 2023,
    conditions: ['coding_bootcamp'],
    version: 1,
  },
  {
    id: 'cc-income-recovery',
    domain: 'career',
    scenario: 'career_change',
    metric: 'income_recovery_12m',
    rate: 0.45,
    confidenceInterval: [0.4, 0.5],
    source: 'LinkedIn Economic Graph',
    dataYear: 2023,
    conditions: ['professional_worker'],
    version: 1,
  },
  {
    id: 'hf-adherence-12m',
    domain: 'health',
    scenario: 'health_fitness_goal',
    metric: 'adherence_12m',
    rate: 0.19,
    confidenceInterval: [0.15, 0.23],
    source: 'NIH behavioral study',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/',
    dataYear: 2020,
    conditions: ['gym_membership', 'no_trainer'],
    version: 1,
  },
  {
    id: 're-annual-appreciation',
    domain: 'real_estate',
    scenario: 'real_estate_purchase',
    metric: 'annual_appreciation',
    rate: 0.035,
    confidenceInterval: [0.02, 0.05],
    source: 'Case-Shiller US National Home Price Index',
    dataYear: 2023,
    conditions: ['us_national_average'],
    version: 1,
  },
  {
    id: 'sp-mean-return',
    domain: 'finance',
    scenario: 'day_trading',
    metric: 'sp500_mean_return',
    rate: 0.095,
    confidenceInterval: [0.07, 0.12],
    source: 'S&P 500 historical data 1928-2023',
    dataYear: 2023,
    conditions: ['nominal_return', 'us_market'],
    version: 1,
  },
  {
    id: 'jm-avg-tenure',
    domain: 'career',
    scenario: 'career_change',
    metric: 'average_tenure_years',
    rate: 4.1,
    confidenceInterval: [3.8, 4.4],
    source: 'Bureau of Labor Statistics',
    sourceUrl: 'https://www.bls.gov/news.release/tenure.nr0.htm',
    dataYear: 2024,
    conditions: ['us_workers', 'all_industries'],
    version: 1,
  },
  {
    id: 'jm-search-duration',
    domain: 'career',
    scenario: 'career_change',
    metric: 'job_search_duration_months',
    rate: 5.8,
    confidenceInterval: [4.5, 7],
    source: 'Bureau of Labor Statistics',
    sourceUrl: 'https://www.bls.gov/news.release/empsit.t12.htm',
    dataYear: 2024,
    conditions: ['us_workers'],
    version: 1,
  },
  {
    id: 'jm-quit-rate',
    domain: 'career',
    scenario: 'career_change',
    metric: 'voluntary_quit_rate_monthly',
    rate: 0.024,
    confidenceInterval: [0.021, 0.027],
    source: 'Bureau of Labor Statistics Job Openings and Labor Turnover Survey',
    sourceUrl: 'https://www.bls.gov/jlt/',
    dataYear: 2024,
    conditions: ['us_workers', 'all_industries', 'monthly'],
    version: 1,
  },
  {
    id: 'jm-layoff-rate',
    domain: 'career',
    scenario: 'career_change',
    metric: 'layoff_rate_monthly',
    rate: 0.011,
    confidenceInterval: [0.009, 0.013],
    source: 'Bureau of Labor Statistics Job Openings and Labor Turnover Survey',
    sourceUrl: 'https://www.bls.gov/jlt/',
    dataYear: 2024,
    conditions: ['us_workers', 'all_industries', 'monthly'],
    version: 1,
  },
  {
    id: 'jm-salary-growth',
    domain: 'career',
    scenario: 'career_change',
    metric: 'salary_growth_annual',
    rate: 0.035,
    confidenceInterval: [0.03, 0.04],
    source: 'Bureau of Labor Statistics Employment Cost Index',
    sourceUrl: 'https://www.bls.gov/eci/',
    dataYear: 2024,
    conditions: ['us_workers', 'private_industry'],
    version: 1,
  },
];

function countMatchingConditions(baseRateConditions: string[], queryConditions: string[]): number {
  const baseRateConditionSet = new Set(baseRateConditions);
  return queryConditions.reduce((matches, condition) => {
    return matches + (baseRateConditionSet.has(condition) ? 1 : 0);
  }, 0);
}

export function getBaseRate(
  scenario: string,
  metric: string,
  conditions: string[] = [],
): BaseRate | undefined {
  const matchingRates = BASE_RATES.filter((baseRate) => {
    return baseRate.scenario === scenario && baseRate.metric === metric;
  });

  if (matchingRates.length === 0) {
    return undefined;
  }

  if (conditions.length === 0) {
    return matchingRates[0];
  }

  const compatibleRates = matchingRates.filter((baseRate) => {
    return conditions.every((condition) => baseRate.conditions.includes(condition));
  });

  if (compatibleRates.length === 0) {
    return undefined;
  }

  return [...compatibleRates].sort((left, right) => {
    const leftMatches = countMatchingConditions(left.conditions, conditions);
    const rightMatches = countMatchingConditions(right.conditions, conditions);

    if (leftMatches !== rightMatches) {
      return rightMatches - leftMatches;
    }

    if (left.conditions.length !== right.conditions.length) {
      return right.conditions.length - left.conditions.length;
    }

    return right.version - left.version;
  })[0];
}

export function getScenarioRates(scenario: string): BaseRate[] {
  return BASE_RATES.filter((baseRate) => baseRate.scenario === scenario);
}

export function getDomainRates(domain: string): BaseRate[] {
  return BASE_RATES.filter((baseRate) => baseRate.domain === domain);
}

export function applyPersonaModulation(
  baseRate: number,
  personaScore: number,
  maxDeviation: number = 0.08,
): number {
  const delta = (personaScore - 0.5) * maxDeviation * 2;
  return Math.max(0, Math.min(1, baseRate + delta));
}

export { BASE_RATES };
