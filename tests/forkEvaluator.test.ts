import { describe, expect, test } from 'vitest';
import { ForkEvaluator } from '../src/simulation/forkEvaluator.js';
import { DecisionNode } from '../src/simulation/types.js';

const decisionNode: DecisionNode = {
  id: 'test-node',
  type: 'decision',
  prompt: 'What should the clone do?',
  options: [
    { id: 'adapt', label: 'Adapt', value: 'adapt', nextNodeId: 'next-a' },
    { id: 'partial_commit', label: 'Partial commit', value: 'partial_commit', nextNodeId: 'next-b' },
  ],
};

describe('ForkEvaluator JSON parsing', () => {
  test('extracts the first complete JSON object from noisy content', () => {
    const evaluator = new ForkEvaluator();

    const result = (evaluator as any).parseLLMResponse(
      'Here is the answer:\n{"chosenOptionId":"partial_commit","reasoning":"Balanced persona hedges exposure.","confidence":0.91}\nThanks!',
      decisionNode,
      0.4
    );

    expect(result.chosenOptionId).toBe('partial_commit');
    expect(result.reasoning).toBe('Balanced persona hedges exposure.');
    expect(result.confidence).toBe(0.91);
  });

  test('falls back to the first valid option when the model returns an unknown option id', () => {
    const evaluator = new ForkEvaluator();

    const result = (evaluator as any).parseLLMResponse(
      '{"chosenOptionId":"unknown_option","reasoning":"test","confidence":0.2}',
      decisionNode,
      0.1
    );

    expect(result.chosenOptionId).toBe('adapt');
    expect(result.confidence).toBe(0.7);
  });

  test('parses batched decisions keyed by request id', () => {
    const evaluator = new ForkEvaluator();

    const result = (evaluator as any).parseBatchLLMResponse(
      '{"decisions":[{"requestId":"case_1","chosenOptionId":"partial_commit","reasoning":"Balanced persona hedges exposure.","confidence":0.91},{"requestId":"case_2","chosenOptionId":"adapt","reasoning":"Adaptive profile prefers flexibility.","confidence":0.82}]}',
      [
        {
          requestId: 'case_1',
          request: {
            cloneParams: {} as any,
            decisionNode,
            state: { metrics: {} } as any,
            scenario: { id: 'custom', name: 'Custom', graph: [], initialState: {} as any, timeframe: 'x', description: 'x', entryNodeId: 'start' },
          },
          complexity: 0.4,
        },
        {
          requestId: 'case_2',
          request: {
            cloneParams: {} as any,
            decisionNode,
            state: { metrics: {} } as any,
            scenario: { id: 'custom', name: 'Custom', graph: [], initialState: {} as any, timeframe: 'x', description: 'x', entryNodeId: 'start' },
          },
          complexity: 0.5,
        },
      ],
    );

    expect(result.get('case_1')).toMatchObject({
      chosenOptionId: 'partial_commit',
      confidence: 0.91,
    });
    expect(result.get('case_2')).toMatchObject({
      chosenOptionId: 'adapt',
      confidence: 0.82,
    });
  });
});
