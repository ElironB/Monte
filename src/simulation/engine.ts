// Monte Carlo Simulation Engine
// Executes clones through decision graphs with world agents and chaos injection

import { 
  CloneParameters,
  Scenario,
  SimulationState,
  DecisionNode,
  EventNode,
  OutcomeNode,
  GraphNode,
  CloneExecutionContext,
  CloneResult,
  LLMEvaluation,
} from './types.js';
import { 
  findNode, 
  isTerminalNode, 
  categorizeOutcome,
} from './decisionGraph.js';
import {
  applyEffectsToState,
  applyOutcomeNodeResults,
  cloneSimulationState,
  refreshBeliefState,
} from './state.js';
import {
  applyDecisionCausalTransition,
  applyEventOutcomeCausalTransition,
  applyExternalCausalTransition,
  calculateEventProbability,
  selectEventOutcome,
} from './causalModel.js';
import { createForkEvaluator, type ForkEvaluator } from './forkEvaluator.js';
import { chaosInjector, createChaosInjector } from './chaosInjector.js';
import { FinancialWorldAgent } from './worldAgents/financial.js';
import { CareerWorldAgent } from './worldAgents/career.js';
import { EducationWorldAgent } from './worldAgents/education.js';
import { SocialWorldAgent } from './worldAgents/social.js';
import { logger } from '../utils/logger.js';
import { type RateLimiter } from '../utils/rateLimiter.js';
import { type MasterPersona } from '../persona/personaCompressor.js';
import { buildSimulationPersonaRuntimeProfile } from './personaRuntime.js';

interface WorldAgents {
  financial: FinancialWorldAgent;
  career: CareerWorldAgent;
  education: EducationWorldAgent;
  social: SocialWorldAgent;
}

interface SimulationConfig {
  useLLM: boolean;
  useChaos: boolean;
  maxLLMCalls: number;
  logDecisions: boolean;
  rateLimiter?: RateLimiter;
  /** Persona master data — supplies psychology risk flags and llmContextSummary to ForkEvaluator */
  masterPersona?: MasterPersona;
}

export class SimulationEngine {
  private scenario: Scenario;
  private config: SimulationConfig;
  private llmCallsUsed: number = 0;
  private evaluator: ForkEvaluator;
  private masterPersona?: MasterPersona;

  constructor(scenario: Scenario, config: Partial<SimulationConfig> = {}) {
    this.scenario = scenario;
    this.config = {
      useLLM: true,
      useChaos: true,
      maxLLMCalls: 20,
      logDecisions: false,
      ...config,
    };
    this.evaluator = createForkEvaluator({ rateLimiter: this.config.rateLimiter ?? null });
    this.masterPersona = config.masterPersona;
  }

