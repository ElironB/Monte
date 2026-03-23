import type {
  SimulationEmbeddingRuntimeTelemetry,
  SimulationLlmRuntimeTelemetry,
  SimulationNodeRuntimeTelemetry,
  SimulationRateLimiterTelemetry,
  SimulationRuntimeTelemetry,
} from './types.js';

type MutableNodeMap = Map<string, SimulationNodeRuntimeTelemetry>;

export function createEmptyNodeTelemetry(nodeId: string): SimulationNodeRuntimeTelemetry {
  return {
    nodeId,
    batchCalls: 0,
    singleCalls: 0,
    standardCalls: 0,
    reasoningCalls: 0,
    splitRetries: 0,
    cloneDecisions: 0,
    totalDurationMs: 0,
    totalModelDurationMs: 0,
    totalLocalStepDurationMs: 0,
    totalBatchWaitMs: 0,
    totalBatchSize: 0,
    maxBatchSize: 0,
  };
}

export function createEmptyLlmTelemetry(): SimulationLlmRuntimeTelemetry {
  return {
    totalDecisionEvaluations: 0,
    batchCalls: 0,
    singleCalls: 0,
    standardCalls: 0,
    reasoningCalls: 0,
    batchRetryCount: 0,
    splitBatchCount: 0,
    singleFallbackFromBatchCount: 0,
    invalidBatchPayloadCount: 0,
    batchParseFailureCount: 0,
    repairCalls: 0,
    fallbackHeuristicCount: 0,
    rateLimitErrors: 0,
    rateLimitRetries: 0,
    totalTokens: 0,
    batchPromptTokens: 0,
    batchResponseTokens: 0,
    singlePromptTokens: 0,
    singleResponseTokens: 0,
    totalChatDurationMs: 0,
    totalRepairDurationMs: 0,
    totalBatchWaitMs: 0,
    maxBatchSize: 0,
    nodeStats: [],
  };
}

export function createEmptyEmbeddingTelemetry(): SimulationEmbeddingRuntimeTelemetry {
  return {
    calls: 0,
    batchCalls: 0,
    totalTexts: 0,
    totalDurationMs: 0,
  };
}

export function createEmptyRateLimiterTelemetry(): SimulationRateLimiterTelemetry {
  return {
    acquireCalls: 0,
    immediateGrants: 0,
    queuedAcquires: 0,
    totalWaitMs: 0,
    maxWaitMs: 0,
  };
}

export function createEmptySimulationRuntimeTelemetry(): SimulationRuntimeTelemetry {
  return {
    wallClockDurationMs: 0,
    executionDurationMs: 0,
    executionMaxBatchDurationMs: 0,
    persistenceDurationMs: 0,
    persistenceMaxBatchDurationMs: 0,
    aggregationDurationMs: 0,
    cloneCount: 0,
    batchCount: 0,
    decisionConcurrency: 0,
    cloneConcurrency: 0,
    activeFrontier: 0,
    peakActiveFrontier: 0,
    peakWaitingDecisions: 0,
    localStepDurationMs: 0,
    decisionBatchSize: 0,
    decisionBatchFlushMs: 0,
    llmRpmLimit: 0,
    llm: createEmptyLlmTelemetry(),
    embeddings: createEmptyEmbeddingTelemetry(),
    rateLimiter: createEmptyRateLimiterTelemetry(),
  };
}

function mergeNodeTelemetry(target: MutableNodeMap, source: SimulationNodeRuntimeTelemetry): void {
  const current = target.get(source.nodeId) ?? createEmptyNodeTelemetry(source.nodeId);
  current.batchCalls += source.batchCalls;
  current.singleCalls += source.singleCalls;
  current.standardCalls += source.standardCalls;
  current.reasoningCalls += source.reasoningCalls;
  current.splitRetries += source.splitRetries;
  current.cloneDecisions += source.cloneDecisions;
  current.totalDurationMs += source.totalDurationMs;
  current.totalModelDurationMs += source.totalModelDurationMs;
  current.totalLocalStepDurationMs += source.totalLocalStepDurationMs;
  current.totalBatchWaitMs += source.totalBatchWaitMs;
  current.totalBatchSize += source.totalBatchSize;
  current.maxBatchSize = Math.max(current.maxBatchSize, source.maxBatchSize);
  target.set(source.nodeId, current);
}

