import { cosineSimilarity } from '../embeddings/embeddingService.js';
import type { ConceptEmbeddings } from '../embeddings/dimensionConcepts.js';
import { runQuerySingle, runWriteSingle } from '../config/neo4j.js';
import { BehavioralSignal } from '../ingestion/types.js';
import { logger } from '../utils/logger.js';
import { BehavioralDimensions } from './dimensionMapper.js';

const MIN_CONFIDENCE = 0.05;
const MAX_CONFIDENCE = 0.95;
const LOW_CONFIDENCE_THRESHOLD = 0.2;
const MAX_BLEND_WEIGHT = 0.4;
const SIMILARITY_THRESHOLD = 0.25;

export interface BayesianUpdate {
  dimension: keyof BehavioralDimensions;
  prior: number;
  likelihood: number;
  posterior: number;
  priorValue: number;
  posteriorValue: number;
  evidenceType: 'corroborating' | 'contradicting' | 'neutral';
  updateMagnitude: number;
}

export interface PersonaUpdateResult {
  updates: BayesianUpdate[];
  newSignalCount: number;
  contradictionsRaised: number;
  overallConfidenceDelta: number;
}

interface ExistingTrait {
  value: number;
  confidence: number;
  evidenceCount: number | { toNumber: () => number };
}

export class BayesianUpdater {
  private userId: string;
  private personaId: string;
  private conceptEmbeddings: ConceptEmbeddings | null;
  private signalEmbeddings: Map<string, number[]>;

  constructor(
    userId: string,
    personaId: string,
    conceptEmbeddings?: ConceptEmbeddings | null,
    signalEmbeddings?: Map<string, number[]>
  ) {
    this.userId = userId;
    this.personaId = personaId;
    this.conceptEmbeddings = conceptEmbeddings ?? null;
    this.signalEmbeddings = signalEmbeddings ?? new Map();
  }

  async update(
    newSignals: BehavioralSignal[],
    newDimensions: BehavioralDimensions,
    conceptEmbeddings?: ConceptEmbeddings | null,
    signalEmbeddings?: Map<string, number[]>
  ): Promise<PersonaUpdateResult> {
    if (conceptEmbeddings !== undefined) {
      this.conceptEmbeddings = conceptEmbeddings;
    }
    if (signalEmbeddings !== undefined) {
      this.signalEmbeddings = signalEmbeddings;
    }

    const updates: BayesianUpdate[] = [];

    for (const [dimension, newValue] of Object.entries(newDimensions) as Array<[
      keyof BehavioralDimensions,
      number,
    ]>) {
      const existingTrait = await runQuerySingle<ExistingTrait>(
        `MATCH (p:Persona {id: $personaId})-[:HAS_TRAIT]->(t:Trait {name: $dimName})
         RETURN t.value as value,
                t.confidence as confidence,
                coalesce(t.evidenceCount, 1) as evidenceCount`,
        { personaId: this.personaId, dimName: dimension }
      );

      if (!existingTrait) {
        logger.warn({ userId: this.userId, personaId: this.personaId, dimension }, 'Missing trait for Bayesian update, initializing via fallback mapping.');
        const relevantSignals = this.getRelevantSignals(newSignals, dimension);
        const evidenceCount = relevantSignals.length || 1;
        const confidence = 0.7 + (Math.abs(newValue - 0.5) * 0.6);
        
        await runWriteSingle(
          `MATCH (p:Persona {id: $personaId})
           CREATE (t:Trait {
             id: randomUUID(),
             type: 'dimension',
             name: $dimName,
             value: $newValue,
             confidence: $confidence,
             evidence: $evidence,
             dimension: $dimName,
             evidenceCount: $evidenceCount,
             signalCount: $evidenceCount,
             sourceCount: 1,
             sourceTypes: ['unknown'],
             isEstimated: true,
             confidenceInterval: [0, 1],
             createdAt: datetime()
           })
           CREATE (p)-[:HAS_TRAIT]->(t)
           RETURN t.id as id`,
          {
            personaId: this.personaId,
            dimName: dimension,
            newValue,
            confidence,
            evidence: `Initialized from ${relevantSignals.length} signals during incremental update`,
            evidenceCount
          }
        );
        
        updates.push({
          dimension,
          prior: 0.5,
          likelihood: newValue,
          posterior: confidence,
          priorValue: 0.5,
          posteriorValue: newValue,
          evidenceType: 'neutral',
          updateMagnitude: Math.abs(0.5 - newValue),
        });
        continue;
      }

      const prior = this.clampConfidence(existingTrait.confidence);
      const priorValue = this.clampUnit(existingTrait.value);
      const relevantSignals = this.getRelevantSignals(newSignals, dimension);
      const evidenceType = this.classifyEvidence(priorValue, newValue, relevantSignals.length);

      if (evidenceType === 'neutral') {
        updates.push({
          dimension,
          prior,
          likelihood: 0.5,
          posterior: prior,
          priorValue,
          posteriorValue: priorValue,
          evidenceType,
          updateMagnitude: 0,
        });
        continue;
      }

      const evidenceStrength = relevantSignals.length > 0
        ? relevantSignals.reduce((sum, signal) => sum + this.getSignalStrength(signal), 0) / relevantSignals.length
        : 0.5;

      const likelihood = evidenceType === 'contradicting'
        ? this.clampUnit(1 - evidenceStrength)
        : this.clampUnit(evidenceStrength);

      const normalizer = (likelihood * prior) + ((1 - likelihood) * (1 - prior));
      const posterior = this.clampConfidence(
        normalizer > 0 ? (likelihood * prior) / normalizer : prior
      );

      const blendWeight = Math.min(MAX_BLEND_WEIGHT, relevantSignals.length * 0.1);
      const posteriorValue = this.clampUnit(
        priorValue * (1 - blendWeight) + newValue * blendWeight
      );

      const previousEvidenceCount = this.toNumber(existingTrait.evidenceCount);
      const newEvidenceCount = previousEvidenceCount + relevantSignals.length;
      const lowConfidence = posterior < LOW_CONFIDENCE_THRESHOLD && newEvidenceCount >= 3;

      await runWriteSingle(
        `MATCH (p:Persona {id: $personaId})-[:HAS_TRAIT]->(t:Trait {name: $dimName})
         SET t.confidence = $posterior,
             t.value = $posteriorValue,
             t.evidenceCount = $evidenceCount,
             t.evidence = $evidence,
             t.lowConfidence = $lowConfidence,
             t.lastUpdated = datetime(),
             t.updateHistory = coalesce(t.updateHistory, '') + $updateLog
         RETURN t.id as id`,
        {
          personaId: this.personaId,
          dimName: dimension,
          posterior,
          posteriorValue,
          evidenceCount: newEvidenceCount,
          evidence: `Updated from ${relevantSignals.length} new signals (total evidence ${newEvidenceCount})`,
          lowConfidence,
          updateLog: `|${new Date().toISOString()}:${prior.toFixed(3)}->${posterior.toFixed(3)}`,
        }
      );

      updates.push({
        dimension,
        prior,
        likelihood,
        posterior,
        priorValue,
        posteriorValue,
        evidenceType,
        updateMagnitude: Math.abs(posterior - prior),
      });
    }

    const overallConfidenceDelta = updates.reduce((sum, update) => sum + update.updateMagnitude, 0) / Math.max(1, updates.length);

    return {
      updates,
      newSignalCount: newSignals.length,
      contradictionsRaised: updates.filter(update => update.evidenceType === 'contradicting').length,
      overallConfidenceDelta,
    };
  }

