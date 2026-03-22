import { describe, it, expect } from 'vitest';
import { ContradictionDetector } from '../src/ingestion/contradictionDetector.js';
import type { ConceptEmbeddings } from '../src/embeddings/dimensionConcepts.js';
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
  const dimensionConceptEmbeddings: ConceptEmbeddings = {
    riskTolerance: { high: [[1, 0]], low: [[-1, 0]], negative: [] },
    timePreference: { high: [[0.9, 0.1]], low: [[-0.9, -0.1]], negative: [] },
    socialDependency: { high: [[0.7, 0.7]], low: [[-0.7, -0.7]], negative: [] },
    learningStyle: { high: [[0, 1]], low: [[0, -1]], negative: [] },
    decisionSpeed: { high: [[0.8, 0.2]], low: [[-0.8, -0.2]], negative: [] },
    emotionalVolatility: { high: [[0.6, 0.8]], low: [[-0.6, -0.8]], negative: [] },
  };

  it('detects cross-domain contradictions (risk tolerance vs financial stress)', async () => {
    const signals = [
      makeSignal({ type: 'cognitive_trait', value: 'high_risk_tolerance' }),
      makeSignal({ type: 'financial_behavior', value: 'impulse_spending' }),
    ];
    const detector = new ContradictionDetector(signals);
    const contradictions = await detector.detect();
    expect(contradictions.some(c => c.type === 'cross_domain')).toBe(true);
  });

  it('detects temporal contradictions (goal-oriented but repeated failures)', async () => {
    const signals = [
      makeSignal({ value: 'goal_oriented' }),
      makeSignal({ value: 'budget_struggles' }),
      makeSignal({ value: 'budget_struggles' }),
      makeSignal({ value: 'budget_struggles' }),
      makeSignal({ value: 'budget_struggles' }),
    ];
    const detector = new ContradictionDetector(signals);
    const contradictions = await detector.detect();
    expect(contradictions.some(c => c.type === 'temporal')).toBe(true);
  });

  it('returns empty when no contradictions', async () => {
    const signals = [
      makeSignal({ value: 'educational_content' }),
      makeSignal({ value: 'learning_focused' }),
    ];
    const detector = new ContradictionDetector(signals);
    const contradictions = await detector.detect();
    expect(contradictions).toHaveLength(0);
  });

  it('adds numeric magnitudes and affected dimensions to detected contradictions', async () => {
    const signals = [
      makeSignal({ value: 'goal_oriented' }),
      makeSignal({ value: 'budget_struggles' }),
      makeSignal({ value: 'budget_struggles' }),
      makeSignal({ value: 'budget_struggles' }),
      makeSignal({ value: 'budget_struggles' }),
    ];

    const contradictions = await new ContradictionDetector(signals).detect();
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].magnitude).toBeGreaterThanOrEqual(0);
    expect(contradictions[0].magnitude).toBeLessThanOrEqual(1);
    expect(contradictions[0].affectedDimensions).toEqual(['emotionalVolatility', 'decisionSpeed']);
  });

  it('calculates higher magnitude for signals further apart on the dimension axis', () => {
    const stated = makeSignal({ value: 'patient planner' });
    const revealedClose = makeSignal({ value: 'slightly urgent' });
    const revealedFar = makeSignal({ value: 'maximally urgent' });
    const signalEmbeddings = new Map<string, number[]>([
      [stated.id, [-0.2, 0.98]],
      [revealedClose.id, [0.2, 0.98]],
      [revealedFar.id, [1, 0]],
    ]);

    const detector = new ContradictionDetector(
      [stated, revealedClose, revealedFar],
      signalEmbeddings,
      dimensionConceptEmbeddings
    );

    const closeMagnitude = (detector as any).calculateMagnitude(
      stated.id,
      revealedClose.id,
      dimensionConceptEmbeddings.riskTolerance.high,
      dimensionConceptEmbeddings.riskTolerance.low
    );
    const farMagnitude = (detector as any).calculateMagnitude(
      stated.id,
      revealedFar.id,
      dimensionConceptEmbeddings.riskTolerance.high,
      dimensionConceptEmbeddings.riskTolerance.low
    );

    expect(closeMagnitude).toBeGreaterThanOrEqual(0);
    expect(farMagnitude).toBeLessThanOrEqual(1);
    expect(farMagnitude).toBeGreaterThan(closeMagnitude);
  });

  it('falls back to severity-based magnitude when dimension concepts are unavailable', async () => {
    const signals = [
      makeSignal({ value: 'goal_oriented' }),
      makeSignal({ value: 'budget_struggles' }),
      makeSignal({ value: 'budget_struggles' }),
      makeSignal({ value: 'budget_struggles' }),
      makeSignal({ value: 'budget_struggles' }),
    ];

    const contradictions = await new ContradictionDetector(signals, new Map(), null).detect();
    expect(contradictions[0].severity).toBe('high');
    expect(contradictions[0].magnitude).toBe(0.8);
  });


  it('reuses history across re-imported signals with fresh ids when the behavioral identities match', async () => {
    const existing = [{
      id: 'existing-contradiction',
      signalAId: 'old-signal-a',
      signalBId: 'old-signal-b',
      type: 'stated_vs_revealed' as const,
      description: 'Claims patience but shows urgent behavior patterns',
      severity: 'medium' as const,
      magnitude: 0.4,
      affectedDimensions: ['timePreference', 'decisionSpeed'],
      convergenceRate: 0,
      isPermanentTrait: false,
      firstSeen: '2025-01-01T00:00:00.000Z',
      lastSeen: '2025-01-10T00:00:00.000Z',
    }];

    const reimportedSignals = [
      makeSignal({
        id: 'new-signal-a',
        type: 'cognitive_trait',
        value: 'patient planner',
        sourceType: 'notes',
        dimensions: { category: 'psychology' },
        timestamp: '2025-02-01T00:00:00.000Z',
      }),
      makeSignal({
        id: 'new-signal-b',
        type: 'cognitive_trait',
        value: 'urgent follow-up',
        sourceType: 'notes',
        dimensions: { urgency: 0.9, category: 'psychology' },
        timestamp: '2025-02-15T00:00:00.000Z',
      }),
      makeSignal({
        id: 'old-signal-a',
        type: 'cognitive_trait',
        value: 'patient planner',
        sourceType: 'notes',
        dimensions: { category: 'psychology' },
        timestamp: '2025-01-01T00:00:00.000Z',
      }),
      makeSignal({
        id: 'old-signal-b',
        type: 'cognitive_trait',
        value: 'urgent follow-up',
        sourceType: 'notes',
        dimensions: { urgency: 0.8, category: 'psychology' },
        timestamp: '2025-01-10T00:00:00.000Z',
      }),
    ];

    const contradictions = await new ContradictionDetector(reimportedSignals, new Map(), null, existing).detect();
    const reused = contradictions.find(c => c.signalAId === 'new-signal-a' && c.signalBId === 'new-signal-b');

    expect(reused?.id).toBe('existing-contradiction');
    expect(reused?.firstSeen).toBe('2025-01-01T00:00:00.000Z');
    expect(reused?.lastSeen).toBe('2025-02-15T00:00:00.000Z');
    expect(reused?.convergenceRate).not.toBe(0);
  });

  it('reuses history only for the same signal pair and dimensions', async () => {
    const signalA = makeSignal({ id: 'signal-a', value: 'patient planner' });
    const signalB = makeSignal({ id: 'signal-b', value: 'urgent follow-up', dimensions: { urgency: 0.9 } });
    const signalC = makeSignal({ id: 'signal-c', value: 'urgent escalation', dimensions: { urgency: 0.95 } });

    const existing = [{
      id: 'existing-contradiction',
      signalAId: signalA.id,
      signalBId: signalB.id,
      type: 'stated_vs_revealed' as const,
      description: 'Claims patience but shows urgent behavior patterns',
      severity: 'medium' as const,
      magnitude: 0.4,
      affectedDimensions: ['timePreference', 'decisionSpeed'],
      convergenceRate: 0,
      isPermanentTrait: false,
      firstSeen: '2025-01-01T00:00:00.000Z',
      lastSeen: '2025-01-10T00:00:00.000Z',
    }];

    const detector = new ContradictionDetector([signalA, signalB, signalC], new Map(), null, existing);
    const contradictions = await detector.detect();

    const reused = contradictions.find(c => c.signalAId === signalA.id && c.signalBId === signalB.id);
    const distinct = contradictions.find(c => c.signalAId === signalA.id && c.signalBId === signalC.id);

    expect(reused?.id).toBe('existing-contradiction');
    expect(distinct).toBeDefined();
    expect(distinct?.id).not.toBe('existing-contradiction');
  });
});
