import type { ConceptEmbeddings } from '../embeddings/dimensionConcepts.js';
import { BehavioralSignal } from '../ingestion/types.js';

export interface BehavioralDimensions {
  riskTolerance: number;
  timePreference: number;
  socialDependency: number;
  learningStyle: number;
  decisionSpeed: number;
  emotionalVolatility: number;
}

const SIMILARITY_THRESHOLD = 0.25;

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

  constructor(
    signals: BehavioralSignal[],
    conceptEmbeddings?: ConceptEmbeddings | null,
    signalEmbeddings?: Map<string, number[]>
  ) {
    this.signals = signals;
    this.conceptEmbeddings = conceptEmbeddings ?? null;
    this.signalEmbeddings = signalEmbeddings ?? new Map();
  }

  mapToDimensions(): BehavioralDimensions {
    return {
      riskTolerance: this.calculateDimension('riskTolerance'),
      timePreference: this.calculateDimension('timePreference'),
      socialDependency: this.calculateDimension('socialDependency'),
      learningStyle: this.calculateDimension('learningStyle'),
      decisionSpeed: this.calculateDimension('decisionSpeed'),
      emotionalVolatility: this.calculateDimension('emotionalVolatility'),
    };
  }

  private calculateDimension(dimension: keyof BehavioralDimensions): number {
    if (this.conceptEmbeddings && this.conceptEmbeddings[dimension] && this.signalEmbeddings.size > 0) {
      return this.calculateDimensionSemantic(dimension);
    }
    return 0.5;
  }

  private calculateDimensionSemantic(dimension: keyof BehavioralDimensions): number {
    const concepts = this.conceptEmbeddings?.[dimension];
    if (!concepts) {
      return 0.5;
    }

    let weightedSum = 0;
    let totalWeight = 0;

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

      weightedSum += direction * strength * recency * relevance;
      totalWeight += relevance;
    }

    if (totalWeight === 0) {
      return 0.5;
    }

    const rawScore = weightedSum / totalWeight;
    return this.sigmoidNormalize(rawScore);
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
