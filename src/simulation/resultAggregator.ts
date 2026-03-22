// Result Aggregator - Histogram generation, outcome distributions, timeline data
// Aggregates 1000 clone results into probability distributions

import type { 
  CloneResult, 
  AggregatedResults, 
  Histogram, 
  Bin,
  OutcomeDistribution,
  TimelineData,
  SimulationStatistics,
  StratifiedBreakdown 
} from './types.js';
import { logger } from '../utils/logger.js';
import { getInitialState } from './decisionGraph.js';

export class ResultAggregator {
  private cloneResults: CloneResult[] = [];
  private scenarioId: string = '';
  private initialCapital: number = 0;

  constructor(scenarioId: string) {
    this.scenarioId = scenarioId;
    try {
      this.initialCapital = getInitialState(scenarioId).capital;
    } catch {
      this.initialCapital = 0;
    }
  }

  // Add a clone result
  addResult(result: CloneResult): void {
    this.cloneResults.push(result);
  }

  // Add multiple results
  addResults(results: CloneResult[]): void {
    this.cloneResults.push(...results);
  }

  // Aggregate all results
  aggregate(): AggregatedResults {
    if (this.cloneResults.length === 0) {
      throw new Error('No clone results to aggregate');
    }

    logger.info({ 
      scenarioId: this.scenarioId, 
      cloneCount: this.cloneResults.length 
    }, 'Aggregating simulation results');

    const histograms = this.generateHistograms();
    const outcomeDistribution = this.calculateOutcomeDistribution();
    const timeline = this.generateTimeline();
    const statistics = this.calculateStatistics();
    const stratifiedBreakdown = this.calculateStratifiedBreakdown();

    return {
      scenarioId: this.scenarioId,
      cloneCount: this.cloneResults.length,
      histograms,
      outcomeDistribution,
      timeline,
      statistics,
      stratifiedBreakdown,
    };
  }

  // Generate histograms for all metrics
  private generateHistograms(): Histogram[] {
    const metrics = this.extractAllMetrics();
    const histograms: Histogram[] = [];

    for (const metric of metrics) {
      const values = this.cloneResults.map(r => r.metrics[metric]).filter(v => v !== undefined);
      
      if (values.length === 0) continue;

      const histogram = this.createHistogram(metric, values);
      histograms.push(histogram);
    }

    // Add histograms for base metrics
    const capitals = this.cloneResults.map(r => r.finalState.capital);
    histograms.push(this.createHistogram('capital', capitals));

    const healths = this.cloneResults.map(r => r.finalState.health);
    histograms.push(this.createHistogram('health', healths));

    const happiness = this.cloneResults.map(r => r.finalState.happiness);
    histograms.push(this.createHistogram('happiness', happiness));

    return histograms;
  }

  // Extract all unique metric names from results
  private extractAllMetrics(): string[] {
    const metricSet = new Set<string>();
    
    for (const result of this.cloneResults) {
      for (const key of Object.keys(result.metrics)) {
        metricSet.add(key);
      }
    }

    return Array.from(metricSet);
  }

  // Create histogram for a single metric
  private createHistogram(metric: string, values: number[]): Histogram {
    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    
    // Calculate statistics
    const mean = sorted.reduce((a, b) => a + b, 0) / count;
    const median = sorted[Math.floor(count / 2)];
    
    // Standard deviation
    const variance = sorted.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / count;
    const stdDev = Math.sqrt(variance);
    
    // Percentiles
    const p5 = sorted[Math.floor(count * 0.05)];
    const p95 = sorted[Math.floor(count * 0.95)];

    // Create bins (10 bins by default)
    const min = sorted[0];
    const max = sorted[count - 1];
    const binCount = 10;
    const binWidth = (max - min) / binCount || 1;

    const bins: Bin[] = [];
    for (let i = 0; i < binCount; i++) {
      const binMin = min + i * binWidth;
      const binMax = min + (i + 1) * binWidth;
      
      const binValues = sorted.filter(v => v >= binMin && v < binMax);
      const binCount = binValues.length;
      
      bins.push({
        min: binMin,
        max: binMax,
        count: binCount,
        frequency: binCount / count,
      });
    }

    return {
      metric,
      bins,
      mean,
      median,
      stdDev,
      p5,
      p95,
    };
  }