  private classifyEvidence(
    priorValue: number,
    newValue: number,
    relevantSignalCount: number
  ): BayesianUpdate['evidenceType'] {
    if (relevantSignalCount === 0) {
      return 'neutral';
    }

    const valueDelta = Math.abs(newValue - priorValue);
    if (valueDelta < 0.1) {
      return 'corroborating';
    }
    if (valueDelta > 0.3) {
      return 'contradicting';
    }
    return 'neutral';
  }

  private getRelevantSignals(
    signals: BehavioralSignal[],
    dimension: keyof BehavioralDimensions
  ): BehavioralSignal[] {
    if (!this.conceptEmbeddings || this.signalEmbeddings.size === 0) {
      return [];
    }

    const concepts = this.conceptEmbeddings[dimension];
    if (!concepts) {
      return [];
    }

    return signals.filter(signal => {
      const embedding = this.signalEmbeddings.get(signal.id);
      if (!embedding) {
        return false;
      }
      const getSim = (emb: number[], anchors: number[][]) => {
        if (!anchors || anchors.length === 0) return 0;
        const sims = anchors.map(a => cosineSimilarity(emb, a)).sort((a,b) => b - a);
        return sims.slice(0, 2).reduce((sum, s) => sum + s, 0) / Math.min(2, sims.length);
      };
      
      const simHigh = getSim(embedding, concepts.high);
      const simLow = getSim(embedding, concepts.low);
      const simNegative = concepts.negative ? Math.max(...concepts.negative.map(a => cosineSimilarity(embedding, a))) : 0;
      
      const maxPole = Math.max(simHigh, simLow);
      if (simNegative > maxPole) return false;
      
      return maxPole >= SIMILARITY_THRESHOLD;
    });
  }

  private getSignalStrength(signal: BehavioralSignal): number {
    const frequencyBoost = (signal.dimensions.frequency ?? 0) * 0.3;
    const recurrenceBoost = (signal.dimensions.recurrence ?? 0) * 0.2;
    const trendBoost = signal.dimensions.intensityTrend === 'increasing'
      ? 0.1
      : signal.dimensions.intensityTrend === 'decreasing'
        ? -0.1
        : 0;
    return this.clampUnit(signal.confidence + frequencyBoost + recurrenceBoost + trendBoost);
  }

  private clampConfidence(value: number): number {
    return Math.min(MAX_CONFIDENCE, Math.max(MIN_CONFIDENCE, value));
  }

  private clampUnit(value: number): number {
    return Math.min(1, Math.max(0, value));
  }

  private toNumber(value: number | { toNumber: () => number }): number {
    if (typeof value === 'number') {
      return value;
    }
    return value.toNumber();
  }
}
