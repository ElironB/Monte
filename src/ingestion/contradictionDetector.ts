import { BehavioralSignal, SignalContradiction } from './types.js';
import { v4 as uuidv4 } from 'uuid';

export class ContradictionDetector {
  private signals: BehavioralSignal[];
  private contradictions: SignalContradiction[] = [];

  constructor(signals: BehavioralSignal[]) {
    this.signals = signals;
  }

  detect(): SignalContradiction[] {
    this.contradictions = [];
    
    // Check for stated vs revealed contradictions
    this.checkStatedVsRevealed();
    
    // Check for temporal contradictions
    this.checkTemporalContradictions();
    
    // Check for cross-domain contradictions
    this.checkCrossDomainContradictions();
    
    return this.contradictions;
  }

  private checkStatedVsRevealed(): void {
    // Example: User says "I'm patient" but search history shows "urgent quick results now"
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
          description: `Claims patience but shows urgent behavior patterns`,
          severity: 'medium',
        });
      }
    }
  }

  private checkTemporalContradictions(): void {
    // Check for signals that contradict over time
    // Example: "goal_oriented" but "budget_struggles" consistently
    
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

  private checkCrossDomainContradictions(): void {
    // Check contradictions across different domains
    // Example: High risk tolerance in social media but conservative in financial
    
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
