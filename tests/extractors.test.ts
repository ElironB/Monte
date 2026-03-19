import { describe, it, expect } from 'vitest';
import { SearchHistoryExtractor } from '../src/ingestion/extractors/searchHistory.js';
import { SocialBehaviorExtractor } from '../src/ingestion/extractors/socialBehavior.js';
import { FinancialBehaviorExtractor } from '../src/ingestion/extractors/financialBehavior.js';
import { CognitiveStructureExtractor } from '../src/ingestion/extractors/cognitiveStructure.js';
import { MediaConsumptionExtractor } from '../src/ingestion/extractors/mediaConsumption.js';
import { RawSourceData } from '../src/ingestion/types.js';
import * as fs from 'fs';
import * as path from 'path';

function makeRaw(sourceType: string, content: string, metadata?: Record<string, unknown>): RawSourceData {
  return {
    sourceId: 'test-source',
    userId: 'test-user',
    sourceType: sourceType as any,
    rawContent: content,
    metadata: metadata || {},
  };
}

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');
}

// =============================================================================
// SearchHistoryExtractor
// =============================================================================
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

  it('populates frequency, recurrence, temporalCluster from structured JSON', async () => {
    const fixture = loadFixture('search-history.json');
    const data = makeRaw('search_history', fixture);
    const signals = await extractor.extract(data);

    const finSignal = signals.find(s => s.value === 'financial_trading');
    expect(finSignal).toBeDefined();
    expect(finSignal!.dimensions.frequency).toBeGreaterThan(0);
    expect(finSignal!.dimensions.recurrence).toBeGreaterThan(0);
    expect(finSignal!.dimensions.temporalCluster).toBeDefined();
  });

  it('produces higher confidence for higher-frequency categories', async () => {
    const highFinance = JSON.stringify({
      searches: [
        { query: 'bitcoin price', timestamp: '2026-01-01T10:00:00Z' },
        { query: 'crypto trading', timestamp: '2026-01-02T10:00:00Z' },
        { query: 'stock market', timestamp: '2026-01-03T10:00:00Z' },
        { query: 'invest in ethereum', timestamp: '2026-01-04T10:00:00Z' },
        { query: 'day trading tips', timestamp: '2026-01-05T10:00:00Z' },
        { query: 'trading platform', timestamp: '2026-01-06T10:00:00Z' },
        { query: 'best stocks 2026', timestamp: '2026-01-07T10:00:00Z' },
        { query: 'bitcoin analysis', timestamp: '2026-01-08T10:00:00Z' },
        { query: 'crypto exchange', timestamp: '2026-01-09T10:00:00Z' },
        { query: 'stock broker review', timestamp: '2026-01-10T10:00:00Z' },
        { query: 'gym near me', timestamp: '2026-01-11T10:00:00Z' },
        { query: 'pizza recipe', timestamp: '2026-01-12T10:00:00Z' },
      ],
    });
    const lowFinance = JSON.stringify({
      searches: [
        { query: 'bitcoin price', timestamp: '2026-01-01T10:00:00Z' },
        { query: 'gym near me', timestamp: '2026-01-02T10:00:00Z' },
        { query: 'pizza recipe', timestamp: '2026-01-03T10:00:00Z' },
        { query: 'weather today', timestamp: '2026-01-04T10:00:00Z' },
        { query: 'funny cat videos', timestamp: '2026-01-05T10:00:00Z' },
        { query: 'best restaurants', timestamp: '2026-01-06T10:00:00Z' },
        { query: 'news today', timestamp: '2026-01-07T10:00:00Z' },
        { query: 'movie reviews', timestamp: '2026-01-08T10:00:00Z' },
        { query: 'hiking trails', timestamp: '2026-01-09T10:00:00Z' },
        { query: 'book recommendations', timestamp: '2026-01-10T10:00:00Z' },
        { query: 'guitar lessons', timestamp: '2026-01-11T10:00:00Z' },
        { query: 'coffee shops', timestamp: '2026-01-12T10:00:00Z' },
      ],
    });

    const highSignals = await extractor.extract(makeRaw('search_history', highFinance));
    const lowSignals = await extractor.extract(makeRaw('search_history', lowFinance));

    const highFin = highSignals.find(s => s.value === 'financial_trading')!;
    const lowFin = lowSignals.find(s => s.value === 'financial_trading')!;

    expect(highFin.confidence).toBeGreaterThan(lowFin.confidence);
    expect(highFin.dimensions.frequency).toBeGreaterThan(lowFin.dimensions.frequency!);
  });

  it('detects intensityTrend on fixture data', async () => {
    const fixture = loadFixture('search-history.json');
    const data = makeRaw('search_history', fixture);
    const signals = await extractor.extract(data);

    const finSignal = signals.find(s => s.value === 'financial_trading');
    expect(finSignal).toBeDefined();
    expect(finSignal!.dimensions.intensityTrend).toBeDefined();
    expect(['increasing', 'decreasing', 'stable']).toContain(finSignal!.dimensions.intensityTrend);
  });
});

