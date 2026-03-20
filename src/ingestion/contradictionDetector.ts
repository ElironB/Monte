import { v4 as uuidv4 } from 'uuid';
import { EmbeddingService, cosineSimilarity } from '../embeddings/embeddingService.js';
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
  private contradictions: SignalContradiction[] = [];

  constructor(signals: BehavioralSignal[], signalEmbeddings?: Map<string, number[]>) {
    this.signals = signals;
    this.signalEmbeddings = signalEmbeddings ?? new Map();
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
      });
    }
  }

  private addContradiction(partial: Omit<SignalContradiction, 'id'>): void {
    this.contradictions.push({
      id: uuidv4(),
      ...partial,
    });
  }
}
