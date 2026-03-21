import { v4 as uuidv4 } from 'uuid';
import { EmbeddingService, cosineSimilarity } from '../embeddings/embeddingService.js';
import type { ConceptEmbeddings } from '../embeddings/dimensionConcepts.js';
import type { BehavioralDimensions } from '../persona/dimensionMapper.js';
import { BehavioralSignal, SignalContradiction } from './types.js';

interface DetectorConceptEmbeddings {
  patience: number[];
  urgency: number[];
  goalExecution: number[];
  struggle: number[];
  riskTaking: number[];
  financialStress: number[];
}

const SIMILARITY_THRESHOLD = 0.25;
const DETECTOR_CONCEPT_TEXTS: Record<keyof DetectorConceptEmbeddings, string> = {
  patience: 'patience, discipline, self-control, delayed gratification, measured and composed behavior',
  urgency: 'urgency, impatience, quick results, rushed behavior, immediate action, pressure to act now',
  goalExecution: 'goal-oriented planning and execution, disciplined follow-through, strategic progress toward goals',
  struggle: 'failure, struggle, inability to follow through, repeated setbacks, stalled execution, decision paralysis',
  riskTaking: 'high risk tolerance, bold speculative behavior, aggressive bets, thrill-seeking decisions, all-in choices',
  financialStress: 'financial conservatism, budget struggles, cash stress, pressure from spending, preservation mindset',
};

export class ContradictionDetector {
  private static conceptEmbeddings: DetectorConceptEmbeddings | null = null;

  private signals: BehavioralSignal[];
  private signalEmbeddings: Map<string, number[]>;
  private dimensionConceptEmbeddings: ConceptEmbeddings | null;
  private existingContradictions: SignalContradiction[];
  private contradictions: SignalContradiction[] = [];

  constructor(
    signals: BehavioralSignal[],
    signalEmbeddings?: Map<string, number[]>,
    dimensionConceptEmbeddings?: ConceptEmbeddings | null,
    existingContradictions?: SignalContradiction[]
  ) {
    this.signals = signals;
    this.signalEmbeddings = signalEmbeddings ?? new Map();
    this.dimensionConceptEmbeddings = dimensionConceptEmbeddings ?? null;
    this.existingContradictions = existingContradictions ?? [];
  }

  async detect(): Promise<SignalContradiction[]> {
    this.contradictions = [];

    if (EmbeddingService.isAvailable() && this.signalEmbeddings.size > 0) {
      const conceptEmbeddings = await this.getConceptEmbeddings();
      if (conceptEmbeddings) {
        this.checkStatedVsRevealedSemantic(conceptEmbeddings);
        this.checkTemporalContradictionsSemantic(conceptEmbeddings);
        this.checkCrossDomainContradictionsSemantic(conceptEmbeddings);
        return this.contradictions;
      }
    }

    this.checkStatedVsRevealedFallback();
    this.checkTemporalContradictionsFallback();
    this.checkCrossDomainContradictionsFallback();

    return this.contradictions;
  }

  private async getConceptEmbeddings(): Promise<DetectorConceptEmbeddings | null> {
    if (ContradictionDetector.conceptEmbeddings) {
      return ContradictionDetector.conceptEmbeddings;
    }

    if (!EmbeddingService.isAvailable()) {
      return null;
    }

    const service = EmbeddingService.getInstance();
    const keys = Object.keys(DETECTOR_CONCEPT_TEXTS) as Array<keyof DetectorConceptEmbeddings>;
    const embeddings = await service.embedBatch(keys.map(key => DETECTOR_CONCEPT_TEXTS[key]));

    ContradictionDetector.conceptEmbeddings = keys.reduce((acc, key, index) => {
      acc[key] = embeddings[index];
      return acc;
    }, {} as DetectorConceptEmbeddings);

    return ContradictionDetector.conceptEmbeddings;
  }

  private checkStatedVsRevealedSemantic(concepts: DetectorConceptEmbeddings): void {
    const patienceSignals = this.findSemanticMatches(concepts.patience);
    const urgencySignals = this.signals.filter(signal => {
      if ((signal.dimensions.urgency ?? 0) > 0.5) {
        return true;
      }

      const embedding = this.signalEmbeddings.get(signal.id);
      if (!embedding) {
        return false;
      }

      return cosineSimilarity(embedding, concepts.urgency) >= SIMILARITY_THRESHOLD;
    });

    for (const stated of patienceSignals) {
      for (const revealed of urgencySignals) {
        this.addContradiction({
          signalAId: stated.id,
          signalBId: revealed.id,
          type: 'stated_vs_revealed',
          description: 'Claims patience but shows urgent behavior patterns',
          severity: 'medium',
          magnitude: this.calculateMagnitudeForDimensions(
            stated.id,
            revealed.id,
            ['timePreference', 'decisionSpeed'],
            'medium'
          ),
          affectedDimensions: ['timePreference', 'decisionSpeed'],
        });
      }
    }
  }

