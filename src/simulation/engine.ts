// Monte Carlo Simulation Engine
// Executes clones through decision graphs with world agents and chaos injection

import {
  CloneExecutionContext,
  CloneParameters,
  CloneResult,
  DecisionNode,
  EventNode,
  LLMEvaluation,
  OutcomeNode,
  Scenario,
  SimulationGraphSnapshot,
  SimulationState,
} from './types.js';
import { categorizeOutcome, findNode } from './decisionGraph.js';
import {
  buildLiveSimulationGraphSnapshot,
  buildSimulationGraphStructure,
  withSnapshotTimestamp,
} from './graphSnapshot.js';
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
import {
  createForkEvaluator,
  type BatchEvaluationItem,
  type ForkEvaluator,
} from './forkEvaluator.js';
import { type ChaosInjector, createChaosInjector } from './chaosInjector.js';
import { FinancialWorldAgent } from './worldAgents/financial.js';
import { CareerWorldAgent } from './worldAgents/career.js';
import { EducationWorldAgent } from './worldAgents/education.js';
import { SocialWorldAgent } from './worldAgents/social.js';
import { logger } from '../utils/logger.js';
import {
  type ConcurrencyLimiter,
  type RateLimiter,
} from '../utils/rateLimiter.js';
import { type MasterPersona } from '../persona/personaCompressor.js';
import { buildSimulationPersonaRuntimeProfile } from './personaRuntime.js';

interface WorldAgents {
  financial: FinancialWorldAgent;
  career: CareerWorldAgent;
  education: EducationWorldAgent;
  social: SocialWorldAgent;
}

export interface SimulationConfig {
  useLLM: boolean;
  useChaos: boolean;
  maxLLMCalls: number;
  logDecisions: boolean;
  rateLimiter?: RateLimiter | null;
  requestLimiter?: ConcurrencyLimiter | null;
  masterPersona?: MasterPersona;
}

export interface CloneStratification {
  percentile: number;
  category: 'edge' | 'central' | 'typical';
}

export interface SimulationCloneInput {
  cloneId: string;
  parameters: CloneParameters;
  stratification: CloneStratification;
  startingState?: SimulationState;
}

interface WaitingDecision {
  session: ActiveCloneSession;
  node: DecisionNode;
  request: {
    cloneParams: CloneParameters;
    decisionNode: DecisionNode;
    state: SimulationState;
    scenario: Scenario;
    masterPersona?: MasterPersona;
  };
  complexity: number;
  useReasoning: boolean;
}

export interface ActiveCloneSession {
  cloneId: string;
  stratification: CloneStratification;
  startedAtMs: number;
  iterations: number;
  context: CloneExecutionContext;
  worldAgents: WorldAgents;
  chaos: ChaosInjector;
  waitingDecision: WaitingDecision | null;
}

interface SessionAdvanceResult {
  waitingDecision: WaitingDecision | null;
  completed: boolean;
  localStepDurationMs: number;
}

export interface SimulationExecutionProgress {
  completedClones: number;
  totalClones: number;
  activeFrontier: number;
  waitingDecisions: number;
  resolvedDecisions: number;
  estimatedDecisionCount: number;
  localStepDurationMs: number;
  graphSnapshot?: SimulationGraphSnapshot;
}

const MAX_ITERATIONS = 100;

export class SimulationEngine {
  private readonly scenario: Scenario;
  private readonly config: SimulationConfig;
  private llmCallsUsed = 0;
  private readonly evaluator: ForkEvaluator;
  private readonly masterPersona?: MasterPersona;
  private localStepDurationMs = 0;
  private peakActiveFrontier = 0;
  private peakWaitingDecisions = 0;
  private readonly decisionNodeCount: number;
  private readonly graphStructure: ReturnType<typeof buildSimulationGraphStructure>;

  constructor(scenario: Scenario, config: Partial<SimulationConfig> = {}) {
    this.scenario = scenario;
    this.config = {
      useLLM: true,
      useChaos: true,
      maxLLMCalls: 20,
      logDecisions: false,
      ...config,
    };
    this.evaluator = createForkEvaluator({
      rateLimiter: this.config.rateLimiter ?? null,
      requestLimiter: this.config.requestLimiter ?? null,
    });
    this.masterPersona = config.masterPersona;
    this.decisionNodeCount = Math.max(
      1,
      this.scenario.graph.filter((node) => node.type === 'decision').length,
    );
    this.graphStructure = buildSimulationGraphStructure(this.scenario);
  }

