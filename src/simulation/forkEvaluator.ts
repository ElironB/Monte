import OpenAI from 'openai';
import {
  DecisionNode,
  DecisionOption,
  SimulationState,
  LLMEvaluation,
  ForkEvaluationRequest,
  CloneParameters,
  SimulationEmbeddingRuntimeTelemetry,
  SimulationLlmRuntimeTelemetry,
  SimulationNodeRuntimeTelemetry,
} from './types.js';
import { getScenario } from './decisionGraph.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { EmbeddingService, cosineSimilarity } from '../embeddings/embeddingService.js';
import { type ConcurrencyLimiter, type RateLimiter } from '../utils/rateLimiter.js';
import { parseJsonResponse } from '../utils/json.js';
import {
  createEmptyEmbeddingTelemetry,
  createEmptyLlmTelemetry,
  createEmptyNodeTelemetry,
} from './runtimeTelemetry.js';

interface LLMUsage {
  standardCalls: number;
  reasoningCalls: number;
  totalTokens: number;
  estimatedCost: number;
}

interface HeuristicConceptEmbeddings {
  aggressiveRisk: number[];
  cautiousPreservation: number[];
  immediateAction: number[];
  deliberatePlanning: number[];
  collaborativeAction: number[];
  independentAction: number[];
  longTermPatience: number[];
  emotionalImpulse: number[];
  theoreticalLearning: number[];
  experientialLearning: number[];
  exitPreservation: number[];
  flawlessExecution: number[];
  abandonedExecution: number[];
  exhaustiveResearch: number[];
  superficialAcceptance: number[];
  stressResilience: number[];
  stressCollapse: number[];
}

const HEURISTIC_CONCEPT_TEXTS: Record<keyof HeuristicConceptEmbeddings, string> = {
  aggressiveRisk: 'aggressive risk-taking, bold speculation, all-in moves, high-upside and high-volatility choice',
  cautiousPreservation: 'cautious preservation, safe conservative option, downside protection, capital preservation',
  immediateAction: 'take action immediately, start now, quick decisive move, bias toward action',
  deliberatePlanning: 'plan carefully, analyze first, research deeply, deliberate measured action',
  collaborativeAction: 'partner with others, team-based move, network-driven collaboration, social coordination',
  independentAction: 'independent solo move, self-directed decision, acting alone without outside input',
  longTermPatience: 'patient long-term orientation, future payoff, delayed gratification, invest and wait',
  emotionalImpulse: 'emotion-driven exciting leap, passion move, dramatic change, impulsive pursuit of excitement',
  theoreticalLearning: 'study, learn, degree, research, theoretical understanding before acting',
  experientialLearning: 'practice, experiment, hands-on trial, learn by doing, direct experience',
  exitPreservation: 'quit, stop, exit, retreat, preserve resources, reduce exposure and protect capital',
  flawlessExecution: 'follow through, complete tasks, keep commitments, execute flawlessly, finish projects',
  abandonedExecution: 'procrastinate, abandon plans, fail to execute, drop tasks, miss deadlines',
  exhaustiveResearch: 'deep research, gather all facts, verify sources, seek maximum information',
  superficialAcceptance: 'accept without checking, act on limited info, ignore research, superficial understanding',
  stressResilience: 'thrive under pressure, focus in crisis, resilient handling of stress, perform well when things go wrong',
  stressCollapse: 'panic under pressure, freeze in crisis, collapse from stress, shut down when overwhelmed',
};

interface ForkEvaluatorOptions {
  rateLimiter?: RateLimiter | null;
  requestLimiter?: ConcurrencyLimiter | null;
  decisionBatchSize?: number;
  decisionBatchFlushMs?: number;
}

type ParsedForkResponse = {
  chosenOptionId?: unknown;
  option?: unknown;
  choice?: unknown;
  reasoning?: unknown;
  explanation?: unknown;
  confidence?: unknown;
};

type ParsedForkBatchEntry = {
  requestId?: unknown;
  caseId?: unknown;
  cloneId?: unknown;
  chosenOptionId?: unknown;
  option?: unknown;
  choice?: unknown;
  reasoning?: unknown;
  explanation?: unknown;
  confidence?: unknown;
  o?: unknown;
  c?: unknown;
  r?: unknown;
};

type ParsedForkBatchResponse = {
  d?: unknown;
  decisions?: unknown;
  evaluations?: unknown;
  choices?: unknown;
};

export interface BatchEvaluationItem {
  index: number;
  requestId: string;
  request: ForkEvaluationRequest;
  complexity: number;
  useReasoning: boolean;
  nodeId: string;
  batchWaitMs: number;
}

export interface ForkEvaluationPlan {
  complexity: number;
  useReasoning: boolean;
}

export class ForkEvaluator {
  private static heuristicConceptEmbeddings: HeuristicConceptEmbeddings | null = null;

  private client: OpenAI | null = null;
  private model: string;
  private reasoningModel: string | null;
  private rateLimiter: RateLimiter | null;
  private requestLimiter: ConcurrencyLimiter | null;
  private usage: LLMUsage = {
    standardCalls: 0,
    reasoningCalls: 0,
    totalTokens: 0,
    estimatedCost: 0,
  };
  private llmTelemetry: SimulationLlmRuntimeTelemetry = createEmptyLlmTelemetry();
  private embeddingTelemetry: SimulationEmbeddingRuntimeTelemetry = createEmptyEmbeddingTelemetry();
  private readonly nodeTelemetry = new Map<string, SimulationNodeRuntimeTelemetry>();
  private readonly batchSizeCeilings = new Map<string, number>();
  private requestSequence = 0;
  private readonly decisionBatchSize: number;
  private readonly decisionBatchFlushMs: number;

  private readonly MAX_REASONING_CALLS = 20;
  private readonly COMPLEXITY_THRESHOLD = 0.6;
  // OpenRouter prepends '{"' when json_object mode is on, and the model also
  // starts with '{', producing the double-brace garbage '{"{".  Skip it.
  private readonly useJsonObjectMode =
    !(config.llm?.baseUrl || '').includes('openrouter.ai');