  // Calculate outcome distribution (success/failure/neutral)
  private calculateOutcomeDistribution(): OutcomeDistribution {
    let success = 0;
    let failure = 0;
    let neutral = 0;

    const byCategory = {
      edge: { success: 0, failure: 0, neutral: 0 },
      typical: { success: 0, failure: 0, neutral: 0 },
      central: { success: 0, failure: 0, neutral: 0 },
    };

    for (const result of this.cloneResults) {
      const outcome = this.categorizeResult(result);
      const category = result.stratification.category;

      if (outcome === 'success') {
        success++;
        byCategory[category].success++;
      } else if (outcome === 'failure') {
        failure++;
        byCategory[category].failure++;
      } else {
        neutral++;
        byCategory[category].neutral++;
      }
    }

    const total = this.cloneResults.length;

    return {
      success: success / total,
      failure: failure / total,
      neutral: neutral / total,
      byCategory: {
        edge: {
          success: byCategory.edge.success / total,
          failure: byCategory.edge.failure / total,
          neutral: byCategory.edge.neutral / total,
        },
        typical: {
          success: byCategory.typical.success / total,
          failure: byCategory.typical.failure / total,
          neutral: byCategory.typical.neutral / total,
        },
        central: {
          success: byCategory.central.success / total,
          failure: byCategory.central.failure / total,
          neutral: byCategory.central.neutral / total,
        },
      },
    };
  }

  // Categorize a single result
  private categorizeResult(result: CloneResult): 'success' | 'failure' | 'neutral' {
    const { finalState, metrics } = result;
    
    // Success criteria: good happiness, good capital, or key metric improved
    const happinessGood = finalState.happiness > 0.6;
    const capitalGood = this.initialCapital > 0
      ? finalState.capital > this.initialCapital * 0.8
      : finalState.capital > 0;
    
    // Check for outcome-specific success
    const outcomeValue = String(finalState.outcome || metrics.outcome || '');
    const outcomeSuccess = outcomeValue === 'success' || 
                          outcomeValue === 'career_trader' ||
                          outcomeValue === 'successful_transition' ||
                          outcomeValue === 'degree_roi_positive' ||
                          outcomeValue === 'relocation_success' ||
                          outcomeValue === 'healthy_maintenance' ||
                          outcomeValue === 'persistence_result' ||
                          outcomeValue === 'strategic_retreat';

    // Failure criteria
    const happinessBad = finalState.happiness < 0.3;
    const capitalBad = this.initialCapital > 0
      ? finalState.capital < this.initialCapital * 0.2
      : finalState.capital < 0;
    
    const outcomeFailure = outcomeValue === 'failure' ||
                          outcomeValue === 'shutdown' ||
                          outcomeValue === 'significant_loss' ||
                          outcomeValue === 'dropout' ||
                          outcomeValue === 'bust' ||
                          outcomeValue === 'abandoned';

    const outcomeNeutral = outcomeValue === 'early_exit';

    if (outcomeSuccess || (happinessGood && capitalGood)) {
      return 'success';
    } else if (outcomeFailure || happinessBad || capitalBad) {
      return 'failure';
    } else if (outcomeNeutral) {
      return 'neutral';
    } else {
      return 'neutral';
    }
  }

  // Generate timeline data
  private generateTimeline(): TimelineData {
    const months = Array.from(new Set(
      this.cloneResults.flatMap(r => 
        Array.from({ length: Math.floor(r.finalState.timeElapsed) + 1 }, (_, i) => i)
      )
    )).sort((a, b) => a - b);

    const metrics: Record<string, number[]> = {};

    // Initialize metric arrays
    for (const month of months) {
      const monthResults = this.cloneResults.filter(r => r.finalState.timeElapsed >= month);
      
      // Average capital per month
      const capitals = monthResults.map(r => {
        // Estimate capital at this month (simplified)
        const progress = month / (r.finalState.timeElapsed || 1);
        return r.finalState.capital * progress; // Rough approximation
      });
      
      if (!metrics.capital) metrics.capital = [];
      metrics.capital.push(capitals.reduce((a, b) => a + b, 0) / capitals.length || 0);

      // Average happiness per month
      const happinesses = monthResults.map(r => r.finalState.happiness);
      if (!metrics.happiness) metrics.happiness = [];
      metrics.happiness.push(happinesses.reduce((a, b) => a + b, 0) / happinesses.length || 0);
    }

    return { months, metrics };
  }