  async executeClone(
    cloneId: string,
    parameters: CloneParameters,
    stratification: CloneStratification,
    startingState?: SimulationState,
  ): Promise<CloneResult> {
    const session = this.createSession({
      cloneId,
      parameters,
      stratification,
      startingState,
    });

    while (!session.context.complete) {
      const advance = this.advanceSessionToDecision(session);
      this.localStepDurationMs += advance.localStepDurationMs;

      if (!advance.waitingDecision) {
        if (advance.completed) {
          break;
        }
        continue;
      }

      if (!this.config.useLLM) {
        this.applyDecisionEvaluation(session, {
          ...this.heuristicDecision(session.context, advance.waitingDecision.node),
          complexity: advance.waitingDecision.complexity,
        }, false);
        continue;
      }

      let evaluation: LLMEvaluation;
      let evaluatedByLLM = true;
      try {
        evaluation = await this.evaluator.evaluateForkBatch([
          this.createBatchItem(advance.waitingDecision, 0),
        ]).then((result) => result.get(0) as LLMEvaluation);
      } catch (error) {
        evaluatedByLLM = false;
        const waitingDecision = advance.waitingDecision;
        evaluation = await this.evaluator
          .heuristicEvaluation(
            waitingDecision.request,
            waitingDecision.complexity,
          )
          .catch(() => ({
            ...this.heuristicDecision(session.context, waitingDecision.node),
            complexity: waitingDecision.complexity,
          }));

        logger.warn(
          {
            cloneId,
            nodeId: waitingDecision.node.id,
            error: (error as Error).message,
          },
          'LLM evaluation failed, using heuristic',
        );
      }

      this.applyDecisionEvaluation(session, evaluation, evaluatedByLLM);
    }

    return this.finalizeSession(session);
  }