export function mergeSimulationRuntimeTelemetry(
  items: Array<SimulationRuntimeTelemetry | null | undefined>,
): SimulationRuntimeTelemetry {
  const merged = createEmptySimulationRuntimeTelemetry();
  const nodeStats: MutableNodeMap = new Map();

  for (const item of items) {
    if (!item) {
      continue;
    }

    merged.wallClockDurationMs = Math.max(merged.wallClockDurationMs, item.wallClockDurationMs);
    merged.executionDurationMs += item.executionDurationMs;
    merged.executionMaxBatchDurationMs = Math.max(
      merged.executionMaxBatchDurationMs,
      item.executionMaxBatchDurationMs,
    );
    merged.persistenceDurationMs += item.persistenceDurationMs;
    merged.persistenceMaxBatchDurationMs = Math.max(
      merged.persistenceMaxBatchDurationMs,
      item.persistenceMaxBatchDurationMs,
    );
    merged.aggregationDurationMs = Math.max(merged.aggregationDurationMs, item.aggregationDurationMs);
    merged.cloneCount += item.cloneCount;
    merged.batchCount += item.batchCount;
    merged.decisionConcurrency = Math.max(merged.decisionConcurrency, item.decisionConcurrency);
    merged.cloneConcurrency = Math.max(merged.cloneConcurrency, item.cloneConcurrency);
    merged.activeFrontier = Math.max(merged.activeFrontier, item.activeFrontier);
    merged.peakActiveFrontier = Math.max(merged.peakActiveFrontier, item.peakActiveFrontier);
    merged.peakWaitingDecisions = Math.max(merged.peakWaitingDecisions, item.peakWaitingDecisions);
    merged.localStepDurationMs += item.localStepDurationMs;
    merged.decisionBatchSize = Math.max(merged.decisionBatchSize, item.decisionBatchSize);
    merged.decisionBatchFlushMs = Math.max(merged.decisionBatchFlushMs, item.decisionBatchFlushMs);
    merged.llmRpmLimit = Math.max(merged.llmRpmLimit, item.llmRpmLimit);

    merged.llm.totalDecisionEvaluations += item.llm.totalDecisionEvaluations;
    merged.llm.batchCalls += item.llm.batchCalls;
    merged.llm.singleCalls += item.llm.singleCalls;
    merged.llm.standardCalls += item.llm.standardCalls;
    merged.llm.reasoningCalls += item.llm.reasoningCalls;
    merged.llm.batchRetryCount += item.llm.batchRetryCount;
    merged.llm.splitBatchCount += item.llm.splitBatchCount;
    merged.llm.singleFallbackFromBatchCount += item.llm.singleFallbackFromBatchCount;
    merged.llm.invalidBatchPayloadCount += item.llm.invalidBatchPayloadCount;
    merged.llm.batchParseFailureCount += item.llm.batchParseFailureCount;
    merged.llm.repairCalls += item.llm.repairCalls;
    merged.llm.fallbackHeuristicCount += item.llm.fallbackHeuristicCount;
    merged.llm.rateLimitErrors += item.llm.rateLimitErrors;
    merged.llm.rateLimitRetries += item.llm.rateLimitRetries;
    merged.llm.totalTokens += item.llm.totalTokens;
    merged.llm.batchPromptTokens += item.llm.batchPromptTokens;
    merged.llm.batchResponseTokens += item.llm.batchResponseTokens;
    merged.llm.singlePromptTokens += item.llm.singlePromptTokens;
    merged.llm.singleResponseTokens += item.llm.singleResponseTokens;
    merged.llm.totalChatDurationMs += item.llm.totalChatDurationMs;
    merged.llm.totalRepairDurationMs += item.llm.totalRepairDurationMs;
    merged.llm.totalBatchWaitMs += item.llm.totalBatchWaitMs;
    merged.llm.maxBatchSize = Math.max(merged.llm.maxBatchSize, item.llm.maxBatchSize);
    for (const nodeStat of item.llm.nodeStats) {
      mergeNodeTelemetry(nodeStats, nodeStat);
    }

    merged.embeddings.calls += item.embeddings.calls;
    merged.embeddings.batchCalls += item.embeddings.batchCalls;
    merged.embeddings.totalTexts += item.embeddings.totalTexts;
    merged.embeddings.totalDurationMs += item.embeddings.totalDurationMs;

    merged.rateLimiter.acquireCalls += item.rateLimiter.acquireCalls;
    merged.rateLimiter.immediateGrants += item.rateLimiter.immediateGrants;
    merged.rateLimiter.queuedAcquires += item.rateLimiter.queuedAcquires;
    merged.rateLimiter.totalWaitMs += item.rateLimiter.totalWaitMs;
    merged.rateLimiter.maxWaitMs = Math.max(
      merged.rateLimiter.maxWaitMs,
      item.rateLimiter.maxWaitMs,
    );
  }

  merged.llm.nodeStats = Array.from(nodeStats.values()).sort((left, right) =>
    right.totalDurationMs - left.totalDurationMs,
  );

  return merged;
}
