export type PersonaSummary =
  | {
      id: string;
      version: number;
      buildStatus: string;
      traitCount: number;
      memoryCount: number;
      createdAt: string;
      lastError?: string | null;
    }
  | {
      status: 'none';
      message: string;
    };

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  personaStatus: string;
}

export interface PersonaHistoryItem {
  id: string;
  version: number;
  buildStatus: string;
  createdAt: string;
  lastError?: string | null;
}

export interface PersonaTrait {
  id: string;
  type: string;
  name: string;
  value: number;
  confidence: number;
}

export interface PsychologicalProfile {
  bigFive: {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
    confidence: number;
    dominantTrait: string;
    deficitTrait: string;
  };
  attachment: {
    style: string;
    confidence: number;
    anxietyAxis: number;
    avoidanceAxis: number;
    primarySignals: string[];
  };
  locusOfControl: {
    type: string;
    score: number;
    confidence: number;
    implication: string;
  };
  temporalDiscounting: {
    discountingRate: string;
    score: number;
    confidence: number;
    presentBiasStrength: number;
    mechanismDescription: string;
  };
  riskFlags: Array<{
    flag: string;
    severity: 'low' | 'medium' | 'high';
    description: string;
    affectedScenarios: string[];
  }>;
  narrativeSummary: string;
  technicalSummary: string;
}

export interface SimulationListItem {
  id: string;
  name: string;
  title?: string;
  primaryQuestion?: string;
  scenarioType: string;
  status: string;
  progress: number;
  cloneCount: number;
  createdAt: string;
}

export interface SimulationListResponse {
  data: SimulationListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  timeframe: string;
  description: string;
}

export interface HistogramBin {
  min: number;
  max: number;
  count: number;
  frequency: number;
}

export interface HistogramEntry {
  metric: string;
  bins: HistogramBin[];
  mean: number;
  median: number;
  stdDev: number;
  p5: number;
  p95: number;
}

export interface SimulationRuntimeTelemetry {
  wallClockDurationMs: number;
  executionDurationMs: number;
  executionMaxBatchDurationMs: number;
  persistenceDurationMs: number;
  persistenceMaxBatchDurationMs: number;
  aggregationDurationMs: number;
  cloneCount: number;
  batchCount: number;
  decisionConcurrency: number;
  cloneConcurrency: number;
  activeFrontier: number;
  peakActiveFrontier: number;
  peakWaitingDecisions: number;
  localStepDurationMs: number;
  decisionBatchSize: number;
  decisionBatchFlushMs: number;
  llmRpmLimit: number;
  llm: {
    totalDecisionEvaluations: number;
    batchCalls: number;
    singleCalls: number;
    standardCalls: number;
    reasoningCalls: number;
    batchRetryCount: number;
    splitBatchCount: number;
    singleFallbackFromBatchCount: number;
    invalidBatchPayloadCount: number;
    batchParseFailureCount: number;
    repairCalls: number;
    fallbackHeuristicCount: number;
    rateLimitErrors: number;
    rateLimitRetries: number;
    totalTokens: number;
    batchPromptTokens: number;
    batchResponseTokens: number;
    singlePromptTokens: number;
    singleResponseTokens: number;
    totalChatDurationMs: number;
    totalRepairDurationMs: number;
    totalBatchWaitMs: number;
    maxBatchSize: number;
    nodeStats: Array<{
      nodeId: string;
      batchCalls: number;
      singleCalls: number;
      standardCalls: number;
      reasoningCalls: number;
      splitRetries: number;
      cloneDecisions: number;
      totalDurationMs: number;
      totalModelDurationMs: number;
      totalLocalStepDurationMs: number;
      totalBatchWaitMs: number;
      totalBatchSize: number;
      maxBatchSize: number;
    }>;
  };
}

