// Base World Agent for Monte Engine
// Provides empirical data models and market conditions

import { 
  WorldAgent, 
  WorldEvent, 
  CloneExecutionContext, 
  MarketConditions,
  OutcomeEffect 
} from '../types.js';
import { getBaseRate } from '../baseRateRegistry.js';

export interface WorldState {
  date: Date;
  conditions: MarketConditions;
  events: WorldEvent[];
}

export abstract class BaseWorldAgent implements WorldAgent {
  abstract type: string;
  
  // Current world state
  protected currentState: WorldState = {
    date: new Date(),
    conditions: {
      volatility: 0.15,
      trend: 'neutral',
      inflationRate: 0.03,
    },
    events: [],
  };

  // Evaluate context and return world event if applicable
  abstract evaluate(context: CloneExecutionContext): WorldEvent | null;

  // Update internal state (e.g., advance time, update market conditions)
  abstract advanceTime(months: number): void;

  // Get current market conditions
  getMarketConditions(): MarketConditions {
    return { ...this.currentState.conditions };
  }

  // Reset to initial state
  reset(): void {
    this.currentState = {
      date: new Date(),
      conditions: {
        volatility: 0.15,
        trend: 'neutral',
        inflationRate: 0.03,
      },
      events: [],
    };
  }

  // Helper: Generate random event based on probability
  protected roll(probability: number): boolean {
    return Math.random() < probability;
  }

  // Helper: Get random number in range
  protected randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  // Helper: Apply normal distribution
  protected randomNormal(mean: number, stdDev: number): number {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
  }

  // Helper: Calculate modified probability based on clone parameters
  protected applyBehavioralModifiers(
    baseProbability: number,
    context: CloneExecutionContext,
    modifiers: Array<{ trait: string; threshold: number; factor: number }>
  ): number {
    let probability = baseProbability;
    const { parameters } = context;

    for (const mod of modifiers) {
      const traitValue = parameters[mod.trait as keyof typeof parameters];
      if (traitValue !== undefined && traitValue > mod.threshold) {
        probability *= mod.factor;
      }
    }

    return Math.min(1, Math.max(0, probability));
  }

  // Create a world event
  protected createEvent(
    type: string,
    description: string,
    impacts: OutcomeEffect[],
    probability: number
  ): WorldEvent {
    return {
      type,
      description,
      impact: impacts,
      probability,
    };
  }
}

const getRegistryRate = (
  scenario: string,
  metric: string,
  fallback: number,
  conditions?: string[],
): number => {
  return getBaseRate(scenario, metric, conditions)?.rate ?? fallback;
};

// Historical data sources
/** @deprecated Prefer querying @src/simulation/baseRateRegistry.ts directly. */
export const HISTORICAL_DATA = {
  // S&P 500 annual returns (1928-2023, inflation-adjusted)
  sp500: {
    meanReturn: getRegistryRate('day_trading', 'sp500_mean_return', 0.095), // 9.5% nominal
    meanRealReturn: 0.067, // 6.7% real
    volatility: 0.198,
    maxDrawdown: -0.507, // 2008
    bestYear: 0.47, // 1954
    worstYear: -0.438, // 1931
  },
  
  // Job market data (US Bureau of Labor Statistics)
  jobMarket: {
    averageTenure: getRegistryRate('career_change', 'average_tenure_years', 4.1, ['us_workers', 'all_industries']), // years
    voluntaryQuitRate: getRegistryRate('career_change', 'voluntary_quit_rate_monthly', 0.024, ['us_workers', 'all_industries', 'monthly']), // monthly
    layoffRate: getRegistryRate('career_change', 'layoff_rate_monthly', 0.011, ['us_workers', 'all_industries', 'monthly']), // monthly
    salaryGrowth: getRegistryRate('career_change', 'salary_growth_annual', 0.035, ['us_workers', 'private_industry']), // annual
    jobSearchDuration: getRegistryRate('career_change', 'job_search_duration_months', 5.8, ['us_workers']), // months average
  },
  
  // Education ROI data
  education: {
    bachelorsROI: 0.14, // 14% annual return
    mastersROI: 0.12,
    mbaROI: 0.15,
    completionRates: {
      bachelors: getRegistryRate('advanced_degree', 'completion_rate_bachelors', 0.62, ['4yr_institution', 'first_time_students']),
      masters: getRegistryRate('advanced_degree', 'completion_rate_masters', 0.78, ['graduate_program']),
      mba: getRegistryRate('advanced_degree', 'completion_rate_mba', 0.95, ['accredited_program']),
      bootcamp: getRegistryRate('career_change', 'completion_rate_bootcamp', 0.71, ['coding_bootcamp']),
    },
  },
  
  // Real estate historical
  realEstate: {
    annualAppreciation: getRegistryRate('real_estate_purchase', 'annual_appreciation', 0.035, ['us_national_average']),
    volatility: 0.08,
    maintenanceCostPct: 0.015, // of value annually
  },
  
  // Inflation targets
  inflation: {
    target: 0.02,
    historical: {
      mean: 0.031,
      volatility: 0.028,
    },
  },
};

// Utility functions for calculations
export function calculateCompoundReturn(
  principal: number,
  annualReturn: number,
  years: number,
  volatility: number = 0
): number {
  if (volatility === 0) {
    return principal * Math.pow(1 + annualReturn, years);
  }
  
  // Monte Carlo style with volatility
  const monthlyReturn = annualReturn / 12;
  const monthlyVol = volatility / Math.sqrt(12);
  let value = principal;
  
  for (let i = 0; i < years * 12; i++) {
    const randomReturn = monthlyReturn + (Math.random() - 0.5) * monthlyVol * 2;
    value *= (1 + randomReturn);
  }
  
  return value;
}

export function simulateMarketReturn(
  years: number,
  baseReturn: number = HISTORICAL_DATA.sp500.meanReturn,
  volatility: number = HISTORICAL_DATA.sp500.volatility
): number {
  const annualizedReturn = baseReturn + (Math.random() - 0.5) * volatility * 2;
  return Math.pow(1 + annualizedReturn, years) - 1;
}

export function calculatePercentile(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export function calculateStandardDeviation(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(variance);
}