// =============================================================================
// SocialBehaviorExtractor
// =============================================================================
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

  it('populates quantitative dimensions from structured JSON', async () => {
    const fixture = loadFixture('reddit-posts.json');
    const data = makeRaw('social_media', fixture);
    const signals = await extractor.extract(data);

    const riskSignal = signals.find(s => s.value === 'high_risk_tolerance');
    expect(riskSignal).toBeDefined();
    expect(riskSignal!.dimensions.frequency).toBeGreaterThan(0);
    expect(riskSignal!.dimensions.recurrence).toBeGreaterThan(0);
    expect(riskSignal!.dimensions.temporalCluster).toBeDefined();
  });

  it('detects co-occurrence of risk and anxiety', async () => {
    const fixture = loadFixture('reddit-posts.json');
    const data = makeRaw('social_media', fixture);
    const signals = await extractor.extract(data);

    const riskSignal = signals.find(s => s.value === 'high_risk_tolerance');
    expect(riskSignal).toBeDefined();
    expect(riskSignal!.dimensions.coOccurrence).toBeDefined();
    expect(riskSignal!.dimensions.coOccurrence).toContain('anxiety');
  });

  it('tracks increasing anxiety trend', async () => {
    const increasing = JSON.stringify({
      posts: [
        { title: 'all good', body: 'life is fine', timestamp: '2026-01-01T10:00:00Z' },
        { title: 'hmm', body: "a bit stressed about work", timestamp: '2026-02-01T10:00:00Z' },
        { title: 'not great', body: "so stressed and anxious and worried and can't sleep, really panicking", timestamp: '2026-03-01T10:00:00Z' },
      ],
    });
    const data = makeRaw('social_media', increasing);
    const signals = await extractor.extract(data);
    const anxiety = signals.find(s => s.value === 'anxiety');
    expect(anxiety).toBeDefined();
    expect(anxiety!.dimensions.intensityTrend).toBe('increasing');
  });
});

// =============================================================================
// FinancialBehaviorExtractor
// =============================================================================
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

  it('populates quantitative dimensions from CSV fixture', async () => {
    const fixture = loadFixture('transactions.csv');
    const data = makeRaw('financial', fixture);
    const signals = await extractor.extract(data);

    const impulse = signals.find(s => s.value === 'impulse_spending');
    expect(impulse).toBeDefined();
    expect(impulse!.dimensions.frequency).toBeGreaterThan(0);
    expect(impulse!.dimensions.recurrence).toBeGreaterThan(0);
    expect(impulse!.dimensions.temporalCluster).toBeDefined();

    const fees = signals.find(s => s.value === 'budget_struggles');
    expect(fees).toBeDefined();
    expect(fees!.dimensions.frequency).toBeGreaterThanOrEqual(3);

    const invest = signals.find(s => s.value === 'active_investor');
    expect(invest).toBeDefined();
    expect(invest!.dimensions.frequency).toBeGreaterThanOrEqual(2);
  });

  it('sets temporalCluster on late-night transactions', async () => {
    const csv = [
      'date,description,amount,category',
      '2026-01-05T02:30:00Z,Amazon 2am Order,89.99,shopping',
      '2026-01-08T03:15:00Z,Amazon Late Night,49.99,shopping',
      '2026-01-12T01:00:00Z,Impulse Midnight Buy,29.99,shopping',
    ].join('\n');
    const data = makeRaw('financial', csv);
    const signals = await extractor.extract(data);
    const impulse = signals.find(s => s.value === 'impulse_spending');
    expect(impulse).toBeDefined();
    expect(impulse!.dimensions.temporalCluster).toBe('late_night');
  });

  it('higher transaction volume produces different confidence than low volume', async () => {
    const small = [
      'date,description,amount,category',
      '2026-01-05,Amazon Impulse,50.00,shopping',
      '2026-01-06,Groceries,30.00,food',
    ].join('\n');

    const large = [
      'date,description,amount,category',
      ...Array.from({ length: 30 }, (_, i) =>
        `2026-01-${String(i + 1).padStart(2, '0')},Amazon Impulse,50.00,shopping`
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        `2026-02-${String(i + 1).padStart(2, '0')},Groceries,30.00,food`
      ),
    ].join('\n');

    const smallSignals = await extractor.extract(makeRaw('financial', small));
    const largeSignals = await extractor.extract(makeRaw('financial', large));

    const smallImpulse = smallSignals.find(s => s.value === 'impulse_spending')!;
    const largeImpulse = largeSignals.find(s => s.value === 'impulse_spending')!;

    expect(largeImpulse.dimensions.frequency).toBeGreaterThan(smallImpulse.dimensions.frequency!);
  });
});