  async executeFrontierBatch(
    clones: SimulationCloneInput[],
    options: {
      activeFrontier?: number;
      decisionBatchSize?: number;
      onProgress?: (progress: SimulationExecutionProgress) => Promise<void> | void;
    } = {},
  ): Promise<CloneResult[]> {
    const results: CloneResult[] = [];
    const pending = [...clones];
    const activeSessions: ActiveCloneSession[] = [];
    const frontierSize = Math.max(
      1,
      Math.min(
        clones.length,
        options.activeFrontier ?? clones.length,
      ),
    );
    const decisionBatchSize = Math.max(1, options.decisionBatchSize ?? clones.length);
    const estimatedDecisionCount = Math.max(1, clones.length * this.decisionNodeCount);
    let resolvedDecisions = 0;

    const fillFrontier = (): void => {
      while (activeSessions.length < frontierSize && pending.length > 0) {
        const nextClone = pending.shift();
        if (!nextClone) {
          break;
        }
        activeSessions.push(this.createSession(nextClone));
      }
      this.peakActiveFrontier = Math.max(this.peakActiveFrontier, activeSessions.length);
    };

    const emitProgress = async (waitingDecisions: number): Promise<void> => {
      this.peakWaitingDecisions = Math.max(this.peakWaitingDecisions, waitingDecisions);
      const timestamp = new Date().toISOString();
      await options.onProgress?.({
        completedClones: results.length,
        totalClones: clones.length,
        activeFrontier: activeSessions.length,
        waitingDecisions,
        resolvedDecisions,
        estimatedDecisionCount,
        localStepDurationMs: this.localStepDurationMs,
        graphSnapshot: withSnapshotTimestamp(
          buildLiveSimulationGraphSnapshot({
            structure: this.graphStructure,
            cloneCount: clones.length,
            completedResults: results,
            activeTraces: activeSessions.map((session) => ({
              cloneId: session.cloneId,
              category: session.stratification.category,
              currentNodeId: session.context.currentNodeId,
              pathNodeIds: session.context.path,
              state: session.context.state,
            })),
            waitingNodeIds: activeSessions
              .map((session) => session.waitingDecision?.node.id)
              .filter((nodeId): nodeId is string => typeof nodeId === 'string'),
          }),
          timestamp,
        ),
      });
    };

    fillFrontier();
    await emitProgress(0);

    while (activeSessions.length > 0) {
      const waitingDecisions: WaitingDecision[] = [];

      for (let index = activeSessions.length - 1; index >= 0; index -= 1) {
        const session = activeSessions[index];
        const advance = this.advanceSessionToDecision(session);
        this.localStepDurationMs += advance.localStepDurationMs;

        if (advance.waitingDecision) {
          waitingDecisions.push(advance.waitingDecision);
        }

        if (advance.completed) {
          results.push(this.finalizeSession(session));
          activeSessions.splice(index, 1);
        }
      }

      fillFrontier();
      await emitProgress(waitingDecisions.length);

      if (waitingDecisions.length === 0) {
        continue;
      }

      if (!this.config.useLLM) {
        for (const waitingDecision of waitingDecisions) {
          this.applyDecisionEvaluation(waitingDecision.session, {
            ...this.heuristicDecision(waitingDecision.session.context, waitingDecision.node),
            complexity: waitingDecision.complexity,
          }, false);
          resolvedDecisions += 1;
        }
        await emitProgress(0);
        continue;
      }

      const grouped = new Map<string, WaitingDecision[]>();
      for (const waitingDecision of waitingDecisions) {
        const key = [
          waitingDecision.request.scenario.id,
          waitingDecision.node.id,
          waitingDecision.useReasoning ? 'reasoning' : 'standard',
        ].join(':');
        const group = grouped.get(key);
        if (group) {
          group.push(waitingDecision);
        } else {
          grouped.set(key, [waitingDecision]);
        }
      }

      const chunks = Array.from(grouped.values()).flatMap((group) => {
        const entries: WaitingDecision[][] = [];
        const preferredBatchSize = this.evaluator.getPreferredBatchSize(
          group[0].request.scenario.id,
          group[0].useReasoning,
          decisionBatchSize,
        );
        for (let index = 0; index < group.length; index += preferredBatchSize) {
          entries.push(group.slice(index, index + preferredBatchSize));
        }
        return entries;
      });

      const chunkResults = await Promise.all(
        chunks.map(async (chunk) => {
          try {
            const evaluations = await this.evaluator.evaluateForkBatch(
              chunk.map((waitingDecision, index) =>
                this.createBatchItem(waitingDecision, index)),
            );
            return { chunk, evaluations };
          } catch (error) {
            logger.warn(
              {
                nodeId: chunk[0]?.node.id,
                batchSize: chunk.length,
                error: (error as Error).message,
              },
              'Batch evaluation failed at the scheduler level, falling back to heuristics',
            );

            return { chunk, evaluations: new Map<number, LLMEvaluation>() };
          }
        }),
      );

      for (const { chunk, evaluations } of chunkResults) {
        for (let index = 0; index < chunk.length; index += 1) {
          const waitingDecision = chunk[index];
          const evaluation = evaluations.get(index)
            ?? await this.evaluator
              .heuristicEvaluation(waitingDecision.request, waitingDecision.complexity)
              .catch(() => ({
                ...this.heuristicDecision(waitingDecision.session.context, waitingDecision.node),
                complexity: waitingDecision.complexity,
              }));

          this.applyDecisionEvaluation(
            waitingDecision.session,
            evaluation,
            evaluations.has(index),
          );
          resolvedDecisions += 1;
        }
      }

      await emitProgress(0);
    }

    return results;
  }

  getDecisionNodeCount(): number {
    return this.decisionNodeCount;
  }

  private createSession(input: SimulationCloneInput): ActiveCloneSession {
    const worldAgents = this.initializeWorldAgents(input.parameters);
    const state = refreshBeliefState(
      cloneSimulationState(input.startingState ?? this.scenario.initialState),
    );

    return {
      cloneId: input.cloneId,
      stratification: input.stratification,
      startedAtMs: Date.now(),
      iterations: 0,
      context: {
        cloneId: input.cloneId,
        parameters: input.parameters,
        scenario: this.scenario,
        state,
        currentNodeId: this.scenario.entryNodeId,
        path: [],
        complete: false,
      },
      worldAgents,
      chaos: this.config.useChaos ? createChaosInjector(true) : createChaosInjector(false),
      waitingDecision: null,
    };
  }