  constructor(options: ForkEvaluatorOptions = {}) {
    this.rateLimiter = options.rateLimiter ?? null;
    this.requestLimiter = options.requestLimiter ?? null;
    this.decisionBatchSize = Math.max(1, options.decisionBatchSize ?? config.simulation.decisionBatchSize);
    this.decisionBatchFlushMs = Math.max(1, options.decisionBatchFlushMs ?? config.simulation.decisionBatchFlushMs);

    if (config.llm?.apiKey) {
      this.client = new OpenAI({
        apiKey: config.llm.apiKey,
        baseURL: config.llm.baseUrl || 'https://api.groq.com/openai/v1',
        defaultHeaders: {
          // OpenRouter deprioritises requests without these headers on free models,
          // leading to aggressive truncation.
          'HTTP-Referer': 'https://github.com/ElironB/Monte',
          'X-Title': 'Monte Engine',
        },
      });
      this.model = config.llm.model || 'openai/gpt-oss-20b';
      this.reasoningModel = config.llm.reasoningModel || null;
    } else {
      this.model = '';
      this.reasoningModel = null;
    }
  }

  async evaluateFork(
    request: ForkEvaluationRequest,
    availableReasoningCalls: number = this.MAX_REASONING_CALLS
  ): Promise<LLMEvaluation> {
    const { cloneParams, decisionNode, state, scenario } = request;
    const complexity = this.calculateComplexity(decisionNode, cloneParams, state);

    const useReasoning = complexity > this.COMPLEXITY_THRESHOLD &&
      availableReasoningCalls > 0 &&
      this.reasoningModel !== null;

    try {
      return await this.callLLM(request, complexity, useReasoning);
    } catch {
      this.llmTelemetry.fallbackHeuristicCount += 1;
      // Heuristic fallback is expected when the provider truncates or drops
      // responses (common on free-tier OpenRouter). Not an error.
      return await this.heuristicEvaluation(request, complexity);
    }
  }

  setRateLimiter(rateLimiter: RateLimiter | null): void {
    this.rateLimiter = rateLimiter;
  }

  setRequestLimiter(requestLimiter: ConcurrencyLimiter | null): void {
    this.requestLimiter = requestLimiter;
  }

  createEvaluationPlan(
    request: ForkEvaluationRequest,
    availableReasoningCalls: number = this.MAX_REASONING_CALLS,
  ): ForkEvaluationPlan {
    const complexity = this.calculateComplexity(
      request.decisionNode,
      request.cloneParams,
      request.state,
    );

    return {
      complexity,
      useReasoning:
        complexity > this.COMPLEXITY_THRESHOLD
        && availableReasoningCalls > 0
        && this.reasoningModel !== null,
    };
  }

  getPreferredBatchSize(
    scenarioId: string,
    useReasoning: boolean,
    configuredBatchSize: number,
  ): number {
    const ceiling = this.batchSizeCeilings.get(
      this.getBatchProfileKey(scenarioId, useReasoning),
    );

    return Math.max(1, Math.min(configuredBatchSize, ceiling ?? configuredBatchSize));
  }

  calculateComplexity(
    decisionNode: DecisionNode,
    cloneParams: CloneParameters,
    state: SimulationState
  ): number {
    let complexity = 0;
    const factors: number[] = [];

    const optionCount = decisionNode.options.length;
    factors.push(Math.min(1, optionCount / 5));

    const capitalAtRisk = Math.abs(state.capital) / 100000;
    factors.push(Math.min(1, capitalAtRisk));

    const timePressure = state.timeElapsed < 3 ? 0.3 : 0;
    factors.push(timePressure);

    const behavioralComplexity =
      (cloneParams.riskTolerance * cloneParams.emotionalVolatility +
        cloneParams.decisionSpeed * (1 - cloneParams.timePreference)) / 2;
    factors.push(behavioralComplexity);

    const requiresDeepThought = decisionNode.options.some(o => o.requiresEvaluation) ? 0.3 : 0;
    factors.push(requiresDeepThought);

    const stressVal = state.metrics.stressLevel;
    const stateStress = typeof stressVal === 'number' ? stressVal : 0;
    const contradictionFactor = stateStress * capitalAtRisk;
    factors.push(Math.min(1, contradictionFactor));

    const weights = [0.2, 0.25, 0.1, 0.2, 0.15, 0.1];
    complexity = factors.reduce((sum, factor, index) => sum + factor * weights[index], 0);

    return Math.min(1, Math.max(0, complexity));
  }

  private async callLLM(
    request: ForkEvaluationRequest,
    complexity: number,
    useReasoning: boolean,
  ): Promise<LLMEvaluation> {
    return this.callSingleLLM(request, complexity, useReasoning, 0);
  }

  async evaluateForkBatch(items: BatchEvaluationItem[]): Promise<Map<number, LLMEvaluation>> {
    if (items.length === 0) {
      return new Map();
    }

    const normalizedItems = items.map((item, index) => ({
      ...item,
      index: item.index ?? index,
      requestId: item.requestId || `case_${++this.requestSequence}`,
      batchWaitMs: item.batchWaitMs ?? 0,
    }));

    if (normalizedItems.length === 1) {
      const [item] = normalizedItems;
      return new Map([
        [
          item.index,
          await this.callSingleLLM(
            item.request,
            item.complexity,
            item.useReasoning,
            item.batchWaitMs,
          ),
        ],
      ]);
    }

    return this.resolveBatchItems(normalizedItems, 0);
  }

