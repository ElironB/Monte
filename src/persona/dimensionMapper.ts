import type { ConceptEmbeddings } from '../embeddings/dimensionConcepts.js';
import { BehavioralSignal, SignalContradiction } from '../ingestion/types.js';

export interface BehavioralDimensions {
  riskTolerance: number;
  timePreference: number;
  socialDependency: number;
  learningStyle: number;
  decisionSpeed: number;
  emotionalVolatility: number;
}

export interface DimensionMapResult {
  dimensions: BehavioralDimensions;
  contradictionPenalties: Record<keyof BehavioralDimensions, number>;
}

const SIMILARITY_THRESHOLD = 0.25;
const DIMENSION_KEYS = [
  'riskTolerance',
  'timePreference',
  'socialDependency',
  'learningStyle',
  'decisionSpeed',
  'emotionalVolatility',
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
    const contradictionPenalties = {} as Record<keyof BehavioralDimensions, number>;

    for (const dimension of DIMENSION_KEYS) {
      if (this.conceptEmbeddings && this.conceptEmbeddings[dimension] && this.signalEmbeddings.size > 0) {
        const result = this.calculateDimensionSemantic(dimension);
        dimensions[dimension] = result.value;
        contradictionPenalties[dimension] = result.contradictionPenalty;
      } else {
        dimensions[dimension] = 0.5;
        contradictionPenalties[dimension] = 0;
      }
    }

    return { dimensions, contradictionPenalties };
  }

  private calculateDimension(dimension: keyof BehavioralDimensions): number {
    if (this.conceptEmbeddings && this.conceptEmbeddings[dimension] && this.signalEmbeddings.size > 0) {
      return this.calculateDimensionSemantic(dimension).value;
    }
    return 0.5;
  }

  private calculateDimensionSemantic(
    dimension: keyof BehavioralDimensions
  ): { value: number; contradictionPenalty: number } {
    const concepts = this.conceptEmbeddings?.[dimension];
    if (!concepts) {
      return { value: 0.5, contradictionPenalty: 0 };
    }

    let weightedSum = 0;
    let totalWeight = 0;
    const relevantContradictions = this.contradictions.filter(
      contradiction => contradiction.affectedDimensions.includes(dimension)
    );

    for (const signal of this.signals) {
      const embedding = this.signalEmbeddings.get(signal.id);
      if (!embedding) {
        continue;
      }

      const simHigh = cosineSimilarity(embedding, concepts.high);
      const simLow = cosineSimilarity(embedding, concepts.low);
      const maxSim = Math.max(simHigh, simLow);

      if (maxSim < SIMILARITY_THRESHOLD) {
        continue;
      }

      const direction = simHigh - simLow;
      const strength = this.getSignalStrength(signal);
      const recency = this.getRecencyBoost(signal.timestamp);
      const relevance = maxSim;
      const contradictionBias = this.getContradictionSignalBias(signal.id, relevantContradictions);
      const effectiveWeight = strength * recency * relevance * contradictionBias;

      weightedSum += direction * effectiveWeight;
      totalWeight += relevance * recency * contradictionBias;
    }

    if (totalWeight === 0) {
      return { value: 0.5, contradictionPenalty: 0 };
    }

    const rawScore = weightedSum / totalWeight;
    const baseValue = this.sigmoidNormalize(rawScore);

    if (relevantContradictions.length === 0) {
      return { value: baseValue, contradictionPenalty: 0 };
    }

    const avgMagnitude = relevantContradictions.reduce((sum, contradiction) => sum + contradiction.magnitude, 0)
      / relevantContradictions.length;
    const contradictionPenalty = Math.max(0, Math.min(1, avgMagnitude * 0.5));
    const adjustedValue = baseValue + (0.5 - baseValue) * contradictionPenalty;

    return { value: adjustedValue, contradictionPenalty };
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

  private getRecencyBoost(timestamp: string): number {
    const signalDate = new Date(timestamp);
    const now = new Date();
    const daysDiff = (now.getTime() - signalDate.getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0.3, Math.exp(-daysDiff / 60));
  }

  private sigmoidNormalize(x: number): number {
    const scaled = (x + 1) / 2;
    return Math.max(0, Math.min(1, scaled));
  }
}