  // Execute a single clone through the simulation
  async executeClone(
    cloneId: string,
    parameters: CloneParameters,
    stratification: { percentile: number; category: 'edge' | 'central' | 'typical' },
    startingState?: SimulationState
  ): Promise<CloneResult> {
    const startTime = Date.now();
    
    // Initialize world agents based on scenario type
    const worldAgents = this.initializeWorldAgents(parameters);
    
    // Initialize state
    const state: SimulationState = refreshBeliefState(
      cloneSimulationState(startingState ?? this.scenario.initialState),
    );
    
    // Create execution context
    const context: CloneExecutionContext = {
      cloneId,
      parameters,
      scenario: this.scenario,
      state,
      currentNodeId: this.scenario.entryNodeId,
      path: [],
      complete: false,
    };

    // Initialize chaos injector for this clone
    const chaos = this.config.useChaos ? createChaosInjector(true) : createChaosInjector(false);

    // Execute simulation loop
    let iterations = 0;
    const maxIterations = 100;

    while (!context.complete && iterations < maxIterations) {
      iterations++;
      
      // Get current node
      const currentNode = findNode(this.scenario.graph, context.currentNodeId);
      if (!currentNode) {
        logger.error({ nodeId: context.currentNodeId }, 'Node not found, ending simulation');
        break;
      }

      this.syncWorldAgentMetrics(context, worldAgents);

      // Add to path
      context.path.push(context.currentNodeId);

      // Execute node
      if (currentNode.type === 'decision') {
        await this.executeDecisionNode(context, currentNode as DecisionNode, worldAgents);
      } else if (currentNode.type === 'event') {
        this.executeEventNode(context, currentNode as EventNode, worldAgents);
      } else if (currentNode.type === 'outcome') {
        this.executeOutcomeNode(context, currentNode as OutcomeNode);
      }

      // Apply world agent effects
      this.applyWorldAgents(context, worldAgents);
      this.syncWorldAgentMetrics(context, worldAgents);

      // Check for chaos events
      if (this.config.useChaos) {
        const chaosResult = chaos.inject(context);
        if (chaosResult.occurred && chaosResult.event) {
          context.state = chaos.applyEvent(context.state, chaosResult.event);
          context.state.events.push({
            nodeId: `chaos:${chaosResult.event.id}`,
            occurred: true,
            outcomeId: chaosResult.event.id,
            timestamp: Date.now(),
            source: 'chaos',
            description: chaosResult.event.description,
          });
          
          if (this.config.logDecisions) {
            logger.debug({
              cloneId,
              event: chaosResult.event.id,
              probability: chaosResult.modifiedProbability,
            }, 'Chaos event applied');
          }
        }
      }

      // Advance time if needed (simplified - advance 1 month per decision)
      if (currentNode.type === 'decision') {
        context.state.timeElapsed += 1;
        
        // Advance world agents
        worldAgents.financial.advanceTime(1);
        worldAgents.career.advanceTime(1);
        worldAgents.education.advanceTime(1);
        worldAgents.social.advanceTime(1);
      }
    }

    const duration = Date.now() - startTime;
    const outcomeBucket = categorizeOutcome(context.state, this.scenario.id);

    // Create result
    const result: CloneResult = {
      cloneId,
      parameters,
      stratification,
      path: context.path,
      finalState: context.state,
      metrics: {
        ...context.state.metrics,
        outcomeValue: outcomeBucket === 'success' ? 1 : outcomeBucket === 'failure' ? 0 : 0.5,
        totalDecisions: context.state.decisions.length,
        totalEvents: context.state.events.length,
        finalCapital: context.state.capital,
        finalHealth: context.state.health,
        finalHappiness: context.state.happiness,
        beliefConfidence: context.state.beliefState.thesisConfidence,
        beliefUncertainty: context.state.beliefState.uncertaintyLevel,
        beliefEvidenceClarity: context.state.beliefState.evidenceClarity,
        beliefCommitmentLockIn: context.state.beliefState.commitmentLockIn,
        beliefDownsideSalience: context.state.beliefState.downsideSalience,
        demandStrength: context.state.causalState.demandStrength,
        executionCapacity: context.state.causalState.executionCapacity,
        runwayStress: context.state.causalState.runwayStress,
        marketTailwind: context.state.causalState.marketTailwind,
        socialLegitimacy: context.state.causalState.socialLegitimacy,
        reversibilityPressure: context.state.causalState.reversibilityPressure,
        evidenceMomentum: context.state.causalState.evidenceMomentum,
      },
      duration,
    };

    return result;
  }

  // Execute a decision node
  private async executeDecisionNode(
    context: CloneExecutionContext,
    node: DecisionNode,
    worldAgents: WorldAgents
  ): Promise<void> {
    let chosenOptionId: string;
    let evaluatedByLLM = false;
    let reasoning = 'Decision record unavailable.';
    let confidence = 0.6;

    // Check if LLM evaluation is needed
    const requiresEvaluation = node.options.some(o => o.requiresEvaluation) || 
                               this.config.useLLM;

    if (requiresEvaluation && this.config.useLLM) {
      try {
        const availableLLMCalls = this.config.maxLLMCalls - this.llmCallsUsed;
        
        const evaluation: LLMEvaluation = await this.evaluator.evaluateFork(
          {
            cloneParams: context.parameters,
            decisionNode: node,
            state: context.state,
            scenario: this.scenario,
            masterPersona: this.masterPersona,
          },
          availableLLMCalls
        );

        chosenOptionId = evaluation.chosenOptionId;
        evaluatedByLLM = true;
        reasoning = evaluation.reasoning;
        confidence = evaluation.confidence;

        if (evaluation.complexity > 0.6) {
          this.llmCallsUsed++;
        }

        if (this.config.logDecisions) {
          logger.debug({
            cloneId: context.cloneId,
            nodeId: node.id,
            chosenOption: chosenOptionId,
            complexity: evaluation.complexity,
            confidence: evaluation.confidence,
            reasoning: evaluation.reasoning,
          }, 'LLM decision');
        }
      } catch (error) {
        // Fall back to heuristic
        const heuristic = this.heuristicDecision(context, node);
        chosenOptionId = heuristic.chosenOptionId;
        reasoning = heuristic.reasoning;
        confidence = heuristic.confidence;
        evaluatedByLLM = false;
        
        logger.warn({
          cloneId: context.cloneId,
          nodeId: node.id,
          error: (error as Error).message,
        }, 'LLM evaluation failed, using heuristic');
      }
    } else {
      // Heuristic decision
      const heuristic = this.heuristicDecision(context, node);
      chosenOptionId = heuristic.chosenOptionId;
      reasoning = heuristic.reasoning;
      confidence = heuristic.confidence;
    }

    // Find chosen option
    const chosenOption = node.options.find(o => o.id === chosenOptionId);
    if (!chosenOption) {
      logger.error({ chosenOptionId, nodeId: node.id }, 'Chosen option not found');
      // Fall back to first option
      context.currentNodeId = node.options[0].nextNodeId;
    } else {
      context.currentNodeId = chosenOption.nextNodeId;
    }
    applyDecisionCausalTransition(context.state, this.scenario.id, node.id, chosenOptionId);

    // Record decision
    context.state.decisions.push({
      nodeId: node.id,
      choice: chosenOptionId,
      timestamp: Date.now(),
      evaluatedByLLM,
      reasoning,
      confidence,
    });
    context.state = refreshBeliefState(context.state);
    context.state.beliefState.updateNarrative = reasoning;
  }