  private async callSingleLLM(
    request: ForkEvaluationRequest,
    complexity: number,
    useReasoning: boolean,
    batchWaitMs: number,
  ): Promise<LLMEvaluation> {
    if (!this.client) {
      throw new Error('LLM client not initialized - set OPENROUTER_API_KEY or GROQ_API_KEY');
    }

    const prompt = this.buildPrompt(request);
    const model = (useReasoning && this.reasoningModel) ? this.reasoningModel : this.model;
    const startTime = Date.now();

    const completion = await this.callWithRetry(async () => {
      const execute = async () => {
        if (this.rateLimiter) {
          await this.rateLimiter.acquire();
        }

        return this.client!.chat.completions.create({
          messages: [
            {
              role: 'system',
              content: 'You are a behavioral simulation engine. Given a persona with specific behavioral traits and a decision context, determine which option they would choose. Respond ONLY with a valid structured JSON object that matches the requested schema.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          model,
          temperature: 0.4 + (complexity * 0.3),
          max_tokens: useReasoning ? 600 : 400,
          ...(this.useJsonObjectMode ? { response_format: { type: 'json_object' as const } } : {}),
        });
      };

      return this.requestLimiter ? this.requestLimiter(execute) : execute();
    });

    const duration = Date.now() - startTime;
    this.recordDecisionCall({
      nodeId: request.decisionNode.id,
      useReasoning,
      durationMs: duration,
      batchWaitMs,
      batchSize: 1,
      totalTokens: completion.usage?.total_tokens || 0,
      promptTokens: completion.usage?.prompt_tokens || 0,
      responseTokens: completion.usage?.completion_tokens || 0,
      mode: 'single',
    });

    logger.debug({ duration, model, complexity, useReasoning }, 'LLM evaluation completed');

    const choice = completion.choices[0];
    const content = choice?.message?.content || '{}';
    const finishReason = choice?.finish_reason;

    if (!finishReason && content.length < 60) {
      throw new Error('Provider returned truncated response (no finish_reason)');
    }

    try {
      return this.parseLLMResponse(content, request.decisionNode, complexity);
    } catch (error) {
      if (content.length < 40) {
        logger.debug(
          { model, preview: content.slice(0, 200) },
          'LLM response truncated, falling back to heuristic',
        );
        throw error;
      }

      logger.debug(
        {
          model,
          complexity,
          useReasoning,
          maxTokens: useReasoning ? 600 : 400,
          preview: content.slice(0, 200),
        },
        'Failed to parse LLM response, retrying once with repair prompt',
      );
    }

    const repairStartedAt = Date.now();
    const repaired = await this.callWithRetry(async () => {
      const execute = async () => {
        if (this.rateLimiter) {
          await this.rateLimiter.acquire();
        }

        return this.client!.chat.completions.create({
          messages: [
            {
              role: 'system',
              content: 'You repair malformed JSON. Output only the corrected JSON object with keys: chosenOptionId, reasoning, confidence.',
            },
            {
              role: 'user',
              content: [
                `Valid option IDs: ${request.decisionNode.options.map((option) => option.id).join(', ')}`,
                `Malformed input: ${content.slice(0, 300)}`,
                'Return corrected JSON only.',
              ].join('\n'),
            },
          ],
          model,
          temperature: 0,
          max_tokens: 200,
          ...(this.useJsonObjectMode ? { response_format: { type: 'json_object' as const } } : {}),
        });
      };

      return this.requestLimiter ? this.requestLimiter(execute) : execute();
    });
    this.llmTelemetry.repairCalls += 1;
    this.llmTelemetry.totalRepairDurationMs += Date.now() - repairStartedAt;

    return this.parseLLMResponse(
      repaired.choices[0]?.message?.content || '{}',
      request.decisionNode,
      complexity,
    );
  }

  private async resolveBatchItems(
    items: BatchEvaluationItem[],
    attempt: number,
  ): Promise<Map<number, LLMEvaluation>> {
    if (items.length === 0) {
      return new Map();
    }

    if (items.length === 1) {
      const [item] = items;
      this.llmTelemetry.singleFallbackFromBatchCount += 1;
      return new Map([
        [
          item.index,
          await this.callSingleLLM(
            item.request,
            item.complexity,
            item.useReasoning,
            item.batchWaitMs,
          ),
        ],
      ]);
    }

    let result: Map<number, LLMEvaluation>;
    try {
      result = await this.callBatchLLM(items, attempt > 0);
    } catch (error) {
      return this.recoverBatchItems(items, attempt, error as Error);
    }

    if (result.size === items.length) {
      return result;
    }

    const unresolvedItems = items.filter((item) => !result.has(item.index));
    if (unresolvedItems.length === 0) {
      return result;
    }

    const recovered = await this.recoverBatchItems(
      unresolvedItems,
      attempt,
      new Error(`Missing ${unresolvedItems.length} decisions from batched payload`),
    );

    for (const [index, evaluation] of recovered) {
      result.set(index, evaluation);
    }

    return result;
  }

  private async recoverBatchItems(
    items: BatchEvaluationItem[],
    attempt: number,
    error: Error,
  ): Promise<Map<number, LLMEvaluation>> {
    logger.warn(
      {
        nodeId: items[0]?.nodeId,
        batchSize: items.length,
        attempt,
        error: error.message,
      },
      'Batched decision evaluation failed, recovering',
    );

    if (attempt === 0) {
      this.recordBatchRetry(items[0]?.nodeId);
      return this.resolveBatchItems(items, 1);
    }

    if (items.length > 1) {
      this.recordSplitBatch(
        items[0]?.nodeId,
        items[0]?.request.scenario.id,
        items.some((item) => item.useReasoning),
        items.length,
      );
      const splitIndex = Math.ceil(items.length / 2);
      const [leftResults, rightResults] = await Promise.all([
        this.resolveBatchItems(items.slice(0, splitIndex), 0),
        this.resolveBatchItems(items.slice(splitIndex), 0),
      ]);

      return new Map([...leftResults, ...rightResults]);
    }

    const [item] = items;
    this.llmTelemetry.singleFallbackFromBatchCount += 1;
    return new Map([
      [
        item.index,
        await this.callSingleLLM(
          item.request,
          item.complexity,
          item.useReasoning,
          item.batchWaitMs,
        ),
      ],
    ]);
  }

  private async callBatchLLM(
    items: BatchEvaluationItem[],
    strictRetry: boolean,
  ): Promise<Map<number, LLMEvaluation>> {
    if (!this.client) {
      throw new Error('LLM client not initialized - set OPENROUTER_API_KEY or GROQ_API_KEY');
    }

    const prompt = this.buildBatchPrompt(items);
    const useReasoning = items.some((item) => item.useReasoning);
    const model = (useReasoning && this.reasoningModel) ? this.reasoningModel : this.model;
    const averageComplexity = items.reduce((sum, item) => sum + item.complexity, 0) / items.length;
    const batchWaitMs = items.reduce((sum, item) => sum + item.batchWaitMs, 0);
    const startTime = Date.now();

    const completion = await this.callWithRetry(async () => {
      const execute = async () => {
        if (this.rateLimiter) {
          await this.rateLimiter.acquire();
        }

        return this.client!.chat.completions.create({
          messages: [
            {
              role: 'system',
              content: strictRetry
                ? 'You are a behavioral simulation engine. Return ONLY strict JSON with top-level key "d". The value must be an array in the same order as the provided cases. Every case must appear exactly once. Each entry must be {"o":number,"c":number,"r":string}. "o" must be the zero-based option index.'
                : 'You are a behavioral simulation engine. Return ONLY strict JSON with top-level key "d". The value must be an array in the same order as the provided cases. Each entry must be {"o":number,"c":number,"r":string}. "o" must be the zero-based option index.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          model,
          temperature: strictRetry ? 0 : 0.2 + (averageComplexity * 0.15),
          max_tokens: Math.min(useReasoning ? 1800 : 1200, 180 + (items.length * 70)),
          ...(this.useJsonObjectMode ? { response_format: { type: 'json_object' as const } } : {}),
        });
      };

      return this.requestLimiter ? this.requestLimiter(execute) : execute();
    });

    const duration = Date.now() - startTime;
    this.recordDecisionCall({
      nodeId: items[0].nodeId,
      useReasoning,
      durationMs: duration,
      batchWaitMs,
      batchSize: items.length,
      totalTokens: completion.usage?.total_tokens || 0,
      promptTokens: completion.usage?.prompt_tokens || 0,
      responseTokens: completion.usage?.completion_tokens || 0,
      mode: 'batch',
    });

    const content = completion.choices[0]?.message?.content || '{}';
    const finishReason = completion.choices[0]?.finish_reason;
    if (!finishReason && content.length < 80) {
      this.llmTelemetry.invalidBatchPayloadCount += 1;
      throw new Error('Provider returned truncated batched response');
    }

    try {
      return this.parseBatchLLMResponse(content, items);
    } catch (error) {
      this.llmTelemetry.batchParseFailureCount += 1;
      throw error;
    }
  }

  private buildBatchPrompt(items: BatchEvaluationItem[]): string {
    const first = items[0];
    const { decisionNode, scenario, masterPersona } = first.request;
    const sharedPersonaContext = this.describeMasterPersonaContext(masterPersona)
      .replace(/^\nRicher persona context:\n/, '')
      .trim();
    const condensedPersonaContext = sharedPersonaContext.length > 500
      ? `${sharedPersonaContext.slice(0, 497)}...`
      : sharedPersonaContext;
    const optionList = decisionNode.options
      .map((option, index) => `${index}:${option.label}`)
      .join(' | ');
    const cases = items
      .map((item, index) => {
        const params = item.request.cloneParams;
        const state = item.request.state;
        const psychology = params.psychologyModifiers;

        return [
          `${index}. dims=[${[
            params.riskTolerance,
            params.timePreference,
            params.socialDependency,
            params.learningStyle,
            params.decisionSpeed,
            params.emotionalVolatility,
            params.executionGap,
            params.informationSeeking,
            params.stressResponse,
          ].map((value) => value.toFixed(2)).join(',')}]`,
          `psy=[${[
            psychology?.stressDiscountingAmplifier ?? 1,
            psychology?.socialPressureSensitivity ?? 1,
            psychology?.capitulationThreshold ?? 0.5,
          ].map((value) => value.toFixed(2)).join(',')}]`,
          `state=[capital:${state.capital.toFixed(0)},health:${state.health.toFixed(2)},happiness:${state.happiness.toFixed(2)},stress:${((state.metrics.stressLevel as number | undefined) ?? 0).toFixed(2)},time:${state.timeElapsed},decisions:${state.decisions.length}]`,
        ].join(' ');
      })
      .join('\n');

    return [
      `scenario=${scenario.name}`,
      condensedPersonaContext ? `persona=${condensedPersonaContext}` : '',
      `decision=${decisionNode.prompt}`,
      `options=${optionList}`,
      'Return JSON only. Use top-level {"d":[...]} and preserve case order.',
      'Each entry: {"o":<zero-based option index>,"c":<0.70-0.95 confidence>,"r":"<short reason>"}',
      'cases:',
      cases,
    ]
      .filter((section) => section.length > 0)
      .join('\n');
  }

  private parseBatchLLMResponse(
    content: string,
    items: BatchEvaluationItem[],
  ): Map<number, LLMEvaluation> {
    const parsed = parseJsonResponse<ParsedForkBatchResponse>(content);
    const result = new Map<number, LLMEvaluation>();
    const itemsById = new Map(items.map((item) => [item.requestId, item]));

    if (Array.isArray(parsed.d)) {
      parsed.d.forEach((rawEntry, index) => {
        const item = items[index];
        if (!item || typeof rawEntry !== 'object' || rawEntry === null) {
          return;
        }

        const evaluation = this.parseBatchEntry(rawEntry as ParsedForkBatchEntry, item);
        if (evaluation) {
          result.set(item.index, evaluation);
        }
      });
    }

    const legacyEntries = Array.isArray(parsed.decisions)
      ? parsed.decisions
      : Array.isArray(parsed.evaluations)
        ? parsed.evaluations
        : Array.isArray(parsed.choices)
          ? parsed.choices
          : [];

    for (const rawEntry of legacyEntries) {
      if (typeof rawEntry !== 'object' || rawEntry === null) {
        continue;
      }

      const entry = rawEntry as ParsedForkBatchEntry;
      const requestId = typeof entry.requestId === 'string'
        ? entry.requestId
        : typeof entry.caseId === 'string'
          ? entry.caseId
          : typeof entry.cloneId === 'string'
            ? entry.cloneId
            : null;

      if (!requestId) {
        continue;
      }

      const item = itemsById.get(requestId);
      if (!item) {
        continue;
      }

      const evaluation = this.parseBatchEntry(entry, item);
      if (evaluation) {
        result.set(item.index, evaluation);
      }
    }

    if (result.size === 0) {
      this.llmTelemetry.invalidBatchPayloadCount += 1;
      throw new Error('LLM returned batched JSON but no usable decisions');
    }

    return result;
  }

  private parseBatchEntry(
    entry: ParsedForkBatchEntry,
    item: BatchEvaluationItem,
  ): LLMEvaluation | null {
    const optionCount = item.request.decisionNode.options.length;
    let chosenOptionId: string | null = null;

    if (typeof entry.o === 'number' && Number.isFinite(entry.o)) {
      const roundedIndex = Math.round(entry.o);
      if (roundedIndex >= 0 && roundedIndex < optionCount) {
        chosenOptionId = item.request.decisionNode.options[roundedIndex].id;
      } else if (roundedIndex >= 1 && roundedIndex <= optionCount) {
        chosenOptionId = item.request.decisionNode.options[roundedIndex - 1].id;
      }
    }

    if (!chosenOptionId) {
      const candidateOptionId = entry.chosenOptionId ?? entry.option ?? entry.choice;
      chosenOptionId = typeof candidateOptionId === 'string'
        ? candidateOptionId
        : item.request.decisionNode.options[0].id;
    }

    const validOption = item.request.decisionNode.options.find((option) => option.id === chosenOptionId);
    const finalOptionId = validOption ? chosenOptionId : item.request.decisionNode.options[0].id;
    const reasoning = typeof entry.r === 'string'
      ? entry.r
      : typeof entry.reasoning === 'string'
        ? entry.reasoning
        : typeof entry.explanation === 'string'
          ? entry.explanation
          : 'No reasoning provided';
    const rawConfidence = typeof entry.c === 'number' && Number.isFinite(entry.c)
      ? entry.c
      : typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)
        ? entry.confidence
        : 0.8;

    return {
      chosenOptionId: finalOptionId,
      reasoning,
      confidence: Math.min(0.95, Math.max(0.7, rawConfidence)),
      complexity: item.complexity,
    };
  }

  private recordDecisionCall(options: {
    nodeId: string;
    useReasoning: boolean;
    durationMs: number;
    batchWaitMs: number;
    batchSize: number;
    totalTokens: number;
    promptTokens: number;
    responseTokens: number;
    mode: 'single' | 'batch';
  }): void {
    if (options.useReasoning) {
      this.usage.reasoningCalls += 1;
      this.llmTelemetry.reasoningCalls += 1;
    } else {
      this.usage.standardCalls += 1;
      this.llmTelemetry.standardCalls += 1;
    }

    this.usage.totalTokens += options.totalTokens;
    this.llmTelemetry.totalTokens += options.totalTokens;
    this.llmTelemetry.totalDecisionEvaluations += options.batchSize;
    this.llmTelemetry.totalChatDurationMs += options.durationMs;
    this.llmTelemetry.totalBatchWaitMs += options.batchWaitMs;
    this.llmTelemetry.maxBatchSize = Math.max(this.llmTelemetry.maxBatchSize, options.batchSize);

    if (options.mode === 'batch') {
      this.llmTelemetry.batchCalls += 1;
      this.llmTelemetry.batchPromptTokens += options.promptTokens;
      this.llmTelemetry.batchResponseTokens += options.responseTokens;
    } else {
      this.llmTelemetry.singleCalls += 1;
      this.llmTelemetry.singlePromptTokens += options.promptTokens;
      this.llmTelemetry.singleResponseTokens += options.responseTokens;
    }

    const currentNode = this.nodeTelemetry.get(options.nodeId) ?? createEmptyNodeTelemetry(options.nodeId);
    if (options.mode === 'batch') {
      currentNode.batchCalls += 1;
    } else {
      currentNode.singleCalls += 1;
    }
    if (options.useReasoning) {
      currentNode.reasoningCalls += 1;
    } else {
      currentNode.standardCalls += 1;
    }
    currentNode.cloneDecisions += options.batchSize;
    currentNode.totalDurationMs += options.durationMs;
    currentNode.totalModelDurationMs += options.durationMs;
    currentNode.totalBatchWaitMs += options.batchWaitMs;
    currentNode.totalBatchSize += options.batchSize;
    currentNode.maxBatchSize = Math.max(currentNode.maxBatchSize, options.batchSize);
    this.nodeTelemetry.set(options.nodeId, currentNode);
  }

  private recordBatchRetry(nodeId?: string): void {
    this.llmTelemetry.batchRetryCount += 1;
    if (!nodeId) {
      return;
    }

    const currentNode = this.nodeTelemetry.get(nodeId) ?? createEmptyNodeTelemetry(nodeId);
    currentNode.splitRetries += 1;
    this.nodeTelemetry.set(nodeId, currentNode);
  }

  private recordSplitBatch(
    nodeId?: string,
    scenarioId?: string,
    useReasoning: boolean = false,
    batchSize?: number,
  ): void {
    this.llmTelemetry.splitBatchCount += 1;
    if (!nodeId) {
      return;
    }

    const currentNode = this.nodeTelemetry.get(nodeId) ?? createEmptyNodeTelemetry(nodeId);
    currentNode.splitRetries += 1;
    this.nodeTelemetry.set(nodeId, currentNode);

    if (scenarioId && typeof batchSize === 'number' && batchSize > 1) {
      const profileKey = this.getBatchProfileKey(scenarioId, useReasoning);
      const nextCeiling = Math.max(1, Math.ceil(batchSize / 2));
      const currentCeiling = this.batchSizeCeilings.get(profileKey);
      this.batchSizeCeilings.set(
        profileKey,
        typeof currentCeiling === 'number'
          ? Math.min(currentCeiling, nextCeiling)
          : nextCeiling,
      );
    }
  }

  private getBatchProfileKey(scenarioId: string, useReasoning: boolean): string {
    return `${scenarioId}:${useReasoning ? 'reasoning' : 'standard'}`;
  }

  private recordEmbeddingCall(textCount: number, durationMs: number): void {
    this.embeddingTelemetry.calls += 1;
    this.embeddingTelemetry.batchCalls += 1;
    this.embeddingTelemetry.totalTexts += textCount;
    this.embeddingTelemetry.totalDurationMs += durationMs;
  }


  private async callWithRetry<T>(fn: () => Promise<T>, maxRetries: number = 3): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (!this.isRateLimitError(error) || attempt >= maxRetries) {
          if (this.isRateLimitError(error)) {
            this.llmTelemetry.rateLimitErrors += 1;
          }
          throw error;
        }

        this.llmTelemetry.rateLimitErrors += 1;
        this.llmTelemetry.rateLimitRetries += 1;
        const delayMs = this.getRetryDelayMs(error, attempt);
        logger.warn({ attempt: attempt + 1, delayMs }, 'LLM rate limited, retrying');
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error('Max retries exceeded');
  }

  private isRateLimitError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    const candidate = error as {
      status?: number;
      code?: string;
      response?: { status?: number };
    };

    return candidate.status === 429 || candidate.response?.status === 429 || candidate.code === 'rate_limit_exceeded';
  }

  private getRetryDelayMs(error: unknown, attempt: number): number {
    const retryAfterMs = this.parseRetryAfterMs(error);
    const baseDelayMs = retryAfterMs ?? Math.pow(2, attempt) * 1000;
    const jitterMultiplier = 0.8 + (Math.random() * 0.4);

    return Math.max(100, Math.round(baseDelayMs * jitterMultiplier));
  }

  private parseRetryAfterMs(error: unknown): number | null {
    if (typeof error !== 'object' || error === null) {
      return null;
    }

    const candidate = error as {
      headers?: Record<string, string | undefined> | Headers;
      response?: {
        headers?: Record<string, string | undefined> | Headers;
      };
    };

    const headerValue =
      this.readRetryAfterHeader(candidate.headers) ??
      this.readRetryAfterHeader(candidate.response?.headers);

    if (!headerValue) {
      return null;
    }

    const seconds = Number.parseFloat(headerValue);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }

    const dateMs = Date.parse(headerValue);
    if (Number.isNaN(dateMs)) {
      return null;
    }

    return Math.max(0, dateMs - Date.now());
  }

