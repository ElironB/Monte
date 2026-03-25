// Core simulation types for Monte Engine
// Phase 4: Simulation Engine

import type { CloneParameters } from '../persona/cloneGenerator.js';
import type { KellyOutput } from './kellyCalculator.js';

// Re-export CloneParameters for convenience
export type { CloneParameters } from '../persona/cloneGenerator.js';

// Node types for decision graphs
export interface DecisionNode {
  id: string;
  type: 'decision';
  prompt: string;
  options: DecisionOption[];
  context?: Record<string, unknown>;
}

export interface DecisionOption {
  id: string;
  label: string;
  value: string;
  nextNodeId: string;
  requiresEvaluation?: boolean; // If true, LLM evaluates clone choice
}

export interface EventNode {
  id: string;
  type: 'event';
  name: string;
  description: string;
  probability: number; // 0-1 base probability
  probabilityModifiers?: ProbabilityModifier[];
  outcomes: EventOutcome[];
}

export interface EventOutcome {
  id: string;
  label: string;
  effects: OutcomeEffect[];
  nextNodeId: string;
}

export interface OutcomeEffect {
  target: string; // e.g., 'capital', 'health', 'happiness'
  delta: number; // positive or negative change
  type: 'absolute' | 'percentage';
}

export interface ProbabilityModifier {
  condition: string; // e.g., 'riskTolerance > 0.7'
  factor: number; // multiplicative factor
}

export interface OutcomeNode {
  id: string;
  type: 'outcome';
  results: Record<string, number | string | boolean>;
}

export interface SimulationResults {
  [metric: string]: number | string | boolean; // e.g., capital: 50000, health: 0.8, outcome: 'success'
}

export type GraphNode = DecisionNode | EventNode | OutcomeNode;

export interface DecisionFrame {
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
}

export interface BeliefState {
  thesisConfidence: number;
  uncertaintyLevel: number;
  evidenceClarity: number;
  reversibilityConfidence: number;
  commitmentLockIn: number;
  socialPressureLoad: number;
  downsideSalience: number;
  learningVelocity: number;
  latestSignal: 'positive' | 'mixed' | 'negative' | 'neutral';
  updateNarrative: string;
}

export interface CausalState {
  demandStrength: number;
  executionCapacity: number;
  runwayStress: number;
  marketTailwind: number;
  socialLegitimacy: number;
  reversibilityPressure: number;
  evidenceMomentum: number;
}

export interface ExperimentRecommendation {
  priority: 'highest' | 'high' | 'medium';
  focusMetric: string;
  uncertainty: string;
  whyItMatters: string;
  recommendedExperiment: string;
  successSignal: string;
  stopSignal: string;
  learningValue: number;
  causalTargets: Array<keyof CausalState>;
  beliefTargets: Array<
    'thesisConfidence'
    | 'uncertaintyLevel'
    | 'evidenceClarity'
    | 'reversibilityConfidence'
    | 'commitmentLockIn'
    | 'socialPressureLoad'
    | 'downsideSalience'
    | 'learningVelocity'
  >;
}

export interface DecisionIntelligence {
  summary: string;
  dominantUncertainties: string[];
  recommendedExperiments: ExperimentRecommendation[];
}

export type EvidenceResultStatus = 'positive' | 'negative' | 'mixed' | 'inconclusive';

export interface EvidenceResult {
  id: string;
  uncertainty: string;
  focusMetric: string;
  recommendationIndex?: number;
  recommendedExperiment: string;
  result: EvidenceResultStatus;
  confidence: number;
  observedSignal: string;
  notes?: string;
  createdAt: string;
  causalTargets: Array<keyof CausalState>;
  beliefTargets: ExperimentRecommendation['beliefTargets'];
  causalAdjustments: Partial<Record<keyof CausalState, number>>;
  beliefAdjustments: Partial<Record<ExperimentRecommendation['beliefTargets'][number], number>>;
}

export interface RerunComparison {
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
}

// Scenario definition
export interface Scenario {
  id: string;
  name: string;
  description: string;
  timeframe: string; // e.g., '12-24 months'
  initialState: SimulationState;
  graph: GraphNode[];
  entryNodeId: string;
  decisionFrame?: DecisionFrame;
}

// Simulation state during execution
export interface SimulationState {
  capital: number; // Starting capital / financial resources
  health: number; // 0-1 health score
  happiness: number; // 0-1 happiness score
  timeElapsed: number; // months
  decisions: DecisionRecord[];
  events: EventRecord[];
  metrics: Record<string, number>; // Scenario-specific metrics
  beliefState: BeliefState;
  causalState: CausalState;
  outcome?: string; // Optional outcome classification
}

export interface DecisionRecord {
  nodeId: string;
  choice: string;
  timestamp: number;
  evaluatedByLLM: boolean;
  reasoning?: string;
  confidence?: number;
}

export interface EventRecord {
  nodeId: string;
  occurred: boolean;
  outcomeId?: string;
  timestamp: number;
  source?: 'graph' | 'world' | 'chaos';
  description?: string;
}

// Clone execution context
export interface CloneExecutionContext {
  cloneId: string;
  parameters: CloneParameters;
  scenario: Scenario;
  state: SimulationState;
  currentNodeId: string;
  path: string[]; // Node IDs visited
  complete: boolean;
  results?: SimulationResults;
}

