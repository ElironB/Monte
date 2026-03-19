import { describe, it, expect } from 'vitest';
import { SearchHistoryExtractor } from '../src/ingestion/extractors/searchHistory.js';
import { SocialBehaviorExtractor } from '../src/ingestion/extractors/socialBehavior.js';
import { FinancialBehaviorExtractor } from '../src/ingestion/extractors/financialBehavior.js';
import { CognitiveStructureExtractor } from '../src/ingestion/extractors/cognitiveStructure.js';
import { MediaConsumptionExtractor } from '../src/ingestion/extractors/mediaConsumption.js';
import { RawSourceData } from '../src/ingestion/types.js';

function makeRaw(sourceType: string, content: string, metadata?: Record<string, unknown>): RawSourceData {
  return {
    sourceId: 'test-source',
    userId: 'test-user',
    sourceType: sourceType as any,
    rawContent: content,
    metadata: metadata || {},
  };
}

describe('SearchHistoryExtractor', () => {
  const extractor = new SearchHistoryExtractor();

  it('detects financial trading intent', async () => {
    const data = makeRaw('search_history', 'how to invest in bitcoin stock trading crypto');
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'financial_trading')).toBe(true);
  });

  it('detects career change intent', async () => {
    const data = makeRaw('search_history', 'career change at 30 new job salary negotiation');
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'career_change')).toBe(true);
  });

  it('detects education intent', async () => {
    const data = makeRaw('search_history', 'MBA worth it online degree university');
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'education')).toBe(true);
  });

  it('detects relocation intent', async () => {
    const data = makeRaw('search_history', 'moving to austin apartments rent cost of living');
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'relocation')).toBe(true);
  });

  it('detects health/fitness intent', async () => {
    const data = makeRaw('search_history', 'best gym workout plan lose weight diet');
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'health_fitness')).toBe(true);
  });

  it('extracts urgency score', async () => {
    const data = makeRaw('search_history', 'invest in crypto now urgent today quick');
    const signals = await extractor.extract(data);
    const finSignal = signals.find(s => s.value === 'financial_trading');
    expect(finSignal).toBeDefined();
    expect(finSignal!.dimensions.urgency).toBeGreaterThan(0);
  });

  it('returns empty for irrelevant content', async () => {
    const data = makeRaw('search_history', 'best pizza recipe homemade dough');
    const signals = await extractor.extract(data);
    expect(signals).toHaveLength(0);
  });
});

describe('SocialBehaviorExtractor', () => {
  const extractor = new SocialBehaviorExtractor();

  it('detects high risk tolerance', async () => {
    const data = makeRaw('social_media', 'YOLO diamond hands to the moon all in');
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'high_risk_tolerance')).toBe(true);
  });

  it('detects anxiety', async () => {
    const data = makeRaw('social_media', "I'm so stressed and anxious, can't sleep at night");
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'anxiety')).toBe(true);
  });

  it('detects decision paralysis', async () => {
    const data = makeRaw('social_media', "I'm stuck and can't decide what to do, help me choose");
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'decision_paralysis')).toBe(true);
  });
});

describe('FinancialBehaviorExtractor', () => {
  const extractor = new FinancialBehaviorExtractor();

  it('detects impulse spending', async () => {
    const data = makeRaw('financial', 'Amazon late night purchase 2am impulse buy');
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'impulse_spending')).toBe(true);
  });

  it('detects budget struggles', async () => {
    const data = makeRaw('financial', 'overdraft fee declined transaction insufficient funds late fee');
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'budget_struggles')).toBe(true);
  });

  it('detects active investor', async () => {
    const data = makeRaw('financial', 'dividend payment deposit to investment account brokerage');
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'active_investor')).toBe(true);
  });
});

describe('CognitiveStructureExtractor', () => {
  const extractor = new CognitiveStructureExtractor();

  it('detects highly organized from structured notes', async () => {
    const longStructured = '# My Goals\n\n' + '## Section\n\n' + 'word '.repeat(1100) + '\n\n| col1 | col2 |\n|--|--|\n| a | b |';
    const data = makeRaw('notes', longStructured);
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'highly_organized')).toBe(true);
  });

  it('detects freeform thinker from unstructured notes', async () => {
    const longUnstructured = 'just thinking about stuff today and wondering what to do next '.repeat(50);
    const data = makeRaw('notes', longUnstructured);
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'freeform_thinker')).toBe(true);
  });

  it('detects goal-oriented behavior', async () => {
    const data = makeRaw('notes', 'My goals for Q1 2026: target revenue, plan for Q2 objectives');
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'goal_oriented')).toBe(true);
  });

  it('detects deep self-reflection', async () => {
    const reflective = 'I feel that I think too much. I realized why I feel this way. Because I learned that I think about why I feel things. I realized because I learned to feel and think deeply. Why do I feel this way? Because I think too much.';
    const data = makeRaw('notes', reflective);
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'deep_self_reflection')).toBe(true);
  });
});

describe('MediaConsumptionExtractor', () => {
  const extractor = new MediaConsumptionExtractor();

  it('detects educational content', async () => {
    const data = makeRaw('watch_history', 'Tutorial: Python Basics\nDocumentary: History of AI\nLecture: Computer Science\nHow to build a startup');
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'educational_content')).toBe(true);
  });

  it('detects learning-focused consumption', async () => {
    const data = makeRaw('watch_history', 'documentary science lecture tutorial history documentary science lecture tutorial documentary history science');
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'learning_focused')).toBe(true);
  });

  it('detects high media consumption', async () => {
    const dates = Array.from({ length: 15 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')} Some Video Title`).join('\n');
    const data = makeRaw('watch_history', dates);
    const signals = await extractor.extract(data);
    expect(signals.some(s => s.value === 'high_media_consumption')).toBe(true);
  });
});