  private readRetryAfterHeader(
    headers: Record<string, string | undefined> | Headers | undefined
  ): string | null {
    if (!headers) {
      return null;
    }

    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get('retry-after');
    }

    const headerMap = headers as Record<string, string | undefined>;
    const value = headerMap['retry-after'] ?? headerMap['Retry-After'];
    return value ?? null;
  }

  private buildPrompt(request: ForkEvaluationRequest): string {
    const { cloneParams, decisionNode, state, scenario } = request;

    const traitDescriptions = this.describeTraits(cloneParams);
    const stateDescription = this.describeState(state);
    const psychologyBlock = this.describePsychologyModifiers(cloneParams, scenario.id, request.masterPersona);
    const personaContextBlock = this.describeMasterPersonaContext(request.masterPersona);

    const optionIds = decisionNode.options.map(o => o.id).join(', ');
    const optionsList = decisionNode.options.map((opt, i) =>
      `${i + 1}. ${opt.label} (id: "${opt.id}")`
    ).join('\n');

    return `Behavioral clone traits:
${traitDescriptions}
${psychologyBlock}${personaContextBlock}
Current state:
${stateDescription}

Decision: ${decisionNode.prompt}

Options:
${optionsList}

Which option does this persona choose?

Respond with JSON containing exactly these three keys:
- "chosenOptionId": string — must be one of [${optionIds}]
- "reasoning": string — one sentence, under 20 words
- "confidence": number — between 0.7 and 0.95`;
  }

  private describeMasterPersonaContext(
    masterPersona?: import('../persona/personaCompressor.js').MasterPersona
  ): string {
    const narrative = masterPersona?.llmContextSummary?.trim();
    if (!narrative) {
      return '';
    }

    const condensedNarrative = narrative.length > 1400
      ? `${narrative.slice(0, 1397)}...`
      : narrative;

    return `\nRicher persona context:\n${condensedNarrative}`;
  }

  private describePsychologyModifiers(
    params: CloneParameters,
    scenarioId: string,
    masterPersona?: import('../persona/personaCompressor.js').MasterPersona
  ): string {
    const lines: string[] = [];

    if (params.psychologyModifiers) {
      const m = params.psychologyModifiers;
      const hasModifications =
        (m.stressDiscountingAmplifier !== undefined && m.stressDiscountingAmplifier !== 1.0) ||
        (m.socialPressureSensitivity !== undefined && m.socialPressureSensitivity !== 1.0) ||
        (m.capitulationThreshold !== undefined && m.capitulationThreshold !== 0.5);

      if (hasModifications) {
        lines.push('\nBehavioral psychology modifiers for this clone:');
        if (m.stressDiscountingAmplifier !== undefined && m.stressDiscountingAmplifier !== 1.0) {
          lines.push(`- Stress discounting amplifier: ${m.stressDiscountingAmplifier}x (this clone makes more present-biased choices under pressure)`);
        }
        if (m.socialPressureSensitivity !== undefined && m.socialPressureSensitivity !== 1.0) {
          lines.push(`- Social pressure sensitivity: ${m.socialPressureSensitivity}x (social context shifts this clone's choices more than average)`);
        }
        if (m.capitulationThreshold !== undefined) {
          lines.push(`- Capitulation threshold: ${m.capitulationThreshold} (below 0.5 = more likely to exit positions early under adversity)`);
        }
      }
    }

    if (masterPersona?.psychologicalProfile) {
      const relevantFlags = masterPersona.psychologicalProfile.riskFlags
        .filter(f => f.affectedScenarios.includes(scenarioId))
        .map(f => `WARNING — ${f.flag} [${f.severity}]: ${f.description}`);
      if (relevantFlags.length > 0) {
        lines.push('\nRelevant risk flags for this scenario:');
        lines.push(...relevantFlags);
      }
    }

    return lines.length > 0 ? lines.join('\n') : '';
  }

  private describeTraits(params: CloneParameters): string {
    const descriptions: string[] = [];

    const getSuffix = (dim: string) => {
      if (!params.confidenceScores) return '';
      const conf = params.confidenceScores[dim];
      if (conf === undefined) return '';
      if (conf < 0.4) return ' (Low Confidence: Based on sparse/estimated data, this might be inaccurate)';
      if (conf > 0.8) return ' (High Confidence: Verified across multiple reliable sources)';
      return '';
    };

    if (params.riskTolerance > 0.7) {
      descriptions.push(`- High risk tolerance: willing to take bold chances${getSuffix('riskTolerance')}`);
    } else if (params.riskTolerance < 0.3) {
      descriptions.push(`- Risk averse: prefers safe, proven options${getSuffix('riskTolerance')}`);
    }

    if (params.decisionSpeed > 0.7) {
      descriptions.push(`- Fast decision maker: acts quickly, sometimes impulsively${getSuffix('decisionSpeed')}`);
    } else if (params.decisionSpeed < 0.3) {
      descriptions.push(`- Deliberate: analyzes carefully before acting${getSuffix('decisionSpeed')}`);
    }

    if (params.timePreference > 0.7) {
      descriptions.push(`- Impatient: prefers immediate gratification${getSuffix('timePreference')}`);
    } else if (params.timePreference < 0.3) {
      descriptions.push(`- Patient: willing to delay rewards for better outcomes${getSuffix('timePreference')}`);
    }

    if (params.emotionalVolatility > 0.7) {
      descriptions.push(`- Emotionally volatile: feelings strongly influence decisions${getSuffix('emotionalVolatility')}`);
    } else if (params.emotionalVolatility < 0.3) {
      descriptions.push(`- Emotionally stable: keeps feelings separate from decisions${getSuffix('emotionalVolatility')}`);
    }

    if (params.socialDependency > 0.7) {
      descriptions.push(`- Socially dependent: considers others' opinions heavily${getSuffix('socialDependency')}`);
    } else if (params.socialDependency < 0.3) {
      descriptions.push(`- Independent: makes decisions without social input${getSuffix('socialDependency')}`);
    }

    if (params.learningStyle > 0.7) {
      descriptions.push(`- Theoretical learner: prefers understanding before doing${getSuffix('learningStyle')}`);
    } else if (params.learningStyle < 0.3) {
      descriptions.push(`- Experiential learner: learns by doing${getSuffix('learningStyle')}`);
    }

    if (params.executionGap > 0.7) {
      descriptions.push(`- High execution gap: struggles to follow through on plans${getSuffix('executionGap')}`);
    } else if (params.executionGap < 0.3) {
      descriptions.push(`- Low execution gap: consistently follows through on commitments${getSuffix('executionGap')}`);
    }

    if (params.informationSeeking > 0.7) {
      descriptions.push(`- High information seeking: obsessively researches before deciding${getSuffix('informationSeeking')}`);
    } else if (params.informationSeeking < 0.3) {
      descriptions.push(`- Low information seeking: accepts info at face value${getSuffix('informationSeeking')}`);
    }

    if (params.stressResponse > 0.7) {
      descriptions.push(`- Poor stress response: shuts down or freezes under pressure${getSuffix('stressResponse')}`);
    } else if (params.stressResponse < 0.3) {
      descriptions.push(`- Resilient stress response: thrives and focuses sharply under pressure${getSuffix('stressResponse')}`);
    }

    return descriptions.join('\n') || '- Moderate on all behavioral dimensions';
  }

  private describeState(state: SimulationState): string {
    const parts: string[] = [];

    parts.push(`- Capital: $${state.capital.toFixed(0)}`);
    parts.push(`- Health: ${(state.health * 100).toFixed(0)}%`);
    parts.push(`- Happiness: ${(state.happiness * 100).toFixed(0)}%`);
    parts.push(`- Time elapsed: ${state.timeElapsed} months`);

    const stressLevel = state.metrics.stressLevel;
    if (typeof stressLevel === 'number') {
      parts.push(`- Stress level: ${(stressLevel * 100).toFixed(0)}%`);
    }

    if (state.decisions.length > 0) {
      parts.push(`- Previous decisions: ${state.decisions.length}`);
    }

    return parts.join('\n');
  }

  private parseLLMResponse(
    content: string,
    decisionNode: DecisionNode,
    complexity: number
  ): LLMEvaluation {
    const parsed = parseJsonResponse<ParsedForkResponse>(content);

    const candidateOptionId = parsed.chosenOptionId ?? parsed.option ?? parsed.choice;
    const chosenOptionId = typeof candidateOptionId === 'string'
      ? candidateOptionId
      : decisionNode.options[0].id;

    const validOption = decisionNode.options.find(o => o.id === chosenOptionId);
    const finalOptionId = validOption ? chosenOptionId : decisionNode.options[0].id;
    const reasoning = typeof parsed.reasoning === 'string'
      ? parsed.reasoning
      : typeof parsed.explanation === 'string'
        ? parsed.explanation
        : 'No reasoning provided';
    const rawConfidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? parsed.confidence
      : 0.8;

    return {
      chosenOptionId: finalOptionId,
      reasoning,
      confidence: Math.min(0.95, Math.max(0.7, rawConfidence)),
      complexity,
    };
  }

  public async heuristicEvaluation(
    request: ForkEvaluationRequest,
    complexity: number
  ): Promise<LLMEvaluation> {
    const { cloneParams, decisionNode, state } = request;

    if (EmbeddingService.isAvailable()) {
      try {
        const concepts = await this.getHeuristicConceptEmbeddings();
        const optionEmbeddings = await this.getOptionEmbeddings(decisionNode.options);
        const semanticSelection = this.chooseSemanticOption(decisionNode.options, optionEmbeddings, cloneParams, state, concepts);

        if (semanticSelection) {
          return {
            chosenOptionId: semanticSelection.option.id,
            reasoning: semanticSelection.reasoning,
            confidence: 0.6,
            complexity,
          };
        }
      } catch (error) {
        logger.warn({ error }, 'Embedding-based heuristic fallback failed, using keyword heuristic');
      }
    }

    let bestOption = decisionNode.options[0];
    let bestScore = -Infinity;

    for (const option of decisionNode.options) {
      let score = 0;
      const label = option.label.toLowerCase();

      if (cloneParams.riskTolerance > 0.7) {
        if (label.includes('aggressive') || label.includes('bold') || label.includes('all-in')) {
          score += 2;
        }
      } else if (cloneParams.riskTolerance < 0.3) {
        if (label.includes('safe') || label.includes('cautious') || label.includes('preserve')) {
          score += 2;
        }
      }

      if (cloneParams.decisionSpeed > 0.7) {
        if (label.includes('now') || label.includes('immediate') || label.includes('start')) {
          score += 1;
        }
      } else if (cloneParams.decisionSpeed < 0.3) {
        if (label.includes('plan') || label.includes('analyze') || label.includes('research')) {
          score += 1;
        }
      }

      if (cloneParams.socialDependency > 0.7) {
        if (label.includes('partner') || label.includes('team') || label.includes('network')) {
          score += 1;
        }
      }

      if (cloneParams.executionGap > 0.7) {
        if (label.includes('abandon') || label.includes('procrastinate') || label.includes('skip') || label.includes('drop')) {
          score += 1;
        }
      } else if (cloneParams.executionGap < 0.3) {
        if (label.includes('finish') || label.includes('complete') || label.includes('execute') || label.includes('commit')) {
          score += 1;
        }
      }

      if (cloneParams.informationSeeking > 0.7) {
        if (label.includes('research') || label.includes('investigate') || label.includes('verify') || label.includes('gather')) {
          score += 1;
        }
      } else if (cloneParams.informationSeeking < 0.3) {
        if (label.includes('accept') || label.includes('ignore') || label.includes('trust') || label.includes('skip research')) {
          score += 1;
        }
      }

      if (cloneParams.stressResponse > 0.7) {
        if (label.includes('panic') || label.includes('freeze') || label.includes('quit') || label.includes('collapse')) {
          score += 1;
        }
      } else if (cloneParams.stressResponse < 0.3) {
        if (label.includes('focus') || label.includes('persist') || label.includes('handle') || label.includes('thrive')) {
          score += 1;
        }
      }

      if ((state.capital < 10000 && label.includes('quit')) || label.includes('stop')) {
        score += 1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestOption = option;
      }
    }

    return {
      chosenOptionId: bestOption.id,
      reasoning: `Heuristic selection based on riskTolerance=${cloneParams.riskTolerance.toFixed(2)}, decisionSpeed=${cloneParams.decisionSpeed.toFixed(2)}`,
      confidence: 0.6,
      complexity,
    };
  }

  private async getHeuristicConceptEmbeddings(): Promise<HeuristicConceptEmbeddings> {
    if (ForkEvaluator.heuristicConceptEmbeddings) {
      return ForkEvaluator.heuristicConceptEmbeddings;
    }

    const service = EmbeddingService.getInstance();
    const keys = Object.keys(HEURISTIC_CONCEPT_TEXTS) as Array<keyof HeuristicConceptEmbeddings>;
    const startedAt = Date.now();
    const embeddings = await service.embedBatch(keys.map(key => HEURISTIC_CONCEPT_TEXTS[key]));
    this.recordEmbeddingCall(keys.length, Date.now() - startedAt);

    ForkEvaluator.heuristicConceptEmbeddings = keys.reduce((acc, key, index) => {
      acc[key] = embeddings[index];
      return acc;
    }, {} as HeuristicConceptEmbeddings);

    return ForkEvaluator.heuristicConceptEmbeddings;
  }

  private async getOptionEmbeddings(options: DecisionOption[]): Promise<Map<string, number[]>> {
    const service = EmbeddingService.getInstance();
    const texts = options.map(option => `${option.label}. ${option.value}`);
    const startedAt = Date.now();
    const embeddings = await service.embedBatch(texts);
    this.recordEmbeddingCall(texts.length, Date.now() - startedAt);
    const map = new Map<string, number[]>();

    options.forEach((option, index) => {
      map.set(option.id, embeddings[index]);
    });

    return map;
  }

  private chooseSemanticOption(
    options: DecisionOption[],
    optionEmbeddings: Map<string, number[]>,
    cloneParams: CloneParameters,
    state: SimulationState,
    concepts: HeuristicConceptEmbeddings
  ): { option: DecisionOption; reasoning: string } | null {
    let bestOption: DecisionOption | null = null;
    let bestScore = -Infinity;

    for (const option of options) {
      const embedding = optionEmbeddings.get(option.id);
      if (!embedding) {
        continue;
      }

      let score = 0;

      score += this.scorePole(cloneParams.riskTolerance, embedding, concepts.cautiousPreservation, concepts.aggressiveRisk, 2.2);
      score += this.scorePole(cloneParams.decisionSpeed, embedding, concepts.deliberatePlanning, concepts.immediateAction, 1.4);
      score += this.scorePole(cloneParams.socialDependency, embedding, concepts.independentAction, concepts.collaborativeAction, 1.1);
      score += this.scorePole(cloneParams.timePreference, embedding, concepts.longTermPatience, concepts.immediateAction, 1.3);
      score += this.scorePole(cloneParams.learningStyle, embedding, concepts.experientialLearning, concepts.theoreticalLearning, 1.0);
      score += this.scorePole(cloneParams.emotionalVolatility, embedding, concepts.cautiousPreservation, concepts.emotionalImpulse, 0.9);
      score += this.scorePole(cloneParams.executionGap, embedding, concepts.flawlessExecution, concepts.abandonedExecution, 1.2);
      score += this.scorePole(cloneParams.informationSeeking, embedding, concepts.superficialAcceptance, concepts.exhaustiveResearch, 1.0);
      score += this.scorePole(cloneParams.stressResponse, embedding, concepts.stressResilience, concepts.stressCollapse, 1.5);

      if (state.capital < 10000) {
        score += cosineSimilarity(embedding, concepts.exitPreservation) * 0.9;
        score += cosineSimilarity(embedding, concepts.cautiousPreservation) * 0.7;
      }

      if (score > bestScore) {
        bestScore = score;
        bestOption = option;
      }
    }

    if (!bestOption) {
      return null;
    }

    return {
      option: bestOption,
      reasoning: `Semantic heuristic selected ${bestOption.label} from cosine alignment with dominant clone traits`,
    };
  }

  private scorePole(
    traitValue: number,
    optionEmbedding: number[],
    lowConcept: number[],
    highConcept: number[],
    weight: number
  ): number {
    const direction = cosineSimilarity(optionEmbedding, highConcept) - cosineSimilarity(optionEmbedding, lowConcept);
    return (traitValue - 0.5) * 2 * direction * weight;
  }

  getUsage(): LLMUsage {
    return { ...this.usage };
  }

  getTelemetry(): {
    llm: SimulationLlmRuntimeTelemetry;
    embeddings: SimulationEmbeddingRuntimeTelemetry;
  } {
    return {
      llm: {
        ...this.llmTelemetry,
        nodeStats: Array.from(this.nodeTelemetry.values()).sort((left, right) =>
          right.totalDurationMs - left.totalDurationMs,
        ),
      },
      embeddings: { ...this.embeddingTelemetry },
    };
  }

  resetUsage(): void {
    this.usage = {
      standardCalls: 0,
      reasoningCalls: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };
    this.llmTelemetry = createEmptyLlmTelemetry();
    this.embeddingTelemetry = createEmptyEmbeddingTelemetry();
    this.nodeTelemetry.clear();
  }

  isAvailable(): {
    llm: boolean;
    reasoning: boolean;
    heuristicOnly: boolean;
  } {
    return {
      llm: this.client !== null,
      reasoning: this.reasoningModel !== null,
      heuristicOnly: this.client === null,
    };
  }
}