  // Calculate summary statistics
  private calculateStatistics(): SimulationStatistics {
    const capitals = this.cloneResults.map(r => r.finalState.capital);
    const healths = this.cloneResults.map(r => r.finalState.health);
    const happinesses = this.cloneResults.map(r => r.finalState.happiness);
    const durations = this.cloneResults.map(r => r.finalState.timeElapsed);

    const meanCapital = capitals.reduce((a, b) => a + b, 0) / capitals.length;
    
    // Median capital
    const sortedCapitals = [...capitals].sort((a, b) => a - b);
    const medianCapital = sortedCapitals[Math.floor(sortedCapitals.length / 2)];

    const meanHealth = healths.reduce((a, b) => a + b, 0) / healths.length;
    const meanHappiness = happinesses.reduce((a, b) => a + b, 0) / happinesses.length;

    // Success rate
    let successes = 0;
    for (const result of this.cloneResults) {
      if (this.categorizeResult(result) === 'success') {
        successes++;
      }
    }
    const successRate = successes / this.cloneResults.length;

    const averageDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

    return {
      meanCapital,
      medianCapital,
      meanHealth,
      meanHappiness,
      successRate,
      averageDuration,
    };
  }

  // Calculate stratified breakdown by clone category
  private calculateStratifiedBreakdown(): StratifiedBreakdown {
    const byCategory: Record<string, { count: number; outcomes: number[] }> = {
      edge: { count: 0, outcomes: [] },
      typical: { count: 0, outcomes: [] },
      central: { count: 0, outcomes: [] },
    };

    for (const result of this.cloneResults) {
      const category = result.stratification.category;
      byCategory[category].count++;

      // Calculate outcome score for this clone
      const outcomeScore = this.calculateOutcomeScore(result);
      byCategory[category].outcomes.push(outcomeScore);
    }

    return {
      edge: {
        count: byCategory.edge.count,
        avgOutcome: byCategory.edge.outcomes.reduce((a, b) => a + b, 0) / 
                    (byCategory.edge.count || 1),
      },
      typical: {
        count: byCategory.typical.count,
        avgOutcome: byCategory.typical.outcomes.reduce((a, b) => a + b, 0) / 
                    (byCategory.typical.count || 1),
      },
      central: {
        count: byCategory.central.count,
        avgOutcome: byCategory.central.outcomes.reduce((a, b) => a + b, 0) / 
                    (byCategory.central.count || 1),
      },
    };
  }

  // Calculate numeric outcome score for a result
  private calculateOutcomeScore(result: CloneResult): number {
    const { finalState, metrics } = result;
    
    let score = 0;
    
    // Happiness component (0-30 points)
    score += finalState.happiness * 30;
    
    // Health component (0-20 points)
    score += finalState.health * 20;
    
    // Capital component (normalized, max 30 points)
    score += Math.min(30, Math.max(0, finalState.capital / 5000));
    
    // Outcome bonus
    const outcomeScore = String(finalState.outcome || metrics.outcome || '');
    if (outcomeScore === 'success' || 
        outcomeScore === 'career_trader' ||
        outcomeScore === 'successful_transition') {
      score += 20;
    } else if (outcomeScore === 'failure' || 
               outcomeScore === 'shutdown' ||
               outcomeScore === 'bust') {
      score -= 20;
    }
    
    return score;
  }

  // Get raw results
  getRawResults(): CloneResult[] {
    return [...this.cloneResults];
  }

  // Reset aggregator
  reset(): void {
    this.cloneResults = [];
  }

  // Export results as JSON
  exportToJSON(): string {
    return JSON.stringify(this.aggregate(), null, 2);
  }

