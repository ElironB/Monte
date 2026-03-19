import type { AggregatedResults, CloneResult } from './types.js';
import { getInitialState } from './decisionGraph.js';

export interface KellyOutput {
  successProbability: number;
  netOddsRatio: number;
  fullKellyPercentage: number;
  adjustedKellyPercentage: number;
  optimalCommitmentAmount: number;
  kellyFractionUsed: number;
  rationale: string;
  warning?: string;
}

export interface KellyInput {
  results: AggregatedResults;
  cloneResults: CloneResult[];
  riskTolerance: number;
  capitalAtRisk: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function calculateKelly(input: KellyInput): KellyOutput {
  const { results, cloneResults, riskTolerance, capitalAtRisk } = input;
  const normalizedRiskTolerance = clamp(riskTolerance, 0, 1);
  const lossAversion = 1 - normalizedRiskTolerance;
  const initialCapital = getInitialState(results.scenarioId).capital;

  const capitalDeltas = cloneResults.map((clone) => clone.finalState.capital - initialCapital);
  const successDeltas = capitalDeltas.filter((delta) => delta > 0);
  const failureDeltas = capitalDeltas.filter((delta) => delta < 0);

  const meanGain = successDeltas.length > 0
    ? successDeltas.reduce((sum, delta) => sum + delta, 0) / successDeltas.length
    : 0;
  const meanLoss = failureDeltas.length > 0
    ? Math.abs(failureDeltas.reduce((sum, delta) => sum + delta, 0) / failureDeltas.length)
    : 1;

  const netOddsRatio = meanGain > 0 ? meanGain / meanLoss : 0;
  const successProbability = results.outcomeDistribution.success;
  const failureProbability = 1 - successProbability;
  const fullKelly = netOddsRatio > 0
    ? (successProbability * netOddsRatio - failureProbability) / netOddsRatio
    : -1;
  const kellyFraction = normalizedRiskTolerance <= 0.2
    ? 0.25
    : normalizedRiskTolerance >= 0.8
      ? 0.5
      : 0.25 + ((normalizedRiskTolerance - 0.2) / 0.6) * 0.25;
  const adjustedKelly = clamp(fullKelly * kellyFraction, 0, 1);

  const output: KellyOutput = {
    successProbability,
    netOddsRatio,
    fullKellyPercentage: fullKelly,
    adjustedKellyPercentage: adjustedKelly,
    optimalCommitmentAmount: capitalAtRisk * adjustedKelly,
    kellyFractionUsed: kellyFraction,
    rationale: `Based on a ${(successProbability * 100).toFixed(1)}% success probability with ${netOddsRatio.toFixed(2)}:1 observed gain/loss odds and your risk profile (risk tolerance: ${normalizedRiskTolerance.toFixed(2)}, loss aversion: ${lossAversion.toFixed(2)}), Monte applies ${(kellyFraction * 100).toFixed(0)}% Kelly sizing. This is a probabilistic sizing aid, not financial advice.`,
  };

  if (fullKelly <= 0) {
    output.warning = 'Negative Kelly — simulation suggests this scenario has negative expected value for your behavioral profile. Do not commit capital.';
    output.adjustedKellyPercentage = 0;
    output.optimalCommitmentAmount = 0;
  } else if (fullKelly > 1) {
    output.warning = 'Full Kelly exceeds 100% of capital — this scenario carries extreme variance. The adjusted recommendation accounts for this.';
    output.adjustedKellyPercentage = clamp(fullKelly * kellyFraction, 0, 1);
    output.optimalCommitmentAmount = capitalAtRisk * output.adjustedKellyPercentage;
  }

  return output;
}