  private advanceSessionToDecision(session: ActiveCloneSession): SessionAdvanceResult {
    const startedAt = Date.now();

    while (!session.context.complete && session.iterations < MAX_ITERATIONS) {
      if (session.waitingDecision) {
        break;
      }

      session.iterations += 1;
      const currentNode = findNode(this.scenario.graph, session.context.currentNodeId);
      if (!currentNode) {
        logger.error({ nodeId: session.context.currentNodeId }, 'Node not found, ending simulation');
        session.context.complete = true;
        break;
      }

      this.syncWorldAgentMetrics(session.context, session.worldAgents);
      session.context.path.push(session.context.currentNodeId);

      if (currentNode.type === 'decision') {
        session.waitingDecision = this.prepareWaitingDecision(session, currentNode);
        break;
      }

      if (currentNode.type === 'event') {
        this.executeEventNode(session.context, currentNode);
      } else if (currentNode.type === 'outcome') {
        this.executeOutcomeNode(session.context, currentNode);
      }

      this.finalizeNodeStep(session, currentNode.type);
    }

    if (session.iterations >= MAX_ITERATIONS && !session.context.complete && !session.waitingDecision) {
      logger.warn({ cloneId: session.cloneId }, 'Clone reached max iterations, ending simulation');
      session.context.complete = true;
    }

    return {
      waitingDecision: session.waitingDecision,
      completed: session.context.complete,
      localStepDurationMs: Date.now() - startedAt,
    };
  }

  private prepareWaitingDecision(
    session: ActiveCloneSession,
    node: DecisionNode,
  ): WaitingDecision {
    const request = {
      cloneParams: session.context.parameters,
      decisionNode: node,
      state: session.context.state,
      scenario: this.scenario,
      masterPersona: this.masterPersona,
    };

    if (!this.config.useLLM) {
      return {
        session,
        node,
        request,
        complexity: this.evaluator.calculateComplexity(
          node,
          session.context.parameters,
          session.context.state,
        ),
        useReasoning: false,
      };
    }

    const availableReasoningCalls = Math.max(0, this.config.maxLLMCalls - this.llmCallsUsed);
    const plan = this.evaluator.createEvaluationPlan(request, availableReasoningCalls);

    if (plan.useReasoning) {
      this.llmCallsUsed += 1;
    }

    return {
      session,
      node,
      request,
      complexity: plan.complexity,
      useReasoning: plan.useReasoning,
    };
  }

  private createBatchItem(
    waitingDecision: WaitingDecision,
    index: number,
  ): BatchEvaluationItem {
    return {
      index,
      requestId: `case_${waitingDecision.session.cloneId}_${waitingDecision.node.id}_${index}`,
      request: waitingDecision.request,
      complexity: waitingDecision.complexity,
      useReasoning: waitingDecision.useReasoning,
      nodeId: waitingDecision.node.id,
      batchWaitMs: 0,
    };
  }

  private applyDecisionEvaluation(
    session: ActiveCloneSession,
    evaluation: LLMEvaluation,
    evaluatedByLLM: boolean,
  ): void {
    const waitingDecision = session.waitingDecision;
    if (!waitingDecision) {
      return;
    }

    const { node } = waitingDecision;
    const chosenOption = node.options.find((option) => option.id === evaluation.chosenOptionId)
      ?? node.options[0];

    if (!chosenOption) {
      logger.error({ nodeId: node.id }, 'Decision node has no options, ending simulation');
      session.context.complete = true;
      session.waitingDecision = null;
      return;
    }

    session.context.currentNodeId = chosenOption.nextNodeId;
    applyDecisionCausalTransition(session.context.state, this.scenario.id, node.id, chosenOption.id);
    session.context.state.decisions.push({
      nodeId: node.id,
      choice: chosenOption.id,
      timestamp: Date.now(),
      evaluatedByLLM,
      reasoning: evaluation.reasoning,
      confidence: evaluation.confidence,
    });
    session.context.state = refreshBeliefState(session.context.state);
    session.context.state.beliefState.updateNarrative = evaluation.reasoning;
    session.waitingDecision = null;

    if (this.config.logDecisions) {
      logger.debug(
        {
          cloneId: session.cloneId,
          nodeId: node.id,
          chosenOption: chosenOption.id,
          complexity: evaluation.complexity,
          confidence: evaluation.confidence,
          reasoning: evaluation.reasoning,
          evaluatedByLLM,
        },
        'Decision applied',
      );
    }

    this.finalizeNodeStep(session, 'decision');
  }

