// Monte Carlo Simulation Engine - Phase 4
// Central export point for simulation modules

export * from './types.js';
export * from './decisionGraph.js';
export * from './forkEvaluator.js';
export * from './chaosInjector.js';
export * from './engine.js';
export * from './resultAggregator.js';
export * from './narrativeGenerator.js';
export * from './kellyCalculator.js';
export * from './baseRateRegistry.js';
export * from './scenarioCompiler.js';
export * from './experimentPlanner.js';
export * from './causalModel.js';

// World Agents
export * from './worldAgents/base.js';
export * from './worldAgents/financial.js';
export * from './worldAgents/career.js';
export * from './worldAgents/education.js';
export * from './worldAgents/social.js';

// Re-export key types and functions for convenience
export { 
  SimulationEngine,
  createEngine,
  simulateClone,
  simulateBatch,
} from './engine.js';

export {
  forkEvaluator,
  createForkEvaluator,
  evaluateDecision,
} from './forkEvaluator.js';

export {
  chaosInjector,
  createChaosInjector,
  checkForChaos,
} from './chaosInjector.js';

export {
  ResultAggregator,
  createAggregator,
  aggregateBatch,
} from './resultAggregator.js';

export {
  getScenario,
  buildDecisionGraph,
  getInitialState,
  getAllScenarios,
  isValidScenario,
} from './decisionGraph.js';
