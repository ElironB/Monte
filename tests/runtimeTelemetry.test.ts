import { describe, expect, test } from 'vitest';
import {
  createEmptySimulationRuntimeTelemetry,
  mergeSimulationRuntimeTelemetry,
} from '../src/simulation/runtimeTelemetry.js';

describe('runtime telemetry helpers', () => {
  test('merges batch telemetry into a single simulation summary', () => {
    const first = createEmptySimulationRuntimeTelemetry();
    first.executionDurationMs = 12_000;
    first.executionMaxBatchDurationMs = 12_000;
    first.persistenceDurationMs = 1_400;
    first.persistenceMaxBatchDurationMs = 1_400;
    first.cloneCount = 100;
    first.batchCount = 1;
    first.cloneConcurrency = 10;
    first.decisionBatchSize = 10;
    first.decisionBatchFlushMs = 15;
    first.llmRpmLimit = 100;
    first.llm.totalDecisionEvaluations = 40;
    first.llm.batchCalls = 4;
    first.llm.totalChatDurationMs = 8_000;
    first.llm.nodeStats = [
      {
        nodeId: 'start',
        batchCalls: 2,
        singleCalls: 0,
        standardCalls: 2,
        reasoningCalls: 0,
        cloneDecisions: 20,
        totalDurationMs: 3_600,
        totalBatchWaitMs: 80,
        maxBatchSize: 10,
      },
    ];
    first.rateLimiter.totalWaitMs = 2_000;

    const second = createEmptySimulationRuntimeTelemetry();
    second.executionDurationMs = 10_000;
    second.executionMaxBatchDurationMs = 10_000;
    second.persistenceDurationMs = 1_000;
    second.persistenceMaxBatchDurationMs = 1_000;
    second.cloneCount = 100;
    second.batchCount = 1;
    second.cloneConcurrency = 10;
    second.decisionBatchSize = 10;
    second.decisionBatchFlushMs = 15;
    second.llmRpmLimit = 100;
    second.llm.totalDecisionEvaluations = 44;
    second.llm.batchCalls = 4;
    second.llm.totalChatDurationMs = 7_600;
    second.llm.nodeStats = [
      {
        nodeId: 'start',
        batchCalls: 2,
        singleCalls: 0,
        standardCalls: 2,
        reasoningCalls: 0,
        cloneDecisions: 20,
        totalDurationMs: 3_200,
        totalBatchWaitMs: 90,
        maxBatchSize: 10,
      },
      {
        nodeId: 'final_tradeoff',
        batchCalls: 2,
        singleCalls: 1,
        standardCalls: 1,
        reasoningCalls: 2,
        cloneDecisions: 24,
        totalDurationMs: 4_100,
        totalBatchWaitMs: 120,
        maxBatchSize: 10,
      },
    ];
    second.rateLimiter.totalWaitMs = 1_500;

    const merged = mergeSimulationRuntimeTelemetry([first, second]);

    expect(merged.executionDurationMs).toBe(22_000);
    expect(merged.persistenceDurationMs).toBe(2_400);
    expect(merged.cloneCount).toBe(200);
    expect(merged.llm.totalDecisionEvaluations).toBe(84);
    expect(merged.llm.batchCalls).toBe(8);
    expect(merged.rateLimiter.totalWaitMs).toBe(3_500);
    expect(merged.llm.nodeStats[0]).toMatchObject({
      nodeId: 'start',
      cloneDecisions: 40,
      batchCalls: 4,
      totalDurationMs: 6_800,
    });
    expect(merged.llm.nodeStats[1]).toMatchObject({
      nodeId: 'final_tradeoff',
      cloneDecisions: 24,
      batchCalls: 2,
    });
  });
});