  // Export summary for storage
  exportSummary(): {
    cloneCount: number;
    successRate: number;
    meanCapital: number;
    meanHappiness: number;
    histograms: Array<{ metric: string; mean: number; p5: number; p95: number }>;
  } {
    const aggregated = this.aggregate();
    
    return {
      cloneCount: aggregated.cloneCount,
      successRate: aggregated.statistics.successRate,
      meanCapital: aggregated.statistics.meanCapital,
      meanHappiness: aggregated.statistics.meanHappiness,
      histograms: aggregated.histograms.map(h => ({
        metric: h.metric,
        mean: h.mean,
        p5: h.p5,
        p95: h.p95,
      })),
    };
  }
}

// Create aggregator for a scenario
export function createAggregator(scenarioId: string): ResultAggregator {
  return new ResultAggregator(scenarioId);
}

// Aggregate batch results
export function aggregateBatch(
  scenarioId: string,
  results: CloneResult[]
): AggregatedResults {
  const aggregator = new ResultAggregator(scenarioId);
  aggregator.addResults(results);
  return aggregator.aggregate();
}

// Quick histogram generation
export function createHistogram(values: number[], bins: number = 10): Histogram {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  
  const mean = sorted.reduce((a, b) => a + b, 0) / count;
  const median = sorted[Math.floor(count / 2)];
  const variance = sorted.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / count;
  const stdDev = Math.sqrt(variance);
  const p5 = sorted[Math.floor(count * 0.05)];
  const p95 = sorted[Math.floor(count * 0.95)];

  const min = sorted[0];
  const max = sorted[count - 1];
  const binWidth = (max - min) / bins || 1;

  const histogramBins: Bin[] = [];
  for (let i = 0; i < bins; i++) {
    const binMin = min + i * binWidth;
    const binMax = min + (i + 1) * binWidth;
    
    const binValues = sorted.filter(v => v >= binMin && (i === bins - 1 ? v <= binMax : v < binMax));
    const binCount = binValues.length;
    
    histogramBins.push({
      min: binMin,
      max: binMax,
      count: binCount,
      frequency: binCount / count,
    });
  }

  return {
    metric: 'unknown',
    bins: histogramBins,
    mean,
    median,
    stdDev,
    p5,
    p95,
  };
}

// Calculate percentiles
export function calculatePercentiles(values: number[]): {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  
  return {
    p5: sorted[Math.floor(count * 0.05)],
    p25: sorted[Math.floor(count * 0.25)],
    p50: sorted[Math.floor(count * 0.5)],
    p75: sorted[Math.floor(count * 0.75)],
    p95: sorted[Math.floor(count * 0.95)],
  };
}

// Distribution analysis
export function analyzeDistribution(values: number[]): {
  skewness: number;
  kurtosis: number;
  isNormal: boolean;
} {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  
  // Variance
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  
  // Skewness
  const skewness = values.reduce((sum, v) => sum + Math.pow((v - mean) / stdDev, 3), 0) / n;
  
  // Kurtosis
  const kurtosis = values.reduce((sum, v) => sum + Math.pow((v - mean) / stdDev, 4), 0) / n - 3;
  
  // Simple normality check (rough approximation)
  const isNormal = Math.abs(skewness) < 2 && Math.abs(kurtosis) < 7;
  
  return { skewness, kurtosis, isNormal };
}

// Compare two distributions
export function compareDistributions(
  dist1: number[],
  dist2: number[]
): {
  meanDifference: number;
  varianceRatio: number;
  overlap: number; // 0-1, higher = more similar
} {
  const mean1 = dist1.reduce((a, b) => a + b, 0) / dist1.length;
  const mean2 = dist2.reduce((a, b) => a + b, 0) / dist2.length;
  
  const var1 = dist1.reduce((sum, v) => sum + Math.pow(v - mean1, 2), 0) / dist1.length;
  const var2 = dist2.reduce((sum, v) => sum + Math.pow(v - mean2, 2), 0) / dist2.length;
  
  // Calculate overlap using histogram intersection
  const hist1 = createHistogram(dist1, 20);
  const hist2 = createHistogram(dist2, 20);
  
  let overlap = 0;
  for (let i = 0; i < hist1.bins.length; i++) {
    overlap += Math.min(hist1.bins[i].frequency, hist2.bins[i].frequency);
  }
  
  return {
    meanDifference: mean1 - mean2,
    varianceRatio: var1 / (var2 || 1),
    overlap,
  };
}

// Export types
export type { AggregatedResults, Histogram, OutcomeDistribution };