// =============================================================================
// CognitiveStructureExtractor
// =============================================================================
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

  it('populates frequency and recurrence from fixture', async () => {
    const fixture = loadFixture('notes/goals-2026.md');
    const data = makeRaw('notes', fixture);
    const signals = await extractor.extract(data);

    const organized = signals.find(s => s.value === 'highly_organized');
    expect(organized).toBeDefined();
    expect(organized!.dimensions.frequency).toBeGreaterThan(0);

    const goals = signals.find(s => s.value === 'goal_oriented');
    expect(goals).toBeDefined();
    expect(goals!.dimensions.frequency).toBeGreaterThan(0);
    expect(goals!.dimensions.recurrence).toBeGreaterThan(0);

    const reflection = signals.find(s => s.value === 'deep_self_reflection');
    expect(reflection).toBeDefined();
    expect(reflection!.dimensions.frequency).toBeGreaterThan(10);
  });

  it('higher structure density increases organization confidence', async () => {
    const minimal = '# Title\n\n' + 'word '.repeat(300);
    const dense = '# Title\n\n## A\n\n- item 1\n- item 2\n- item 3\n\n## B\n\n| x | y |\n|--|--|\n| 1 | 2 |\n\n' + 'word '.repeat(300);

    const minSignals = await extractor.extract(makeRaw('notes', minimal));
    const denseSignals = await extractor.extract(makeRaw('notes', dense));

    const minOrg = minSignals.find(s => s.value === 'highly_organized');
    const denseOrg = denseSignals.find(s => s.value === 'highly_organized');
    expect(denseOrg).toBeDefined();
    expect(denseOrg!.confidence).toBeGreaterThan(minOrg?.confidence ?? 0);
  });
});

// =============================================================================
// MediaConsumptionExtractor
// =============================================================================
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

  it('populates quantitative dimensions from fixture', async () => {
    const fixture = loadFixture('watch-history.json');
    const data = makeRaw('watch_history', fixture);
    const signals = await extractor.extract(data);

    const edu = signals.find(s => s.value === 'educational_content');
    expect(edu).toBeDefined();
    expect(edu!.dimensions.frequency).toBeGreaterThan(0);
    expect(edu!.dimensions.recurrence).toBeGreaterThan(0);
    expect(edu!.dimensions.temporalCluster).toBeDefined();
  });

  it('detects topic clustering via coOccurrence', async () => {
    const fixture = loadFixture('watch-history.json');
    const data = makeRaw('watch_history', fixture);
    const signals = await extractor.extract(data);

    const withTopics = signals.find(s => s.dimensions.coOccurrence && s.dimensions.coOccurrence.length > 0);
    expect(withTopics).toBeDefined();
  });

  it('calculates education vs entertainment ratio', async () => {
    const fixture = loadFixture('watch-history.json');
    const data = makeRaw('watch_history', fixture);
    const signals = await extractor.extract(data);

    const focused = signals.find(s => s.value === 'learning_focused');
    expect(focused).toBeDefined();
    expect(focused!.evidence).toMatch(/ratio/i);
  });

  it('detects intensityTrend for educational content', async () => {
    const fixture = loadFixture('watch-history.json');
    const data = makeRaw('watch_history', fixture);
    const signals = await extractor.extract(data);

    const edu = signals.find(s => s.value === 'educational_content');
    expect(edu).toBeDefined();
    expect(['increasing', 'decreasing', 'stable']).toContain(edu!.dimensions.intensityTrend);
  });
});