  // Execute an event node
  private executeEventNode(
    context: CloneExecutionContext,
    node: EventNode,
    worldAgents: WorldAgents
  ): void {
    const probability = calculateEventProbability(context, node);
    const eventOccurred = Math.random() < probability;

    if (eventOccurred && node.outcomes.length > 0) {
      const outcome = selectEventOutcome(context.state, this.scenario.id, node);
      applyEventOutcomeCausalTransition(context.state, this.scenario.id, node.id, outcome.id);
      context.state = applyEffectsToState(context.state, outcome.effects);
      context.currentNodeId = outcome.nextNodeId;

      // Record event
      context.state.events.push({
        nodeId: node.id,
        occurred: true,
        outcomeId: outcome.id,
        timestamp: Date.now(),
        source: 'graph',
        description: outcome.label,
      });
    } else {
      if (node.outcomes.length === 1) {
        context.currentNodeId = node.outcomes[0].nextNodeId;
      } else {
        context.currentNodeId = node.outcomes[0]?.nextNodeId || context.currentNodeId;
      }

      context.state.events.push({
        nodeId: node.id,
        occurred: false,
        timestamp: Date.now(),
        source: 'graph',
        description: node.description,
      });
    }
  }

  // Execute an outcome node
  private executeOutcomeNode(
    context: CloneExecutionContext,
    node: OutcomeNode
  ): void {
    // Mark as complete
    context.complete = true;
    
    context.state = applyOutcomeNodeResults(context.state, node.results);
  }

