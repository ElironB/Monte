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
});
