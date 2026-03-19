// Core simulation types for Monte Engine
// Phase 4: Simulation Engine

import type { CloneParameters } from '../persona/cloneGenerator.js';
import type { NarrativeResult } from './narrativeGenerator.js';
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

// Scenario definition
export interface Scenario {
  id: string;
  name: string;
  description: string;
  timeframe: string; // e.g., '12-24 months'
  initialState: SimulationState;
  graph: GraphNode[];
  entryNodeId: string;
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
  outcome?: string; // Optional outcome classification
}

export interface DecisionRecord {
  nodeId: string;
  choice: string;
  timestamp: number;
  evaluatedByLLM: boolean;
}

export interface EventRecord {
  nodeId: string;
  occurred: boolean;
  outcomeId?: string;
  timestamp: number;
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

// Aggregated simulation results
export interface AggregatedResults {
  scenarioId: string;
  cloneCount: number;
  histograms: Histogram[];
  outcomeDistribution: OutcomeDistribution;
  timeline: TimelineData;
  statistics: SimulationStatistics;
  stratifiedBreakdown: StratifiedBreakdown;
  narrative?: NarrativeResult;
  kelly?: KellyOutput;
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
