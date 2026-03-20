import OpenAI from 'openai';
import {
  DecisionNode,
  DecisionOption,
  SimulationState,
  LLMEvaluation,
  ForkEvaluationRequest,
  CloneParameters,
} from './types.js';
import { getScenario } from './decisionGraph.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { EmbeddingService, cosineSimilarity } from '../embeddings/embeddingService.js';
import { type RateLimiter } from '../utils/rateLimiter.js';

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
};

interface ForkEvaluatorOptions {
  rateLimiter?: RateLimiter | null;
}

export class ForkEvaluator {
  private static heuristicConceptEmbeddings: HeuristicConceptEmbeddings | null = null;

  private client: OpenAI | null = null;
  private model: string;
  private reasoningModel: string | null;
  private rateLimiter: RateLimiter | null;
  private usage: LLMUsage = {
    standardCalls: 0,
    reasoningCalls: 0,
    totalTokens: 0,
    estimatedCost: 0,
  };

  private readonly MAX_REASONING_CALLS = 20;
  private readonly COMPLEXITY_THRESHOLD = 0.6;

  constructor(options: ForkEvaluatorOptions = {}) {
    this.rateLimiter = options.rateLimiter ?? null;

    if (config.llm?.apiKey) {
      this.client = new OpenAI({
        apiKey: config.llm.apiKey,
        baseURL: config.llm.baseUrl || 'https://api.groq.com/openai/v1',
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
    } catch (error) {
      logger.error({ error, scenario: scenario.id }, 'LLM evaluation failed, using heuristic fallback');
      return await this.heuristicEvaluation(request, complexity);
    }
  }

  setRateLimiter(rateLimiter: RateLimiter | null): void {
    this.rateLimiter = rateLimiter;
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
    useReasoning: boolean
  ): Promise<LLMEvaluation> {
    if (!this.client) {
      throw new Error('LLM client not initialized - set OPENROUTER_API_KEY or GROQ_API_KEY');
    }

    const prompt = this.buildPrompt(request);
    const model = (useReasoning && this.reasoningModel) ? this.reasoningModel : this.model;

    const startTime = Date.now();

    const completion = await this.callWithRetry(async () => {
      if (this.rateLimiter) {
        await this.rateLimiter.acquire();
      }

      return this.client!.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: 'You are a behavioral simulation engine. Given a persona with specific behavioral traits and a decision context, determine which option they would choose. Respond ONLY with JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        model,
        temperature: 0.4 + (complexity * 0.3),
        max_tokens: useReasoning ? 200 : 150,
        response_format: { type: 'json_object' },
      });
    });

    const duration = Date.now() - startTime;

    if (useReasoning) {
      this.usage.reasoningCalls++;
    } else {
      this.usage.standardCalls++;
    }
    this.usage.totalTokens += completion.usage?.total_tokens || 0;

    logger.debug({ duration, model, complexity, useReasoning }, 'LLM evaluation completed');

    return this.parseLLMResponse(
      completion.choices[0]?.message?.content || '{}',
      request.decisionNode,
      complexity
    );
  }

  private async callWithRetry<T>(fn: () => Promise<T>, maxRetries: number = 3): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (!this.isRateLimitError(error) || attempt >= maxRetries) {
          throw error;
        }

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
    const { cloneParams, decisionNode, state } = request;

    const traitDescriptions = this.describeTraits(cloneParams);
    const stateDescription = this.describeState(state);

    const optionsList = decisionNode.options.map((opt, i) =>
      `${i + 1}. ${opt.label} (ID: ${opt.id})`
    ).join('\n');

    return `
You are simulating a behavioral clone with the following traits:
${traitDescriptions}

Current State:
${stateDescription}

Decision: ${decisionNode.prompt}

Options:
${optionsList}

Based on the persona's behavioral traits, which option would they choose?

Respond with JSON in this format:
{
  "chosenOptionId": "option_id_here",
  "reasoning": "brief explanation of why this persona would choose this option based on their traits",
  "confidence": 0.85
}

The confidence should be 0.7-0.95 based on how clear the choice is given the traits.`;
  }

  private describeTraits(params: CloneParameters): string {
    const descriptions: string[] = [];

    if (params.riskTolerance > 0.7) {
      descriptions.push('- High risk tolerance: willing to take bold chances');
    } else if (params.riskTolerance < 0.3) {
      descriptions.push('- Risk averse: prefers safe, proven options');
    }

    if (params.decisionSpeed > 0.7) {
      descriptions.push('- Fast decision maker: acts quickly, sometimes impulsively');
    } else if (params.decisionSpeed < 0.3) {
      descriptions.push('- Deliberate: analyzes carefully before acting');
    }

    if (params.timePreference > 0.7) {
      descriptions.push('- Impatient: prefers immediate gratification');
    } else if (params.timePreference < 0.3) {
      descriptions.push('- Patient: willing to delay rewards for better outcomes');
    }

    if (params.emotionalVolatility > 0.7) {
      descriptions.push('- Emotionally volatile: feelings strongly influence decisions');
    } else if (params.emotionalVolatility < 0.3) {
      descriptions.push('- Emotionally stable: keeps feelings separate from decisions');
    }

    if (params.socialDependency > 0.7) {
      descriptions.push('- Socially dependent: considers others\' opinions heavily');
    } else if (params.socialDependency < 0.3) {
      descriptions.push('- Independent: makes decisions without social input');
    }

    if (params.learningStyle > 0.7) {
      descriptions.push('- Theoretical learner: prefers understanding before doing');
    } else if (params.learningStyle < 0.3) {
      descriptions.push('- Experiential learner: learns by doing');
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
    try {
      const parsed = JSON.parse(content);

      const chosenOptionId = parsed.chosenOptionId ||
        parsed.option ||
        parsed.choice ||
        decisionNode.options[0].id;

      const validOption = decisionNode.options.find(o => o.id === chosenOptionId);
      const finalOptionId = validOption ? chosenOptionId : decisionNode.options[0].id;

      return {
        chosenOptionId: finalOptionId,
        reasoning: parsed.reasoning || parsed.explanation || 'No reasoning provided',
        confidence: Math.min(0.95, Math.max(0.7, parsed.confidence || 0.8)),
        complexity,
      };
    } catch (error) {
      logger.warn({ content, error }, 'Failed to parse LLM response');

      return {
        chosenOptionId: decisionNode.options[0].id,
        reasoning: 'Parsing failed, defaulting to first option',
        confidence: 0.5,
        complexity,
      };
    }
  }

  private async heuristicEvaluation(
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
    const embeddings = await service.embedBatch(keys.map(key => HEURISTIC_CONCEPT_TEXTS[key]));

    ForkEvaluator.heuristicConceptEmbeddings = keys.reduce((acc, key, index) => {
      acc[key] = embeddings[index];
      return acc;
    }, {} as HeuristicConceptEmbeddings);

    return ForkEvaluator.heuristicConceptEmbeddings;
  }

  private async getOptionEmbeddings(options: DecisionOption[]): Promise<Map<string, number[]>> {
    const service = EmbeddingService.getInstance();
    const texts = options.map(option => `${option.label}. ${option.value}`);
    const embeddings = await service.embedBatch(texts);
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

  resetUsage(): void {
    this.usage = {
      standardCalls: 0,
      reasoningCalls: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };
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