export interface AggregatedResults {
  scenarioId: string;
  cloneCount: number;
  decisionFrame?: {
    title: string;
    primaryQuestion: string;
    contextSummary: string;
    timeframeMonths: number;
    capitalAtRisk: number;
    runwayMonths: number;
    fallbackPlan: string;
    reversibilityScore: number;
    socialExposure: number;
    uncertaintyLoad: number;
    downsideSeverity: number;
    keyUnknowns: string[];
  };
  histograms: HistogramEntry[];
  outcomeDistribution: {
    success: number;
    failure: number;
    neutral: number;
    byCategory: {
      edge: { success: number; failure: number; neutral: number };
      typical: { success: number; failure: number; neutral: number };
      central: { success: number; failure: number; neutral: number };
    };
  };
  timeline: {
    months: number[];
    metrics: Record<string, number[]>;
  };
  statistics: {
    meanCapital: number;
    medianCapital: number;
    meanHealth: number;
    meanHappiness: number;
    successRate: number;
    averageDuration: number;
  };
  stratifiedBreakdown: {
    edge: { count: number; avgOutcome: number };
    typical: { count: number; avgOutcome: number };
    central: { count: number; avgOutcome: number };
  };
  decisionIntelligence?: {
    summary: string;
    dominantUncertainties: string[];
    recommendedExperiments: Array<{
      priority: 'highest' | 'high' | 'medium';
      focusMetric: string;
      uncertainty: string;
      whyItMatters: string;
      recommendedExperiment: string;
      successSignal: string;
      stopSignal: string;
      learningValue: number;
      causalTargets: string[];
      beliefTargets: string[];
    }>;
  };
  appliedEvidence?: Array<{
    id: string;
    uncertainty: string;
    focusMetric: string;
    recommendationIndex?: number;
    recommendedExperiment: string;
    result: 'positive' | 'negative' | 'mixed' | 'inconclusive';
    confidence: number;
    observedSignal: string;
    notes?: string;
    createdAt: string;
  }>;
  rerunComparison?: {
    sourceSimulationId: string;
    evidenceCount: number;
    summary: string;
    beliefDelta: {
      thesisConfidence: number;
      uncertaintyLevel: number;
      downsideSalience: number;
    };
    recommendationDelta: {
      changed: boolean;
      previousTopUncertainty?: string;
      newTopUncertainty?: string;
      previousTopExperiment?: string;
      newTopExperiment?: string;
    };
  };
  narrative?: {
    executiveSummary: string;
    outcomeAnalysis: string;
    behavioralDrivers: string;
    riskFactors: string;
    contradictionInsights: string;
    recommendation: string;
  };
  kelly?: {
    successProbability: number;
    netOddsRatio: number;
    fullKellyPercentage: number;
    adjustedKellyPercentage: number;
    optimalCommitmentAmount: number;
    rationale: string;
    warning?: string;
  };
  runtimeTelemetry?: SimulationRuntimeTelemetry;
}

export interface SimulationDetail {
  id: string;
  name: string;
  title?: string;
  primaryQuestion?: string;
  scenarioType: string;
  status: string;
  progress: number;
  parameters: Record<string, unknown>;
  cloneCount: number;
  results: AggregatedResults | null;
}

export interface SimulationResultsEnvelope {
  status: string;
  distributions: AggregatedResults | null;
}

export interface SimulationProgress {
  simulationId: string;
  status: string;
  phase: string;
  phaseProgress?: number;
  aggregationStage?: string;
  progress: number;
  completedBatches: number;
  totalBatches: number;
  cloneCount: number;
  processedClones?: number;
  error?: string;
  currentBatch?: number;
  batchProcessedClones?: number;
  batchCloneCount?: number;
  estimatedTimeRemaining?: number;
  activeFrontier?: number;
  waitingDecisions?: number;
  resolvedDecisions?: number;
  estimatedDecisionCount?: number;
  localStepDurationMs?: number;
  lastUpdated?: string;
}

export interface SimulationCreateInput {
  scenarioType: string;
  name: string;
  parameters?: Record<string, unknown>;
  cloneCount: number;
  capitalAtRisk?: number;
}

export type SimulationGraphNodeType = 'decision' | 'event' | 'outcome';
export type SimulationGraphEdgeKind = 'decision' | 'event';
export type SimulationGraphOutcome = 'success' | 'failure' | 'neutral';

export interface SimulationGraphNode {
  id: string;
  type: SimulationGraphNodeType;
  label: string;
  detail: string;
}

export interface SimulationGraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: SimulationGraphEdgeKind;
  branchId: string;
  label: string;
}

export interface SimulationGraphNodeStats {
  nodeId: string;
  visitCount: number;
  activeCount: number;
  waitingCount: number;
  completedCount: number;
  successCount: number;
  failureCount: number;
  neutralCount: number;
}

export interface SimulationGraphEdgeStats {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  transitionCount: number;
}

export interface SimulationGraphTraceSample {
  cloneId: string;
  category: 'edge' | 'central' | 'typical';
  status: 'active' | 'completed';
  currentNodeId?: string;
  pathNodeIds: string[];
  outcome?: SimulationGraphOutcome;
}

export interface SimulationGraphSnapshot {
  mode: 'live' | 'completed';
  cloneCount: number;
  completedClones: number;
  activeClones: number;
  waitingClones: number;
  sampledTraceLimit: number;
  nodes: SimulationGraphNodeStats[];
  edges: SimulationGraphEdgeStats[];
  sampledTraces: SimulationGraphTraceSample[];
  lastUpdated?: string;
}

export interface SimulationGraphEnvelope {
  simulationId: string;
  name: string;
  title: string;
  primaryQuestion: string;
  status: string;
  scenarioType: string;
  entryNodeId: string;
  nodes: SimulationGraphNode[];
  edges: SimulationGraphEdge[];
  snapshot: SimulationGraphSnapshot | null;
}

export interface DataSourceListItem {
  id: string;
  sourceType: string;
  name: string;
  status: string;
  signalCount: number;
  createdAt: string;
}

export interface DataSourceListResponse {
  data: DataSourceListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface DataSourceDetail {
  id: string;
  sourceType: string;
  name: string;
  status: string;
  progress: number;
  signalCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  completedAt?: string;
  signals: Array<{
    id: string;
    type: string;
    value: string;
    confidence: number;
    evidence: string;
  }>;
}