  private checkTemporalContradictionsSemantic(concepts: DetectorConceptEmbeddings): void {
    const goalSignals = this.findSemanticMatches(concepts.goalExecution);
    const struggleSignals = this.findSemanticMatches(concepts.struggle);

    if (goalSignals.length > 0 && struggleSignals.length > 3) {
      this.addContradiction({
        signalAId: goalSignals[0].id,
        signalBId: struggleSignals[0].id,
        type: 'temporal',
        description: 'Goal-oriented mindset but repeated execution failures',
        severity: 'high',
        magnitude: this.calculateMagnitudeForDimensions(
          goalSignals[0].id,
          struggleSignals[0].id,
          ['emotionalVolatility', 'decisionSpeed'],
          'high'
        ),
        affectedDimensions: ['emotionalVolatility', 'decisionSpeed'],
      });
    }
  }

  private checkCrossDomainContradictionsSemantic(concepts: DetectorConceptEmbeddings): void {
    const socialRisk = this.findSemanticMatches(concepts.riskTaking, signal => signal.type === 'cognitive_trait');
    const financialConservative = this.findSemanticMatches(
      concepts.financialStress,
      signal => signal.type === 'financial_behavior' || signal.type === 'emotional_state'
    );

    if (socialRisk.length > 0 && financialConservative.length > 0) {
      this.addContradiction({
        signalAId: socialRisk[0].id,
        signalBId: financialConservative[0].id,
        type: 'cross_domain',
        description: 'High risk tolerance socially but financially conservative/stressed',
        severity: 'medium',
        magnitude: this.calculateMagnitudeForDimensions(
          socialRisk[0].id,
          financialConservative[0].id,
          ['riskTolerance'],
          'medium'
        ),
        affectedDimensions: ['riskTolerance'],
      });
    }
  }

  private findSemanticMatches(
    conceptEmbedding: number[],
    predicate?: (signal: BehavioralSignal) => boolean
  ): BehavioralSignal[] {
    return this.signals.filter(signal => {
      if (predicate && !predicate(signal)) {
        return false;
      }

      const embedding = this.signalEmbeddings.get(signal.id);
      if (!embedding) {
        return false;
      }

      return cosineSimilarity(embedding, conceptEmbedding) >= SIMILARITY_THRESHOLD;
    });
  }

  private checkStatedVsRevealedFallback(): void {
    const patienceSignals = this.signals.filter(s =>
      s.value.includes('patient') || s.value.includes('disciplined')
    );

    const urgencySignals = this.signals.filter(s =>
      s.dimensions.urgency && s.dimensions.urgency > 0.5
    );

    for (const stated of patienceSignals) {
      for (const revealed of urgencySignals) {
        this.addContradiction({
          signalAId: stated.id,
          signalBId: revealed.id,
          type: 'stated_vs_revealed',
          description: 'Claims patience but shows urgent behavior patterns',
          severity: 'medium',
          magnitude: this.getFallbackMagnitude('medium'),
          affectedDimensions: ['timePreference', 'decisionSpeed'],
        });
      }
    }
  }

  private checkTemporalContradictionsFallback(): void {
    const goalSignals = this.signals.filter(s => s.value === 'goal_oriented');
    const struggleSignals = this.signals.filter(s =>
      s.value === 'budget_struggles' || s.value === 'decision_paralysis'
    );

    if (goalSignals.length > 0 && struggleSignals.length > 3) {
      this.addContradiction({
        signalAId: goalSignals[0].id,
        signalBId: struggleSignals[0].id,
        type: 'temporal',
        description: 'Goal-oriented mindset but repeated execution failures',
        severity: 'high',
        magnitude: this.getFallbackMagnitude('high'),
        affectedDimensions: ['emotionalVolatility', 'decisionSpeed'],
      });
    }
  }

  private checkCrossDomainContradictionsFallback(): void {
    const socialRisk = this.signals.filter(s =>
      s.type === 'cognitive_trait' && s.value === 'high_risk_tolerance'
    );

    const financialConservative = this.signals.filter(s =>
      s.value === 'budget_struggles' || s.value === 'impulse_spending'
    );

    if (socialRisk.length > 0 && financialConservative.length > 0) {
      this.addContradiction({
        signalAId: socialRisk[0].id,
        signalBId: financialConservative[0].id,
        type: 'cross_domain',
        description: 'High risk tolerance socially but financially conservative/stressed',
        severity: 'medium',
        magnitude: this.getFallbackMagnitude('medium'),
        affectedDimensions: ['riskTolerance'],
      });
    }
  }

