import type { ConceptEmbeddings } from '../embeddings/dimensionConcepts.js';
import { BehavioralSignal, SignalContradiction } from '../ingestion/types.js';

export interface BehavioralDimensions {
  riskTolerance: number;
  timePreference: number;
  socialDependency: number;
  learningStyle: number;
  decisionSpeed: number;
  emotionalVolatility: number;
  executionGap: number;
  informationSeeking: number;
  stressResponse: number;
}

export interface DimensionScore {
  value: number;
  confidence: number;
  signalCount: number;
  sourceCount: number;
  sourceTypes: string[];
  isEstimated: boolean;
  confidenceInterval: [number, number];
}

export interface DimensionMapResult {
  dimensions: BehavioralDimensions;
  dimensionScores: Record<keyof BehavioralDimensions, DimensionScore>;
  contradictionPenalties: Record<keyof BehavioralDimensions, number>;
}

const SIMILARITY_THRESHOLD = 0.25;

const DEFAULT_HALF_LIFE = 60;
const SOURCE_HALF_LIVES: Record<string, number> = {
  financial: 180,
  search_history: 30,
  social_media: 45,
  notes: 120,
  watch_history: 21,
  ai_chat: 45,
};

const SOURCE_RELIABILITY_WEIGHTS: Record<string, number> = {
  financial: 0.95,
  watch_history: 0.80,
  ai_chat: 0.80,
  search_history: 0.75,
  social_media: 0.60,
  notes: 0.55,
  default: 0.50
};

export const DIMENSION_KEYS = [
  'riskTolerance',
  'timePreference',
  'socialDependency',
  'learningStyle',
  'decisionSpeed',
  'emotionalVolatility',
  'executionGap',
  'informationSeeking',
  'stressResponse',
] as const;

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

export class DimensionMapper {
  private signals: BehavioralSignal[];
  private conceptEmbeddings: ConceptEmbeddings | null;
  private signalEmbeddings: Map<string, number[]>;
  private contradictions: SignalContradiction[];

  constructor(
    signals: BehavioralSignal[],
    conceptEmbeddings?: ConceptEmbeddings | null,
    signalEmbeddings?: Map<string, number[]>,
    contradictions?: SignalContradiction[]
  ) {
    this.signals = signals;
    this.conceptEmbeddings = conceptEmbeddings ?? null;
    this.signalEmbeddings = signalEmbeddings ?? new Map();
    this.contradictions = contradictions ?? [];
  }

  mapToDimensions(): BehavioralDimensions {
    return this.mapToDimensionsWithContradictions().dimensions;
  }

  mapToDimensionsWithContradictions(): DimensionMapResult {
    const dimensions = {} as BehavioralDimensions;
    const dimensionScores = {} as Record<keyof BehavioralDimensions, DimensionScore>;
    const contradictionPenalties = {} as Record<keyof BehavioralDimensions, number>;

    for (const dimension of DIMENSION_KEYS) {
      if (this.conceptEmbeddings && this.conceptEmbeddings[dimension] && this.signalEmbeddings.size > 0) {
        const result = this.calculateDimensionSemantic(dimension);
        dimensions[dimension] = result.score.value;
        dimensionScores[dimension] = result.score;
        contradictionPenalties[dimension] = result.contradictionPenalty;
      } else {
        dimensions[dimension] = 0.5;
        dimensionScores[dimension] = {
          value: 0.5,
          confidence: 0,
          signalCount: 0,
          sourceCount: 0,
          sourceTypes: [],
          isEstimated: true,
          confidenceInterval: [0, 1]
        };
        contradictionPenalties[dimension] = 0;
      }
    }

    return { dimensions, dimensionScores, contradictionPenalties };
  }

