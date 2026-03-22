import { expect, test, describe } from 'vitest';
import { DimensionMapper } from '../../src/persona/dimensionMapper.js';
import { BehavioralSignal } from '../../src/ingestion/types.js';
import { ConceptEmbeddings } from '../../src/embeddings/dimensionConcepts.js';

describe('DimensionMapper', () => {
  const mockConcepts: ConceptEmbeddings = {
    riskTolerance: {
      high: [[1, 0, 0]],
      low: [[0, 1, 0]],
      negative: [[0, 0, 1]]
    }
  };

  const createSignal = (id: string, source: string): BehavioralSignal => ({
    id,
    type: 'financial_behavior',
    value: 'test',
    timestamp: new Date().toISOString(),
    confidence: 0.9,
    evidence: 'test',
    sourceDataId: 'test',
    dimensions: {},
    sourceType: source,
    sourceReliability: 0.8
  });

  test('should accurately calculate confidence intervals and isEstimated based on source diversity', () => {
    // Single source = estimated
    const singleSourceSignals = [
      createSignal('1', 'financial'),
      createSignal('2', 'financial'),
      createSignal('3', 'financial'),
      createSignal('4', 'financial')
    ];
    
    const embeddings1 = new Map([
      ['1', [0.9, 0, 0]],
      ['2', [0.9, 0, 0]],
      ['3', [0.9, 0, 0]],
      ['4', [0.9, 0, 0]]
    ]);

    const mapper1 = new DimensionMapper(singleSourceSignals, mockConcepts, embeddings1, []);
    const result1 = mapper1.mapToDimensionsWithContradictions();
    
    const score1 = result1.dimensionScores.riskTolerance;
    expect(score1.isEstimated).toBe(true);
    expect(score1.sourceCount).toBe(1);
    expect(score1.signalCount).toBe(4);
    
    // Multi source = not estimated (since count >= 3 and sources > 1)
    const multiSourceSignals = [
      createSignal('1', 'financial'),
      createSignal('2', 'social_media'),
      createSignal('3', 'search_history')
    ];
    
    const embeddings2 = new Map([
      ['1', [0.9, 0, 0]],
      ['2', [0.9, 0, 0]],
      ['3', [0.9, 0, 0]]
    ]);

    const mapper2 = new DimensionMapper(multiSourceSignals, mockConcepts, embeddings2, []);
    const result2 = mapper2.mapToDimensionsWithContradictions();
    
    const score2 = result2.dimensionScores.riskTolerance;
    expect(score2.isEstimated).toBe(false);
    expect(score2.sourceCount).toBe(3);
    
    // The confidence interval of multi-source should be significantly tighter (smaller width)
    const width1 = score1.confidenceInterval[1] - score1.confidenceInterval[0];
    const width2 = score2.confidenceInterval[1] - score2.confidenceInterval[0];
    expect(width2).toBeLessThan(width1);
  });

  test('should skip signals that trigger the negative anchor gate', () => {
    const signals = [
      createSignal('1', 'financial'),
    ];
    
    // The embedding perfectly matches the negative anchor ([0, 0, 1])
    const embeddings = new Map([
      ['1', [0, 0, 1]]
    ]);

    const mapper = new DimensionMapper(signals, mockConcepts, embeddings, []);
    const result = mapper.mapToDimensionsWithContradictions();
    
    // Signal should be skipped, so count is 0, making it default to 0.5 and estimated
    const score = result.dimensionScores.riskTolerance;
    expect(score.signalCount).toBe(0);
    expect(score.value).toBe(0.5);
    expect(score.isEstimated).toBe(true);
  });
});