  private calculateMagnitude(
    signalAId: string,
    signalBId: string,
    conceptHigh: number[],
    conceptLow: number[]
  ): number {
    const embA = this.signalEmbeddings.get(signalAId);
    const embB = this.signalEmbeddings.get(signalBId);
    if (!embA || !embB) {
      return 0.5;
    }

    const scoreA = cosineSimilarity(embA, conceptHigh) - cosineSimilarity(embA, conceptLow);
    const scoreB = cosineSimilarity(embB, conceptHigh) - cosineSimilarity(embB, conceptLow);
    return Math.max(0, Math.min(1, Math.abs(scoreA - scoreB)));
  }

  private calculateMagnitudeForDimensions(
    signalAId: string,
    signalBId: string,
    affectedDimensions: Array<keyof BehavioralDimensions>,
    fallbackSeverity: SignalContradiction['severity']
  ): number {
    if (!this.dimensionConceptEmbeddings) {
      return this.getFallbackMagnitude(fallbackSeverity);
    }

    const magnitudes = affectedDimensions
      .map(dimension => this.dimensionConceptEmbeddings?.[dimension])
      .filter((concepts): concepts is NonNullable<ConceptEmbeddings[keyof BehavioralDimensions]> => Boolean(concepts))
      .map(concepts => this.calculateMagnitude(signalAId, signalBId, concepts.high, concepts.low));

    if (magnitudes.length === 0) {
      return this.getFallbackMagnitude(fallbackSeverity);
    }

    const averageMagnitude = magnitudes.reduce((sum, magnitude) => sum + magnitude, 0) / magnitudes.length;
    return Math.max(0, Math.min(1, averageMagnitude));
  }

  private getFallbackMagnitude(severity: SignalContradiction['severity']): number {
    switch (severity) {
      case 'low':
        return 0.3;
      case 'high':
        return 0.8;
      default:
        return 0.5;
    }
  }

  private buildContradictionKey(contradiction: Pick<SignalContradiction, 'type' | 'signalAId' | 'signalBId' | 'affectedDimensions'>): string {
    const affectedDimensions = [...contradiction.affectedDimensions].sort().join('|');
    return [contradiction.type, contradiction.signalAId, contradiction.signalBId, affectedDimensions].join('::');
  }

  private addContradiction(partial: Omit<SignalContradiction, 'id' | 'convergenceRate' | 'isPermanentTrait' | 'firstSeen' | 'lastSeen'>): void {
    const contradictionKey = this.buildContradictionKey(partial);
    const match = this.existingContradictions.find(c => this.buildContradictionKey(c) === contradictionKey);

    const signalA = this.signals.find(s => s.id === partial.signalAId);
    const signalB = this.signals.find(s => s.id === partial.signalBId);
    const tA = signalA ? new Date(signalA.timestamp).getTime() : Date.now();
    const tB = signalB ? new Date(signalB.timestamp).getTime() : Date.now();
    const latestTimestamp = Math.max(tA, tB);
    const earliestTimestamp = Math.min(tA, tB);

    if (match) {
      const oldFirstSeen = match.firstSeen ? new Date(match.firstSeen).getTime() : earliestTimestamp;
      const oldLastSeen = match.lastSeen ? new Date(match.lastSeen).getTime() : oldFirstSeen;
      
      const newLastSeen = Math.max(oldLastSeen, latestTimestamp);
      const daysElapsed = Math.max(1, (newLastSeen - oldFirstSeen) / (1000 * 60 * 60 * 24));
      const convergenceRate = (partial.magnitude - match.magnitude) / daysElapsed;
      const isPermanentTrait = daysElapsed >= 365;

      this.contradictions.push({
        ...match,
        ...partial,
        id: match.id,
        convergenceRate,
        isPermanentTrait,
        firstSeen: new Date(oldFirstSeen).toISOString(),
        lastSeen: new Date(newLastSeen).toISOString(),
      });
    } else {
      this.contradictions.push({
        id: uuidv4(),
        ...partial,
        convergenceRate: 0,
        isPermanentTrait: false,
        firstSeen: new Date(earliestTimestamp).toISOString(),
        lastSeen: new Date(latestTimestamp).toISOString(),
      });
    }
  }
}
