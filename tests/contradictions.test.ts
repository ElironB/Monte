import { describe, it, expect } from 'vitest';
import { ContradictionDetector } from '../src/ingestion/contradictionDetector.js';
import { BehavioralSignal } from '../src/ingestion/types.js';

function makeSignal(overrides: Partial<BehavioralSignal>): BehavioralSignal {
  return {
    id: `sig-${Math.random().toString(36).slice(2, 8)}`,
    type: 'cognitive_trait',
    value: '',
    confidence: 0.8,
    evidence: 'test',
    sourceDataId: 'test',
    timestamp: new Date().toISOString(),
    dimensions: {},
    ...overrides,
  };
}

describe('ContradictionDetector', () => {
  it('detects cross-domain contradictions (risk tolerance vs financial stress)', () => {
    const signals = [
      makeSignal({ type: 'cognitive_trait', value: 'high_risk_tolerance' }),
      makeSignal({ type: 'financial_behavior', value: 'impulse_spending' }),
    ];
    const detector = new ContradictionDetector(signals);
    const contradictions = detector.detect();
    expect(contradictions.some(c => c.type === 'cross_domain')).toBe(true);
  });

  it('detects temporal contradictions (goal-oriented but repeated failures)', () => {
    const signals = [
      makeSignal({ value: 'goal_oriented' }),
      makeSignal({ value: 'budget_struggles' }),
      makeSignal({ value: 'budget_struggles' }),
      makeSignal({ value: 'budget_struggles' }),
      makeSignal({ value: 'budget_struggles' }),
    ];
    const detector = new ContradictionDetector(signals);
    const contradictions = detector.detect();
    expect(contradictions.some(c => c.type === 'temporal')).toBe(true);
  });

  it('returns empty when no contradictions', () => {
    const signals = [
      makeSignal({ value: 'educational_content' }),
      makeSignal({ value: 'learning_focused' }),
    ];
    const detector = new ContradictionDetector(signals);
    const contradictions = detector.detect();
    expect(contradictions).toHaveLength(0);
  });
});