  private calculateDimensionSemantic(
    dimension: keyof BehavioralDimensions
  ): { score: DimensionScore; contradictionPenalty: number } {
    const concepts = this.conceptEmbeddings?.[dimension];
    if (!concepts) {
      return {
        score: {
          value: 0.5,
          confidence: 0,
          signalCount: 0,
          sourceCount: 0,
          sourceTypes: [],
          isEstimated: true,
          confidenceInterval: [0, 1]
        },
        contradictionPenalty: 0
      };
    }

    let weightedSum = 0;
    let totalWeight = 0;
    const passingSignals: BehavioralSignal[] = [];

    const relevantSignalIds = new Set(this.signals.map(signal => signal.id));
    const relevantContradictions = this.contradictions.filter(
      contradiction =>
        contradiction.affectedDimensions.includes(dimension)
        && (relevantSignalIds.has(contradiction.signalAId) || relevantSignalIds.has(contradiction.signalBId))
    );

    for (const signal of this.signals) {
      const embedding = this.signalEmbeddings.get(signal.id);
      if (!embedding) {
        continue;
      }

      const highSims = concepts.high ? concepts.high.map(anchor => cosineSimilarity(embedding, anchor)).sort((a, b) => b - a) : [0];
      const lowSims = concepts.low ? concepts.low.map(anchor => cosineSimilarity(embedding, anchor)).sort((a, b) => b - a) : [0];
      const negSims = concepts.negative && concepts.negative.length > 0 
        ? concepts.negative.map(anchor => cosineSimilarity(embedding, anchor)).sort((a, b) => b - a)
        : [0];

      const simHigh = highSims.slice(0, 2).reduce((a, b) => a + b, 0) / Math.min(2, highSims.length);
      const simLow = lowSims.slice(0, 2).reduce((a, b) => a + b, 0) / Math.min(2, lowSims.length);
      const maxNeg = negSims[0];

      const maxSim = Math.max(simHigh, simLow);

      // Negative anchor gating
      if (maxNeg > maxSim || maxSim < SIMILARITY_THRESHOLD) {
        continue;
      }

      passingSignals.push(signal);

      const direction = simHigh - simLow;
      const strength = this.getSignalStrength(signal);
      const recency = this.getRecencyBoost(signal.timestamp, signal.sourceType);
      const relevance = maxSim;
      const contradictionBias = this.getContradictionSignalBias(signal.id, relevantContradictions);
      const sType = signal.sourceType || 'default';
      const sourceWeight = SOURCE_RELIABILITY_WEIGHTS[sType] || SOURCE_RELIABILITY_WEIGHTS.default;
      
      const effectiveWeight = strength * recency * relevance * contradictionBias * sourceWeight;

      weightedSum += direction * effectiveWeight;
      totalWeight += relevance * recency * contradictionBias * sourceWeight;
    }

    if (totalWeight === 0) {
      return {
        score: {
          value: 0.5,
          confidence: 0,
          signalCount: 0,
          sourceCount: 0,
          sourceTypes: [],
          isEstimated: true,
          confidenceInterval: [0, 1]
        },
        contradictionPenalty: 0
      };
    }

    const rawScore = weightedSum / totalWeight;
    const baseValue = this.sigmoidNormalize(rawScore);

    const avgMagnitude = relevantContradictions.length > 0 
      ? relevantContradictions.reduce((sum, contradiction) => sum + contradiction.magnitude, 0) / relevantContradictions.length
      : 0;

    const contradictionPenalty = Math.max(0, Math.min(1, avgMagnitude * 0.5));
    const adjustedValue = baseValue + (0.5 - baseValue) * contradictionPenalty;

    // Confidence and CI calculation
    const signalCount = passingSignals.length;
    const sourceTypesList = Array.from(new Set(passingSignals.map(s => s.sourceType || 'default')));
    const sourceCount = sourceTypesList.length;
    const isEstimated = signalCount < 3 || sourceCount === 1;
    const estimationPenalty = isEstimated ? 1.5 : 1;
    
    const CI_width = (0.4 / Math.sqrt(Math.max(1, signalCount))) * (1 / Math.max(1, sourceCount)) * estimationPenalty;
    const confidence = Math.max(0, 1 - Math.min(CI_width, 1));

    const halfWidth = CI_width / 2;
    const lowerBound = Math.max(0, adjustedValue - halfWidth);
    const upperBound = Math.min(1, adjustedValue + halfWidth);

    return { 
      score: {
        value: adjustedValue,
        confidence,
        signalCount,
        sourceCount,
        sourceTypes: sourceTypesList,
        isEstimated,
        confidenceInterval: [lowerBound, upperBound]
      }, 
      contradictionPenalty 
    };
  }

  private getContradictionSignalBias(
    signalId: string,
    contradictions: SignalContradiction[]
  ): number {
    if (contradictions.length === 0) {
      return 1;
    }

    const statedPenalties = contradictions
      .filter(contradiction => contradiction.signalAId === signalId)
      .map(contradiction => contradiction.magnitude * 0.35);
    const revealedBoosts = contradictions
      .filter(contradiction => contradiction.signalBId === signalId)
      .map(contradiction => contradiction.magnitude * 0.5);

    const statedPenalty = statedPenalties.length > 0
      ? statedPenalties.reduce((sum, penalty) => sum + penalty, 0) / statedPenalties.length
      : 0;
    const revealedBoost = revealedBoosts.length > 0
      ? revealedBoosts.reduce((sum, boost) => sum + boost, 0) / revealedBoosts.length
      : 0;

    return Math.max(0.5, Math.min(1.75, 1 - statedPenalty + revealedBoost));
  }

  private getSignalStrength(signal: BehavioralSignal): number {
    const base = signal.confidence;
    const frequencyBoost = (signal.dimensions.frequency || 0) * 0.3;
    const recurrenceBoost = (signal.dimensions.recurrence || 0) * 0.2;
    const trendBoost = signal.dimensions.intensityTrend === 'increasing' ? 0.1 :
      signal.dimensions.intensityTrend === 'decreasing' ? -0.1 : 0;
    return Math.min(1, base + frequencyBoost + recurrenceBoost + trendBoost);
  }

  private getRecencyBoost(timestamp: string, sourceType?: string): number {
    const signalDate = new Date(timestamp);
    const now = new Date();
    const daysDiff = (now.getTime() - signalDate.getTime()) / (1000 * 60 * 60 * 24);
    const halfLife = sourceType ? (SOURCE_HALF_LIVES[sourceType] || DEFAULT_HALF_LIFE) : DEFAULT_HALF_LIFE;
    return Math.max(0.3, Math.exp(-daysDiff / halfLife));
  }

  private sigmoidNormalize(x: number): number {
    const scaled = (x + 1) / 2;
    return Math.max(0, Math.min(1, scaled));
  }
}
