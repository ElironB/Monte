import { describe, expect, test } from 'vitest';
import { generateReport } from '../src/cli/commands/report.js';

describe('report command', () => {
  test('renders decision frame and decision intelligence sections when present', () => {
    const markdown = generateReport(
      {
        id: 'sim_123',
        name: 'OpenClaw runway bet',
        scenarioType: 'custom',
        status: 'completed',
        cloneCount: 1000,
        createdAt: '2026-03-22T00:00:00.000Z',
      },
      {
        scenarioId: 'custom',
        cloneCount: 1000,
        histograms: [],
        outcomeDistribution: {
          success: 0.42,
          failure: 0.33,
          neutral: 0.25,
          byCategory: {
            edge: { success: 0.08, failure: 0.01, neutral: 0.01 },
            typical: { success: 0.27, failure: 0.24, neutral: 0.19 },
            central: { success: 0.07, failure: 0.08, neutral: 0.05 },
          },
        },
        statistics: {
          meanCapital: 24_000,
          medianCapital: 21_000,
          meanHealth: 0.68,
          meanHappiness: 0.63,
          successRate: 0.42,
          averageDuration: 12,
        },
        stratifiedBreakdown: {
          edge: { count: 100, avgOutcome: 0.81 },
          typical: { count: 700, avgOutcome: 0.52 },
          central: { count: 200, avgOutcome: 0.44 },
        },
        decisionFrame: {
          title: 'OpenClaw runway bet',
          primaryQuestion: 'Should you commit the next 18 months to OpenClaw?',
          contextSummary: 'capital at risk: 18000 | fallback plan: keep consulting two days a week',
          timeframeMonths: 18,
          capitalAtRisk: 18_000,
          runwayMonths: 14,
          fallbackPlan: 'keep consulting two days a week',
          reversibilityScore: 0.42,
          socialExposure: 0.68,
          uncertaintyLoad: 0.61,
          downsideSeverity: 0.57,
          keyUnknowns: [
            'Will design partners pay to pilot OpenClaw?',
            'Can you ship every week under pressure?',
            'How much optionality disappears if you hire too early?',
          ],
        },
        decisionIntelligence: {
          summary: 'Across 1000 clones, the biggest uncertainty drivers were evidence quality and execution reliability.',
          dominantUncertainties: [
            'Will design partners pay to pilot OpenClaw?',
            'Can you ship every week under pressure?',
            'How much optionality disappears if you hire too early?',
          ],
          recommendedExperiments: [
            {
              priority: 'highest',
              focusMetric: 'evidenceQuality',
              uncertainty: 'Will design partners pay to pilot OpenClaw?',
              whyItMatters: 'Durable outcomes were separated most by better evidence quality.',
              recommendedExperiment: 'Run a two-week evidence sprint with direct pilot asks.',
              successSignal: 'Outside actors commit with time, money, or repeated use.',
              stopSignal: 'Interest remains polite and non-binding.',
              learningValue: 0.84,
            },
          ],
        },
        appliedEvidence: [
          {
            id: 'evidence-1',
            uncertainty: 'Will design partners pay to pilot OpenClaw?',
            focusMetric: 'evidenceQuality',
            recommendationIndex: 1,
            recommendedExperiment: 'Run a two-week evidence sprint with direct pilot asks.',
            result: 'positive',
            confidence: 0.86,
            observedSignal: 'Three design partners agreed to paid pilots within 10 days.',
            createdAt: '2026-03-22T00:00:00.000Z',
          },
        ],
        rerunComparison: {
          sourceSimulationId: 'sim_001',
          evidenceCount: 1,
          summary: 'Confidence increased by 8.0 points and uncertainty dropped by 11.0 points after applying 1 evidence result.',
          beliefDelta: {
            thesisConfidence: 0.08,
            uncertaintyLevel: -0.11,
            downsideSalience: -0.05,
          },
          recommendationDelta: {
            changed: true,
            previousTopUncertainty: 'Will design partners pay to pilot OpenClaw?',
            newTopUncertainty: 'Can you ship every week under pressure?',
            previousTopExperiment: 'Run a two-week evidence sprint with direct pilot asks.',
            newTopExperiment: 'Design a one- to two-week execution drill that forces a concrete deliverable.',
          },
        },
      },
      null,
      null,
    );

    expect(markdown).toContain('## Decision Frame');
    expect(markdown).toContain('## Decision Intelligence');
    expect(markdown).toContain('Should you commit the next 18 months to OpenClaw?');
    expect(markdown).toContain('Will design partners pay to pilot OpenClaw?');
    expect(markdown).toContain('Highest priority');
    expect(markdown).toContain('## Applied Evidence');
    expect(markdown).toContain('## Evidence Loop Delta');
  });
});
