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
    first.decisionConcurrency = 12;
    first.cloneConcurrency = 10;
    first.activeFrontier = 100;
    first.peakActiveFrontier = 80;
    first.peakWaitingDecisions = 14;
    first.localStepDurationMs = 1_600;
    first.decisionBatchSize = 20;
    first.decisionBatchFlushMs = 40;
    first.llmRpmLimit = 100;
    first.llm.totalDecisionEvaluations = 40;
    first.llm.batchCalls = 4;
    first.llm.batchRetryCount = 1;
    first.llm.batchPromptTokens = 320;
    first.llm.batchResponseTokens = 180;
    first.llm.totalChatDurationMs = 8_000;
    first.llm.nodeStats = [
      {
        nodeId: 'start',
        batchCalls: 2,
        singleCalls: 0,
        standardCalls: 2,
        reasoningCalls: 0,
        splitRetries: 1,
        cloneDecisions: 20,
        totalDurationMs: 3_600,
        totalModelDurationMs: 3_600,
        totalLocalStepDurationMs: 700,
        totalBatchWaitMs: 80,
        totalBatchSize: 20,
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
    second.decisionConcurrency = 16;
    second.cloneConcurrency = 10;
    second.activeFrontier = 100;
    second.peakActiveFrontier = 100;
    second.peakWaitingDecisions = 21;
    second.localStepDurationMs = 2_100;
    second.decisionBatchSize = 20;
    second.decisionBatchFlushMs = 40;
    second.llmRpmLimit = 100;
    second.llm.totalDecisionEvaluations = 44;
    second.llm.batchCalls = 4;
    second.llm.splitBatchCount = 2;
    second.llm.singleFallbackFromBatchCount = 1;
    second.llm.singlePromptTokens = 90;
    second.llm.singleResponseTokens = 40;
    second.llm.totalChatDurationMs = 7_600;
    second.llm.nodeStats = [
      {
        nodeId: 'start',
        batchCalls: 2,
        singleCalls: 0,
        standardCalls: 2,
        reasoningCalls: 0,
        splitRetries: 0,
        cloneDecisions: 20,
        totalDurationMs: 3_200,
        totalModelDurationMs: 3_200,
        totalLocalStepDurationMs: 650,
        totalBatchWaitMs: 90,
        totalBatchSize: 20,
        maxBatchSize: 10,
      },
      {
        nodeId: 'final_tradeoff',
        batchCalls: 2,
        singleCalls: 1,
        standardCalls: 1,
        reasoningCalls: 2,
        splitRetries: 2,
        cloneDecisions: 24,
        totalDurationMs: 4_100,
        totalModelDurationMs: 4_100,
        totalLocalStepDurationMs: 900,
        totalBatchWaitMs: 120,
        totalBatchSize: 24,
        maxBatchSize: 10,
      },
    ];
    second.rateLimiter.totalWaitMs = 1_500;

    const merged = mergeSimulationRuntimeTelemetry([first, second]);

    expect(merged.executionDurationMs).toBe(22_000);
    expect(merged.persistenceDurationMs).toBe(2_400);
    expect(merged.cloneCount).toBe(200);
    expect(merged.decisionConcurrency).toBe(16);
    expect(merged.activeFrontier).toBe(100);
    expect(merged.peakActiveFrontier).toBe(100);
    expect(merged.peakWaitingDecisions).toBe(21);
    expect(merged.localStepDurationMs).toBe(3_700);
    expect(merged.llm.totalDecisionEvaluations).toBe(84);
    expect(merged.llm.batchCalls).toBe(8);
    expect(merged.llm.batchRetryCount).toBe(1);
    expect(merged.llm.splitBatchCount).toBe(2);
    expect(merged.llm.singleFallbackFromBatchCount).toBe(1);
    expect(merged.llm.batchPromptTokens).toBe(320);
    expect(merged.llm.singlePromptTokens).toBe(90);
    expect(merged.rateLimiter.totalWaitMs).toBe(3_500);
    expect(merged.llm.nodeStats[0]).toMatchObject({
      nodeId: 'start',
      cloneDecisions: 40,
      batchCalls: 4,
      totalDurationMs: 6_800,
      splitRetries: 1,
    });
    expect(merged.llm.nodeStats[1]).toMatchObject({
      nodeId: 'final_tradeoff',
      cloneDecisions: 24,
      batchCalls: 2,
      splitRetries: 2,
    });
  });
});