  // Heuristic decision when LLM unavailable
  private heuristicDecision(
    context: CloneExecutionContext,
    node: DecisionNode,
  ): { chosenOptionId: string; reasoning: string; confidence: number } {
    const { parameters, state } = context;
    
    let bestOption = node.options[0];
    let bestScore = -Infinity;
    let secondBestScore = -Infinity;
    let bestReasons: string[] = [];

    for (const option of node.options) {
      let score = 0;
      const reasons: string[] = [];
      const label = option.label.toLowerCase();

      // Risk matching
      if (parameters.riskTolerance > 0.7) {
        if (label.includes('aggressive') || label.includes('bold') || 
            label.includes('all-in') || label.includes('high')) {
          score += 2;
          reasons.push('high risk tolerance matched a more aggressive branch');
        }
      } else if (parameters.riskTolerance < 0.3) {
        if (label.includes('safe') || label.includes('cautious') || 
            label.includes('preserve') || label.includes('low')) {
          score += 2;
          reasons.push('low risk tolerance favored preserving downside');
        }
      }

      // Decision speed
      if (parameters.decisionSpeed > 0.7) {
        if (label.includes('now') || label.includes('immediate') || 
            label.includes('start') || label.includes('quick')) {
          score += 1;
          reasons.push('fast decision speed favored immediate action');
        }
      } else if (parameters.decisionSpeed < 0.3) {
        if (label.includes('plan') || label.includes('analyze') || 
            label.includes('research') || label.includes('study')) {
          score += 1;
          reasons.push('deliberate decision speed favored more analysis');
        }
      }

      // Social dependency
      if (parameters.socialDependency > 0.7) {
        if (label.includes('partner') || label.includes('team') || 
            label.includes('network') || label.includes('collaborate')) {
          score += 1;
          reasons.push('social orientation favored collaborative support');
        }
      } else if (parameters.socialDependency < 0.3) {
        if (label.includes('independent') || label.includes('solo') || 
            label.includes('alone') || label.includes('self')) {
          score += 1;
          reasons.push('independent orientation favored self-directed options');
        }
      }

      // Time preference (patience)
      if (parameters.timePreference < 0.3) {
        if (label.includes('long') || label.includes('patient') || 
            label.includes('future') || label.includes('invest')) {
          score += 1;
          reasons.push('patient time preference favored longer-horizon payoff');
        }
      } else if (parameters.timePreference > 0.7) {
        if (label.includes('now') || label.includes('immediate') || 
            label.includes('quick') || label.includes('fast')) {
          score += 1;
          reasons.push('present bias favored faster payoff');
        }
      }

      // Emotional volatility (seek excitement or safety)
      if (parameters.emotionalVolatility > 0.7) {
        if (label.includes('exciting') || label.includes('passion') || 
            label.includes('dream') || label.includes('change')) {
          score += 1;
          reasons.push('emotional volatility leaned toward more charged options');
        }
      }

      // Learning style
      if (parameters.learningStyle > 0.7) {
        if (label.includes('learn') || label.includes('study') || 
            label.includes('degree') || label.includes('education')) {
          score += 1;
          reasons.push('theoretical learning style favored explicit learning paths');
        }
      } else if (parameters.learningStyle < 0.3) {
        if (label.includes('experience') || label.includes('practice') || 
            label.includes('do') || label.includes('try')) {
          score += 1;
          reasons.push('experiential learning style favored action-first paths');
        }
      }

      // State-based adjustments
      if (state.capital < 10000) {
        if (label.includes('quit') || label.includes('stop') || 
            label.includes('preserve') || label.includes('safe')) {
          score += 2; // Prefer exit when broke
          reasons.push('low capital pushed the clone toward preserving runway');
        }
        if (label.includes('double') || label.includes('risk') || 
            label.includes('aggressive')) {
          score -= 2; // Avoid more risk when broke
        }
      }

      if (state.health < 0.5) {
        if (label.includes('health') || label.includes('rest') || 
            label.includes('medical') || label.includes('recover')) {
          score += 2;
          reasons.push('poor health favored recovery over escalation');
        }
      }

      if (state.happiness < 0.3) {
        if (label.includes('happiness') || label.includes('joy') || 
            label.includes('fulfillment') || label.includes('passion')) {
          score += 1;
          reasons.push('low happiness increased the pull toward emotional relief');
        }
      }

      if (score > bestScore) {
        secondBestScore = bestScore;
        bestScore = score;
        bestOption = option;
        bestReasons = reasons;
      } else if (score > secondBestScore) {
        secondBestScore = score;
      }
    }

    const confidenceGap = Math.max(0, bestScore - secondBestScore);
    const confidence = Math.max(0.55, Math.min(0.82, 0.58 + (confidenceGap * 0.06)));
    const reasoning = bestReasons.length > 0
      ? `Heuristic favored this branch because ${bestReasons.slice(0, 2).join(' and ')}.`
      : 'Heuristic defaulted to the most behaviorally compatible option.';

    return {
      chosenOptionId: bestOption.id,
      reasoning,
      confidence,
    };
  }

  // Initialize world agents based on scenario type
  private initializeWorldAgents(parameters: CloneParameters): WorldAgents {
    const initialCapital = this.scenario.initialState.capital;
    const personaRuntime = buildSimulationPersonaRuntimeProfile(parameters, this.masterPersona);
    const salaryMetric = this.scenario.initialState.metrics.currentSalary;
    const salary = typeof salaryMetric === 'number' ? salaryMetric : 75000;
    const monthlySavings = Math.max(0, (salary * personaRuntime.savingsRate) / 12);

    // Financial agent
    const financial = new FinancialWorldAgent();
    financial.initialize(
      initialCapital,
      monthlySavings,
      personaRuntime.investmentAggressiveness,
      personaRuntime
    );

    // Career agent
    const career = new CareerWorldAgent();
    career.initialize(
      salary,
      personaRuntime.careerStability,
      personaRuntime.careerSkillLevel,
      personaRuntime
    );

    // Education agent (for relevant scenarios)
    const education = new EducationWorldAgent();
    if (this.scenario.id === 'advanced_degree') {
      education.initialize('masters', personaRuntime);
    } else if (this.scenario.id === 'career_change') {
      education.initialize('bootcamp', personaRuntime);
    }

    // Social agent
    const social = new SocialWorldAgent();
    social.initialize(
      personaRuntime.supportNetworkSize,
      personaRuntime.relationshipSatisfaction,
      personaRuntime.hasPartner,
      personaRuntime
    );

    return { financial, career, education, social };
  }

