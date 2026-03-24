import { describe, expect, test, vi } from 'vitest';
import {
  BatchEvaluationItem,
  ForkEvaluator,
} from '../src/simulation/forkEvaluator.js';
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
  function createBatchItems(count: number): BatchEvaluationItem[] {
    return Array.from({ length: count }, (_, index) => ({
      index,
      requestId: `case_${index + 1}`,
      request: {
        cloneParams: {} as any,
        decisionNode,
        state: {
          capital: 10000,
          health: 0.8,
          happiness: 0.7,
          timeElapsed: 1,
          metrics: {},
          decisions: [],
        } as any,
        scenario: {
          id: 'custom',
          name: 'Custom',
          graph: [],
          initialState: {} as any,
          timeframe: 'x',
          description: 'x',
          entryNodeId: 'start',
        },
      },
      complexity: 0.4 + (index * 0.1),
      useReasoning: false,
      nodeId: decisionNode.id,
      batchWaitMs: 0,
    }));
  }

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

  test('parses compact batched decisions in case order', () => {
    const evaluator = new ForkEvaluator();
    const items = createBatchItems(2);

    const result = (evaluator as any).parseBatchLLMResponse(
      '{"d":[{"o":1,"c":0.91,"r":"Balanced persona hedges exposure."},{"o":0,"c":0.82,"r":"Adaptive profile prefers flexibility."}]}',
      items,
    );

    expect(result.get(0)).toMatchObject({
      chosenOptionId: 'partial_commit',
      confidence: 0.91,
    });
    expect(result.get(1)).toMatchObject({
      chosenOptionId: 'adapt',
      confidence: 0.82,
    });
  });

  test('parses legacy batched decisions keyed by request id', () => {
    const evaluator = new ForkEvaluator();
    const items = createBatchItems(2);

    const result = (evaluator as any).parseBatchLLMResponse(
      '{"decisions":[{"requestId":"case_1","chosenOptionId":"partial_commit","reasoning":"Balanced persona hedges exposure.","confidence":0.91},{"requestId":"case_2","chosenOptionId":"adapt","reasoning":"Adaptive profile prefers flexibility.","confidence":0.82}]}',
      items,
    );

    expect(result.get(0)).toMatchObject({
      chosenOptionId: 'partial_commit',
      confidence: 0.91,
    });
    expect(result.get(1)).toMatchObject({
      chosenOptionId: 'adapt',
      confidence: 0.82,
    });
  });

  test('keeps partial valid batched decisions and skips malformed entries', () => {
    const evaluator = new ForkEvaluator();
    const items = createBatchItems(2);

    const result = (evaluator as any).parseBatchLLMResponse(
      '{"d":[{"o":1,"c":0.91,"r":"Balanced persona hedges exposure."},"not-an-object"]}',
      items,
    );

    expect(result.size).toBe(1);
    expect(result.get(0)).toMatchObject({
      chosenOptionId: 'partial_commit',
      confidence: 0.91,
    });
    expect(result.has(1)).toBe(false);
  });

  test('parses stringified compact batches returned under d', () => {
    const evaluator = new ForkEvaluator();
    const items = createBatchItems(2);

    const result = (evaluator as any).parseBatchLLMResponse(
      '{"d":"[{\\"o\\":1,\\"c\\":0.91,\\"r\\":\\"Balanced persona hedges exposure.\\"},{\\"o\\":0,\\"c\\":0.82,\\"r\\":\\"Adaptive profile prefers flexibility.\\"}]"}',
      items,
    );

    expect(result.get(0)).toMatchObject({
      chosenOptionId: 'partial_commit',
      confidence: 0.91,
    });
    expect(result.get(1)).toMatchObject({
      chosenOptionId: 'adapt',
      confidence: 0.82,
    });
  });

  test('salvages complete entries from truncated compact batches', () => {
    const evaluator = new ForkEvaluator();
    const items = createBatchItems(3);

    const result = (evaluator as any).parseBatchLLMResponse(
      '{"d":[{"o":1,"c":0.91,"r":"Balanced persona hedges exposure."},{"o":0,"c":0.82,"r":"Adaptive profile prefers flexibility."},{"o":1,"c":0.77',
      items,
    );

    expect(result.size).toBe(2);
    expect(result.get(0)).toMatchObject({
      chosenOptionId: 'partial_commit',
      confidence: 0.91,
    });
    expect(result.get(1)).toMatchObject({
      chosenOptionId: 'adapt',
      confidence: 0.82,
    });
  });

  test('parses batches keyed by request id objects', () => {
    const evaluator = new ForkEvaluator();
    const items = createBatchItems(2);

    const result = (evaluator as any).parseBatchLLMResponse(
      '{"decisions":{"case_1":{"o":1,"c":0.91,"r":"Balanced persona hedges exposure."},"case_2":{"o":0,"c":0.82,"r":"Adaptive profile prefers flexibility."}}}',
      items,
    );

    expect(result.get(0)).toMatchObject({
      chosenOptionId: 'partial_commit',
      confidence: 0.91,
    });
    expect(result.get(1)).toMatchObject({
      chosenOptionId: 'adapt',
      confidence: 0.82,
    });
  });

  test('parses batches nested inside wrapper objects', () => {
    const evaluator = new ForkEvaluator();
    const items = createBatchItems(2);

    const result = (evaluator as any).parseBatchLLMResponse(
      '{"response":{"results":[{"o":1,"c":0.91,"r":"Balanced persona hedges exposure."},{"o":0,"c":0.82,"r":"Adaptive profile prefers flexibility."}]}}',
      items,
    );

    expect(result.get(0)).toMatchObject({
      chosenOptionId: 'partial_commit',
      confidence: 0.91,
    });
    expect(result.get(1)).toMatchObject({
      chosenOptionId: 'adapt',
      confidence: 0.82,
    });
  });

  test('caps preferred batch size for OpenRouter providers', () => {
    const evaluator = new ForkEvaluator();
    (evaluator as any).isOpenRouterProvider = true;

    expect(evaluator.getPreferredBatchSize('custom', false, 20)).toBe(2);
    expect(evaluator.getPreferredBatchSize('custom', true, 20)).toBe(1);
  });

  test('retries transient transport failures', async () => {
    const evaluator = new ForkEvaluator();
    vi.spyOn(evaluator as any, 'getTransientRetryDelayMs').mockReturnValue(0);

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Premature close'))
      .mockResolvedValueOnce('ok');

    const result = await (evaluator as any).callWithRetry(fn, 1);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('retries, splits, and only falls back to single calls for unresolved leaf batches', async () => {
    const evaluator = new ForkEvaluator();
    const items = createBatchItems(2);

    const batchSpy = vi.spyOn(evaluator as any, 'callBatchLLM')
      .mockRejectedValue(new Error('LLM returned an empty batched decision payload'));
    const singleSpy = vi.spyOn(evaluator as any, 'callSingleLLM')
      .mockImplementation(async (_request: unknown, complexity: number) => ({
        chosenOptionId: 'adapt',
        reasoning: 'single fallback',
        confidence: 0.81,
        complexity,
      }));

    const result = await (evaluator as any).resolveBatchItems(items, 0);
    const telemetry = evaluator.getTelemetry().llm;

    expect(result.size).toBe(2);
    expect(batchSpy).toHaveBeenCalledTimes(2);
    expect(singleSpy).toHaveBeenCalledTimes(2);
    expect(telemetry.batchRetryCount).toBe(1);
    expect(telemetry.splitBatchCount).toBe(1);
    expect(telemetry.singleFallbackFromBatchCount).toBe(2);
    expect(evaluator.getPreferredBatchSize('custom', false, 20)).toBe(1);
  });
});
