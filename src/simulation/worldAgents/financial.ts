// Financial World Agent - Market returns, inflation, liquidity models
// Based on historical S&P 500 data and economic indicators

import { BaseWorldAgent, HISTORICAL_DATA, simulateMarketReturn } from './base.js';
import { CloneExecutionContext, WorldEvent, OutcomeEffect } from '../types.js';
import { getBaseRate, applyPersonaModulation } from '../baseRateRegistry.js';

interface FinancialState {
  portfolioValue: number;
  cashPosition: number;
  monthlySavings: number;
  riskProfile: 'conservative' | 'moderate' | 'aggressive';
  allocation: {
    stocks: number;
    bonds: number;
    cash: number;
  };
  returns: {
    monthly: number[];
    annual: number[];
  };
  maxDrawdown: number;
  currentDrawdown: number;
}

export class FinancialWorldAgent extends BaseWorldAgent {
  type = 'financial';
  
  private state: FinancialState = {
    portfolioValue: 0,
    cashPosition: 0,
    monthlySavings: 0,
    riskProfile: 'moderate',
    allocation: { stocks: 0.6, bonds: 0.3, cash: 0.1 },
    returns: { monthly: [], annual: [] },
    maxDrawdown: 0,
    currentDrawdown: 0,
  };

  // Initialize with starting conditions
  initialize(
    startingCapital: number,
    monthlySavings: number = 0,
    riskTolerance: number = 0.5
  ): void {
    this.state.portfolioValue = startingCapital;
    this.state.cashPosition = startingCapital * 0.1;
    this.state.monthlySavings = monthlySavings;
    
    // Set risk profile and allocation based on risk tolerance
    if (riskTolerance < 0.3) {
      this.state.riskProfile = 'conservative';
      this.state.allocation = { stocks: 0.4, bonds: 0.5, cash: 0.1 };
    } else if (riskTolerance > 0.7) {
      this.state.riskProfile = 'aggressive';
      this.state.allocation = { stocks: 0.9, bonds: 0.08, cash: 0.02 };
    } else {
      this.state.riskProfile = 'moderate';
      this.state.allocation = { stocks: 0.6, bonds: 0.3, cash: 0.1 };
    }
    
    this.state.returns = { monthly: [], annual: [] };
    this.state.maxDrawdown = 0;
    this.state.currentDrawdown = 0;
  }

  // Advance simulation by months
  advanceTime(months: number): void {
    for (let i = 0; i < months; i++) {
      this.simulateMonth();
    }
    
    // Update inflation based on historical patterns
    const annualInflation = this.randomNormal(
      HISTORICAL_DATA.inflation.historical.mean,
      HISTORICAL_DATA.inflation.historical.volatility
    );
    this.currentState.conditions.inflationRate = annualInflation;
  }

  // Simulate one month of market activity
  private simulateMonth(): void {
    const { allocation } = this.state;
    const sp500Return = getBaseRate('day_trading', 'sp500_mean_return')?.rate ?? 0.095;
    const adjustedSp500Return = applyPersonaModulation(sp500Return, 0.5);
    
    // Stock returns (monthly)
    const monthlyStockReturn = this.randomNormal(
      adjustedSp500Return / 12,
      HISTORICAL_DATA.sp500.volatility / Math.sqrt(12)
    );
    
    // Bond returns (lower volatility, different mean)
    const monthlyBondReturn = this.randomNormal(0.003, 0.008);
    
    // Cash return (inflation adjusted, slightly negative real return)
    const monthlyCashReturn = this.currentState.conditions.inflationRate / 12 - 0.001;
    
    // Calculate weighted return
    const portfolioReturn = 
      allocation.stocks * monthlyStockReturn +
      allocation.bonds * monthlyBondReturn +
      allocation.cash * monthlyCashReturn;
    
    // Apply return to portfolio
    const previousValue = this.state.portfolioValue;
    this.state.portfolioValue *= (1 + portfolioReturn);
    
    // Add monthly savings
    this.state.portfolioValue += this.state.monthlySavings;
    this.state.cashPosition += this.state.monthlySavings * 0.1;
    
    // Track returns
    this.state.returns.monthly.push(portfolioReturn);
    
    // Calculate drawdown
    const peak = Math.max(previousValue, this.state.portfolioValue);
    const drawdown = (this.state.portfolioValue - peak) / peak;
    this.state.currentDrawdown = drawdown;
    
    if (drawdown < this.state.maxDrawdown) {
      this.state.maxDrawdown = drawdown;
    }
    
    // Update market conditions
    this.currentState.conditions.volatility = HISTORICAL_DATA.sp500.volatility * 
      (1 + Math.random() * 0.3 - 0.15);
    
    // Update trend based on recent performance
    const recentReturns = this.state.returns.monthly.slice(-6);
    const avgRecent = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
    
    if (avgRecent > 0.02) {
      this.currentState.conditions.trend = 'bull';
    } else if (avgRecent < -0.02) {
      this.currentState.conditions.trend = 'bear';
    } else {
      this.currentState.conditions.trend = 'neutral';
    }
  }