  // Apply world agent effects
  private applyWorldAgents(context: CloneExecutionContext, worldAgents: WorldAgents): void {
    const agents = [worldAgents.financial, worldAgents.career, worldAgents.education, worldAgents.social];

    for (const agent of agents) {
      const event = agent.evaluate(context);
      if (event) {
        applyExternalCausalTransition(context.state, event.type);
        context.state = applyEffectsToState(context.state, event.impact);
        context.state.events.push({
          nodeId: `world:${agent.type}:${event.type}`,
          occurred: true,
          outcomeId: event.type,
          timestamp: Date.now(),
          source: 'world',
          description: event.description,
        });
      }
    }
  }

  private syncWorldAgentMetrics(
    context: CloneExecutionContext,
    worldAgents: WorldAgents,
  ): void {
    const financialSnapshot = worldAgents.financial.getSnapshot();
    context.state.metrics.portfolioValue = financialSnapshot.totalValue;
    context.state.metrics.maxDrawdown = Math.abs(financialSnapshot.maxDrawdown);

    const careerSnapshot = worldAgents.career.getSnapshot();
    context.state.metrics.currentSalary = careerSnapshot.currentSalary;
    context.state.metrics.jobStability = careerSnapshot.jobStability;
    context.state.metrics.burnoutLevel = careerSnapshot.burnoutLevel;

    const educationSnapshot = worldAgents.education.getSnapshot();
    context.state.metrics.completionProgress = educationSnapshot.completionProgress;
    context.state.metrics.skillAcquisition = educationSnapshot.skillAcquisition;
    context.state.metrics.monthsRemaining = educationSnapshot.monthsRemaining;

    const socialSnapshot = worldAgents.social.getSnapshot();
    context.state.metrics.relationshipSatisfaction = socialSnapshot.relationshipSatisfaction;
    context.state.metrics.socialDisruption = socialSnapshot.socialDisruption;
    context.state.metrics.socialCapital = socialSnapshot.socialCapital;
    context.state.metrics.supportNetworkSize = socialSnapshot.supportNetworkSize;
    context.state = refreshBeliefState(context.state);
  }

  // Get LLM usage stats
  getLLMUsage(): {
    llmCallsUsed: number;
    maxLLMCalls: number;
  } {
    return {
      llmCallsUsed: this.llmCallsUsed,
      maxLLMCalls: this.config.maxLLMCalls,
    };
  }
}

// Create engine factory
export function createEngine(
  scenario: Scenario,
  config?: Partial<SimulationConfig>
): SimulationEngine {
  return new SimulationEngine(scenario, config);
}

// Quick simulation function for a single clone
export async function simulateClone(
  scenario: Scenario,
  cloneId: string,
  parameters: CloneParameters,
  stratification: { percentile: number; category: 'edge' | 'central' | 'typical' }
): Promise<CloneResult> {
  const engine = new SimulationEngine(scenario, { useLLM: true, useChaos: true });
  return await engine.executeClone(cloneId, parameters, stratification);
}

// Batch simulation for multiple clones
export async function simulateBatch(
  scenario: Scenario,
  clones: Array<{
    cloneId: string;
    parameters: CloneParameters;
    stratification: { percentile: number; category: 'edge' | 'central' | 'typical' };
  }>,
  config?: Partial<SimulationConfig>
): Promise<CloneResult[]> {
  const engine = new SimulationEngine(scenario, config);
  const results: CloneResult[] = [];

  for (const clone of clones) {
    const result = await engine.executeClone(
      clone.cloneId,
      clone.parameters,
      clone.stratification
    );
    results.push(result);
  }

  return results;
}

// Export types
export { SimulationConfig, WorldAgents };