// World agent interface
export interface WorldAgent {
  type: string;
  evaluate(context: CloneExecutionContext): WorldEvent | null;
  getMarketConditions?(): MarketConditions;
}

export interface WorldEvent {
  type: string;
  description: string;
  impact: OutcomeEffect[];
  probability: number;
}

export interface MarketConditions {
  volatility: number; // 0-1
  trend: 'bull' | 'bear' | 'neutral';
  inflationRate: number; // annual percentage
}

// LLM evaluation result
export interface LLMEvaluation {
  chosenOptionId: string;
  reasoning: string;
  confidence: number; // 0-1
  complexity: number; // 0-1 complexity score for routing
}

// Fork evaluation request
export interface ForkEvaluationRequest {
  cloneParams: CloneParameters;
  decisionNode: DecisionNode;
  state: SimulationState;
  scenario: Scenario;
  /** Optional — used by ForkEvaluator to inject psychology risk flags into the LLM prompt */
  masterPersona?: import('../persona/personaCompressor.js').MasterPersona;
}

// Chaos event
export interface ChaosEvent {
  id: string;
  type: 'medical' | 'market_crash' | 'job_loss' | 'relationship' | 'natural_disaster';
  name: string;
  description: string;
  baseProbability: number; // Very low, e.g., 0.001 - 0.05
  impact: OutcomeEffect[];
  conditions?: string[]; // Optional conditions for eligibility
}

// Simulation batch result
export interface BatchResult {
  batchIndex: number;
  cloneResults: CloneResult[];
  completedAt: string;
}

export interface CloneResult {
  cloneId: string;
  parameters: CloneParameters;
  stratification: {
    percentile: number;
    category: 'edge' | 'central' | 'typical';
  };
  path: string[];
  finalState: SimulationState;
  metrics: Record<string, number>;
  duration: number; // ms
}

export type SimulationGraphMode = 'live' | 'completed';
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
  mode: SimulationGraphMode;
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

export interface SimulationNodeRuntimeTelemetry {
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
}

export interface SimulationLlmRuntimeTelemetry {
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
  nodeStats: SimulationNodeRuntimeTelemetry[];
}

export interface SimulationEmbeddingRuntimeTelemetry {
  calls: number;
  batchCalls: number;
  totalTexts: number;
  totalDurationMs: number;
}

export interface SimulationRateLimiterTelemetry {
  acquireCalls: number;
  immediateGrants: number;
  queuedAcquires: number;
  totalWaitMs: number;
  maxWaitMs: number;
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
  llm: SimulationLlmRuntimeTelemetry;
  embeddings: SimulationEmbeddingRuntimeTelemetry;
  rateLimiter: SimulationRateLimiterTelemetry;
}

// Narrative result — defined here (not in narrativeGenerator.ts) to avoid circular imports
export interface NarrativeResult {
  executiveSummary: string;
  outcomeAnalysis: string;
  behavioralDrivers: string;
  riskFactors: string;
  contradictionInsights: string;
  recommendation: string;
}

// Aggregated simulation results
export interface AggregatedResults {
  scenarioId: string;
  cloneCount: number;
  histograms: Histogram[];
  outcomeDistribution: OutcomeDistribution;
  timeline: TimelineData;
  statistics: SimulationStatistics;
  stratifiedBreakdown: StratifiedBreakdown;
  decisionFrame?: DecisionFrame;
  decisionIntelligence?: DecisionIntelligence;
  appliedEvidence?: EvidenceResult[];
  rerunComparison?: RerunComparison;
  narrative?: NarrativeResult;
  kelly?: KellyOutput;
  runtimeTelemetry?: SimulationRuntimeTelemetry;
}

export interface Histogram {
  metric: string;
  bins: Bin[];
  mean: number;
  median: number;
  stdDev: number;
  p5: number;
  p95: number;
}

export interface Bin {
  min: number;
  max: number;
  count: number;
  frequency: number;
}

export interface OutcomeDistribution {
  success: number; // 0-1 proportion achieving positive outcome
  failure: number;
  neutral: number;
  byCategory: {
    edge: { success: number; failure: number; neutral: number };
    typical: { success: number; failure: number; neutral: number };
    central: { success: number; failure: number; neutral: number };
  };
}

export interface TimelineData {
  months: number[];
  metrics: Record<string, number[]>; // metric name -> values per month
}

export interface SimulationStatistics {
  meanCapital: number;
  medianCapital: number;
  meanHealth: number;
  meanHappiness: number;
  successRate: number;
  averageDuration: number; // months
}

export interface StratifiedBreakdown {
  edge: { count: number; avgOutcome: number };
  typical: { count: number; avgOutcome: number };
  central: { count: number; avgOutcome: number };
}

// Scenario types enum
export enum ScenarioType {
  DAY_TRADING = 'day_trading',
  STARTUP_FOUNDING = 'startup_founding',
  CAREER_CHANGE = 'career_change',
  ADVANCED_DEGREE = 'advanced_degree',
  GEOGRAPHIC_RELOCATION = 'geographic_relocation',
  REAL_ESTATE_PURCHASE = 'real_estate_purchase',
  HEALTH_FITNESS_GOAL = 'health_fitness_goal',
  CUSTOM = 'custom',
}