  // Evaluate context and return financial world event
  evaluate(context: CloneExecutionContext): WorldEvent | null {
    const { state, parameters } = context;
    const events: WorldEvent[] = [];
    
    // Market crash event (low probability)
    const crashProbability = this.applyBehavioralModifiers(
      0.05, // 5% base chance per evaluation
      context,
      [
        { trait: 'riskTolerance', threshold: 0.8, factor: 1.5 }, // Higher risk = more exposure to crashes
        { trait: 'emotionalVolatility', threshold: 0.7, factor: 0.8 }, // Emotional traders may exit before crashes
      ]
    );
    
    if (this.roll(crashProbability)) {
      const crashSeverity = this.randomRange(0.15, 0.45);
      events.push(this.createEvent(
        'market_crash',
        `Market downturn: Portfolio lost ${(crashSeverity * 100).toFixed(1)}%`,
        [
          { target: 'capital', delta: -state.capital * crashSeverity, type: 'absolute' },
          { target: 'metrics.stressLevel', delta: 0.3, type: 'absolute' },
        ],
        crashProbability
      ));
    }
    
    // Bull market event
    const bullProbability = this.applyBehavioralModifiers(
      0.15,
      context,
      [
        { trait: 'decisionSpeed', threshold: 0.7, factor: 1.3 }, // Quick decision makers catch momentum
      ]
    );
    
    if (this.roll(bullProbability)) {
      const gain = this.randomRange(0.1, 0.3);
      events.push(this.createEvent(
        'bull_market',
        `Strong market performance: Portfolio gained ${(gain * 100).toFixed(1)}%`,
        [
          { target: 'capital', delta: state.capital * gain, type: 'absolute' },
          { target: 'happiness', delta: 0.15, type: 'absolute' },
        ],
        bullProbability
      ));
    }
    
    // Liquidity crisis (very low probability)
    if (state.capital < 5000 && this.roll(0.02)) {
      events.push(this.createEvent(
        'liquidity_crisis',
        'Emergency: Insufficient capital for immediate needs',
        [
          { target: 'health', delta: -0.1, type: 'absolute' },
          { target: 'happiness', delta: -0.2, type: 'absolute' },
          { target: 'metrics.stressLevel', delta: 0.4, type: 'absolute' },
        ],
        0.02
      ));
    }
    
    // Inflation impact
    const inflationImpact = this.currentState.conditions.inflationRate > 0.05;
    if (inflationImpact && this.roll(0.3)) {
      const erosion = state.capital * (this.currentState.conditions.inflationRate * 0.5);
      events.push(this.createEvent(
        'inflation_erosion',
        `High inflation eroding purchasing power: -$${erosion.toFixed(0)}`,
        [
          { target: 'capital', delta: -erosion, type: 'absolute' },
        ],
        0.3
      ));
    }
    
    // Return most significant event or null
    if (events.length === 0) return null;
    
    // Sort by impact magnitude and return first
    return events.sort((a, b) => {
      const impactA = Math.abs(a.impact.reduce((sum, e) => sum + e.delta, 0));
      const impactB = Math.abs(b.impact.reduce((sum, e) => sum + e.delta, 0));
      return impactB - impactA;
    })[0];
  }

  // Get current financial snapshot
  getSnapshot(): {
    portfolioValue: number;
    cashPosition: number;
    totalValue: number;
    ytdReturn: number;
    maxDrawdown: number;
    riskProfile: string;
  } {
    const totalValue = this.state.portfolioValue + this.state.cashPosition;
    const monthlyReturns = this.state.returns.monthly;
    const ytdReturn = monthlyReturns.length > 0
      ? monthlyReturns.reduce((a, b) => a + b, 0)
      : 0;
    
    return {
      portfolioValue: this.state.portfolioValue,
      cashPosition: this.state.cashPosition,
      totalValue,
      ytdReturn,
      maxDrawdown: this.state.maxDrawdown,
      riskProfile: this.state.riskProfile,
    };
  }

  // Calculate portfolio value after N years with Monte Carlo simulation
  simulateLongTerm(years: number, iterations: number = 100): {
    mean: number;
    median: number;
    p5: number;
    p95: number;
    probabilityOfProfit: number;
  } {
    const results: number[] = [];
    const initialValue = this.state.portfolioValue;
    
    for (let i = 0; i < iterations; i++) {
      // Create temporary state for simulation
      const tempValue = initialValue;
      let finalValue = tempValue;
      
      for (let year = 0; year < years; year++) {
        const annualReturn = simulateMarketReturn(1);
        finalValue *= (1 + annualReturn);
        finalValue += this.state.monthlySavings * 12;
      }
      
      results.push(finalValue);
    }
    
    results.sort((a, b) => a - b);
    
    const mean = results.reduce((a, b) => a + b, 0) / results.length;
    const median = results[Math.floor(results.length / 2)];
    const p5 = results[Math.floor(results.length * 0.05)];
    const p95 = results[Math.floor(results.length * 0.95)];
    const profitable = results.filter(r => r > initialValue).length;
    
    return {
      mean,
      median,
      p5,
      p95,
      probabilityOfProfit: profitable / iterations,
    };
  }

  // Override reset
  reset(): void {
    super.reset();
    this.state = {
      portfolioValue: 0,
      cashPosition: 0,
      monthlySavings: 0,
      riskProfile: 'moderate',
      allocation: { stocks: 0.6, bonds: 0.3, cash: 0.1 },
      returns: { monthly: [], annual: [] },
      maxDrawdown: 0,
      currentDrawdown: 0,
    };
  }
}

// Export factory function
export function createFinancialAgent(
  startingCapital: number,
  monthlySavings?: number,
  riskTolerance?: number
): FinancialWorldAgent {
  const agent = new FinancialWorldAgent();
  agent.initialize(startingCapital, monthlySavings, riskTolerance);
  return agent;
}