  private finalizeNodeStep(
    session: ActiveCloneSession,
    nodeType: 'decision' | 'event' | 'outcome',
  ): void {
    this.applyWorldAgents(session.context, session.worldAgents);
    this.syncWorldAgentMetrics(session.context, session.worldAgents);

    if (this.config.useChaos) {
      const chaosResult = session.chaos.inject(session.context);
      if (chaosResult.occurred && chaosResult.event) {
        session.context.state = session.chaos.applyEvent(session.context.state, chaosResult.event);
        session.context.state.events.push({
          nodeId: `chaos:${chaosResult.event.id}`,
          occurred: true,
          outcomeId: chaosResult.event.id,
          timestamp: Date.now(),
          source: 'chaos',
          description: chaosResult.event.description,
        });

        if (this.config.logDecisions) {
          logger.debug(
            {
              cloneId: session.cloneId,
              event: chaosResult.event.id,
              probability: chaosResult.modifiedProbability,
            },
            'Chaos event applied',
          );
        }
      }
    }

    if (nodeType === 'decision') {
      session.context.state.timeElapsed += 1;
      session.worldAgents.financial.advanceTime(1);
      session.worldAgents.career.advanceTime(1);
      session.worldAgents.education.advanceTime(1);
      session.worldAgents.social.advanceTime(1);
    }
  }

  private finalizeSession(session: ActiveCloneSession): CloneResult {
    const duration = Date.now() - session.startedAtMs;
    const outcomeBucket = categorizeOutcome(session.context.state, this.scenario.id);

    return {
      cloneId: session.cloneId,
      parameters: session.context.parameters,
      stratification: session.stratification,
      path: session.context.path,
      finalState: session.context.state,
      metrics: {
        ...session.context.state.metrics,
        outcomeValue: outcomeBucket === 'success' ? 1 : outcomeBucket === 'failure' ? 0 : 0.5,
        totalDecisions: session.context.state.decisions.length,
        totalEvents: session.context.state.events.length,
        finalCapital: session.context.state.capital,
        finalHealth: session.context.state.health,
        finalHappiness: session.context.state.happiness,
        beliefConfidence: session.context.state.beliefState.thesisConfidence,
        beliefUncertainty: session.context.state.beliefState.uncertaintyLevel,
        beliefEvidenceClarity: session.context.state.beliefState.evidenceClarity,
        beliefCommitmentLockIn: session.context.state.beliefState.commitmentLockIn,
        beliefDownsideSalience: session.context.state.beliefState.downsideSalience,
        demandStrength: session.context.state.causalState.demandStrength,
        executionCapacity: session.context.state.causalState.executionCapacity,
        runwayStress: session.context.state.causalState.runwayStress,
        marketTailwind: session.context.state.causalState.marketTailwind,
        socialLegitimacy: session.context.state.causalState.socialLegitimacy,
        reversibilityPressure: session.context.state.causalState.reversibilityPressure,
        evidenceMomentum: session.context.state.causalState.evidenceMomentum,
      },
      duration,
    };
  }

  private executeEventNode(
    context: CloneExecutionContext,
    node: EventNode,
  ): void {
    const probability = calculateEventProbability(context, node);
    const eventOccurred = Math.random() < probability;

    if (eventOccurred && node.outcomes.length > 0) {
      const outcome = selectEventOutcome(context.state, this.scenario.id, node);
      applyEventOutcomeCausalTransition(context.state, this.scenario.id, node.id, outcome.id);
      context.state = applyEffectsToState(context.state, outcome.effects);
      context.currentNodeId = outcome.nextNodeId;

      context.state.events.push({
        nodeId: node.id,
        occurred: true,
        outcomeId: outcome.id,
        timestamp: Date.now(),
        source: 'graph',
        description: outcome.label,
      });
      return;
    }

    context.currentNodeId = node.outcomes[0]?.nextNodeId || context.currentNodeId;
    context.state.events.push({
      nodeId: node.id,
      occurred: false,
      timestamp: Date.now(),
      source: 'graph',
      description: node.description,
    });
  }