export const forkEvaluator = new ForkEvaluator();

export function createForkEvaluator(options: ForkEvaluatorOptions = {}): ForkEvaluator {
  return new ForkEvaluator(options);
}

export async function evaluateDecision(
  cloneParams: CloneParameters,
  decisionNode: DecisionNode,
  state: SimulationState,
  scenarioId: string
): Promise<LLMEvaluation> {
  const evaluator = forkEvaluator;
  const scenario = getScenario(scenarioId);

  return await evaluator.evaluateFork({
    cloneParams,
    decisionNode,
    state,
    scenario,
  });
}

export async function evaluateBatch(
  requests: ForkEvaluationRequest[],
  maxReasoningCalls: number = 20
): Promise<LLMEvaluation[]> {
  const evaluator = forkEvaluator;
  const results: LLMEvaluation[] = [];
  let remainingReasoning = maxReasoningCalls;

  for (const request of requests) {
    const result = await evaluator.evaluateFork(request, remainingReasoning);
    results.push(result);

    if (result.complexity > 0.6) {
      remainingReasoning--;
    }
  }

  return results;
}

export { calculateComplexity };
function calculateComplexity(
  decisionNode: DecisionNode,
  cloneParams: CloneParameters,
  state: SimulationState
): number {
  return forkEvaluator.calculateComplexity(decisionNode, cloneParams, state);
}

export function estimateEvaluationCost(
  totalDecisions: number,
  complexDecisionRatio: number = 0.3
): {
  standardCalls: number;
  reasoningCalls: number;
  estimatedCost: number;
  totalTokens: number;
} {
  const complexCount = Math.floor(totalDecisions * complexDecisionRatio);
  const simpleCount = totalDecisions - complexCount;

  const tokensPerCall = 500;
  const reasoningTokensPerCall = 600;

  const standardCost = simpleCount * tokensPerCall * 0.0000005;
  const reasoningCost = Math.min(complexCount, 20) * reasoningTokensPerCall * 0.000001;

  return {
    standardCalls: simpleCount,
    reasoningCalls: Math.min(complexCount, 20),
    estimatedCost: standardCost + reasoningCost,
    totalTokens: simpleCount * tokensPerCall + Math.min(complexCount, 20) * reasoningTokensPerCall,
  };
}