  private executeOutcomeNode(
    context: CloneExecutionContext,
    node: OutcomeNode,
  ): void {
    context.complete = true;
    context.state = applyOutcomeNodeResults(context.state, node.results);
  }

  private heuristicDecision(
    context: CloneExecutionContext,
    node: DecisionNode,
  ): { chosenOptionId: string; reasoning: string; confidence: number } {
    const { parameters, state } = context;

    let bestOption = node.options[0];
    let bestScore = -Infinity;
    let secondBestScore = -Infinity;
    const bestReasons: string[] = [];

    for (const option of node.options) {
      let score = 0;
      const reasons: string[] = [];
      const label = option.label.toLowerCase();

      if (parameters.riskTolerance > 0.7) {
        if (label.includes('aggressive') || label.includes('bold') || label.includes('all-in') || label.includes('high')) {
          score += 2;
          reasons.push('high risk tolerance matched a more aggressive branch');
        }
      } else if (parameters.riskTolerance < 0.3) {
        if (label.includes('safe') || label.includes('cautious') || label.includes('preserve') || label.includes('low')) {
          score += 2;
          reasons.push('low risk tolerance favored preserving downside');
        }
      }

      if (parameters.decisionSpeed > 0.7) {
        if (label.includes('now') || label.includes('immediate') || label.includes('start') || label.includes('quick')) {
          score += 1;
          reasons.push('fast decision speed favored immediate action');
        }
      } else if (parameters.decisionSpeed < 0.3) {
        if (label.includes('plan') || label.includes('analyze') || label.includes('research') || label.includes('study')) {
          score += 1;
          reasons.push('deliberate decision speed favored more analysis');
        }
      }

      if (parameters.socialDependency > 0.7) {
        if (label.includes('partner') || label.includes('team') || label.includes('network') || label.includes('collaborate')) {
          score += 1;
          reasons.push('social orientation favored collaborative support');
        }
      } else if (parameters.socialDependency < 0.3) {
        if (label.includes('independent') || label.includes('solo') || label.includes('alone') || label.includes('self')) {
          score += 1;
          reasons.push('independent orientation favored self-directed options');
        }
      }

      if (parameters.timePreference < 0.3) {
        if (label.includes('long') || label.includes('patient') || label.includes('future') || label.includes('invest')) {
          score += 1;
          reasons.push('patient time preference favored longer-horizon payoff');
        }
      } else if (parameters.timePreference > 0.7) {
        if (label.includes('now') || label.includes('immediate') || label.includes('quick') || label.includes('fast')) {
          score += 1;
          reasons.push('present bias favored faster payoff');
        }
      }

      if (parameters.emotionalVolatility > 0.7) {
        if (label.includes('exciting') || label.includes('passion') || label.includes('dream') || label.includes('change')) {
          score += 1;
          reasons.push('emotional volatility leaned toward more charged options');
        }
      }

      if (parameters.learningStyle > 0.7) {
        if (label.includes('learn') || label.includes('study') || label.includes('degree') || label.includes('education')) {
          score += 1;
          reasons.push('theoretical learning style favored explicit learning paths');
        }
      } else if (parameters.learningStyle < 0.3) {
        if (label.includes('experience') || label.includes('practice') || label.includes('do') || label.includes('try')) {
          score += 1;
          reasons.push('experiential learning style favored action-first paths');
        }
      }

      if (state.capital < 10000) {
        if (label.includes('quit') || label.includes('stop') || label.includes('preserve') || label.includes('safe')) {
          score += 2;
          reasons.push('low capital pushed the clone toward preserving runway');
        }
        if (label.includes('double') || label.includes('risk') || label.includes('aggressive')) {
          score -= 2;
        }
      }

      if (state.health < 0.5) {
        if (label.includes('health') || label.includes('rest') || label.includes('medical') || label.includes('recover')) {
          score += 2;
          reasons.push('poor health favored recovery over escalation');
        }
      }

      if (state.happiness < 0.3) {
        if (label.includes('happiness') || label.includes('joy') || label.includes('fulfillment') || label.includes('passion')) {
          score += 1;
          reasons.push('low happiness increased the pull toward emotional relief');
        }
      }

      if (score > bestScore) {
        secondBestScore = bestScore;
        bestScore = score;
        bestOption = option;
        bestReasons.splice(0, bestReasons.length, ...reasons);
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

  private initializeWorldAgents(parameters: CloneParameters): WorldAgents {
    const initialCapital = this.scenario.initialState.capital;
    const personaRuntime = buildSimulationPersonaRuntimeProfile(parameters, this.masterPersona);
    const salaryMetric = this.scenario.initialState.metrics.currentSalary;
    const salary = typeof salaryMetric === 'number' ? salaryMetric : 75000;
    const monthlySavings = Math.max(0, (salary * personaRuntime.savingsRate) / 12);

    const financial = new FinancialWorldAgent();
    financial.initialize(
      initialCapital,
      monthlySavings,
      personaRuntime.investmentAggressiveness,
      personaRuntime,
    );

    const career = new CareerWorldAgent();
    career.initialize(
      salary,
      personaRuntime.careerStability,
      personaRuntime.careerSkillLevel,
      personaRuntime,
    );

    const education = new EducationWorldAgent();
    if (this.scenario.id === 'advanced_degree') {
      education.initialize('masters', personaRuntime);
    } else if (this.scenario.id === 'career_change') {
      education.initialize('bootcamp', personaRuntime);
    }

    const social = new SocialWorldAgent();
    social.initialize(
      personaRuntime.supportNetworkSize,
      personaRuntime.relationshipSatisfaction,
      personaRuntime.hasPartner,
      personaRuntime,
    );

    return { financial, career, education, social };
  }

  private applyWorldAgents(context: CloneExecutionContext, worldAgents: WorldAgents): void {
    const agents = [
      worldAgents.financial,
      worldAgents.career,
      worldAgents.education,
      worldAgents.social,
    ];

    for (const agent of agents) {
      const event = agent.evaluate(context);
      if (!event) {
        continue;
      }

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

  getLLMUsage(): { llmCallsUsed: number; maxLLMCalls: number } {
    return {
      llmCallsUsed: this.llmCallsUsed,
      maxLLMCalls: this.config.maxLLMCalls,
    };
  }

  getRuntimeTelemetry(): {
    llmCallsUsed: number;
    maxLLMCalls: number;
    llm: ReturnType<ForkEvaluator['getTelemetry']>['llm'];
    embeddings: ReturnType<ForkEvaluator['getTelemetry']>['embeddings'];
    rateLimiter: {
      acquireCalls: number;
      immediateGrants: number;
      queuedAcquires: number;
      totalWaitMs: number;
      maxWaitMs: number;
    };
    localStepDurationMs: number;
    peakActiveFrontier: number;
    peakWaitingDecisions: number;
  } {
    const evaluatorTelemetry = this.evaluator.getTelemetry();
    const limiterStats = this.config.rateLimiter?.getStats?.() ?? {
      acquireCalls: 0,
      immediateGrants: 0,
      queuedAcquires: 0,
      totalWaitMs: 0,
      maxWaitMs: 0,
    };

    return {
      llmCallsUsed: this.llmCallsUsed,
      maxLLMCalls: this.config.maxLLMCalls,
      llm: evaluatorTelemetry.llm,
      embeddings: evaluatorTelemetry.embeddings,
      rateLimiter: limiterStats,
      localStepDurationMs: this.localStepDurationMs,
      peakActiveFrontier: this.peakActiveFrontier,
      peakWaitingDecisions: this.peakWaitingDecisions,
    };
  }
}

export function createEngine(
  scenario: Scenario,
  config?: Partial<SimulationConfig>,
): SimulationEngine {
  return new SimulationEngine(scenario, config);
}

export async function simulateClone(
  scenario: Scenario,
  cloneId: string,
  parameters: CloneParameters,
  stratification: CloneStratification,
): Promise<CloneResult> {
  const engine = new SimulationEngine(scenario, { useLLM: true, useChaos: true });
  return engine.executeClone(cloneId, parameters, stratification);
}

export async function simulateBatch(
  scenario: Scenario,
  clones: Array<{
    cloneId: string;
    parameters: CloneParameters;
    stratification: CloneStratification;
  }>,
  config?: Partial<SimulationConfig>,
): Promise<CloneResult[]> {
  const engine = new SimulationEngine(scenario, config);
  return engine.executeFrontierBatch(clones, {
    activeFrontier: clones.length,
    decisionBatchSize: clones.length,
  });
}

export { WorldAgents };
