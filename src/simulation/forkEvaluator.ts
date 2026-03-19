// LLM Fork Evaluator - Single OpenAI SDK client with configurable baseURL
// Works with any OpenAI-compatible API: Groq, OpenRouter, OpenAI, Together, etc.
// Complexity threshold: >0.6 = reasoning model, with max 20 reasoning calls per simulation

import OpenAI from 'openai';
import {
  DecisionNode,
  SimulationState,
  LLMEvaluation,
  ForkEvaluationRequest,
  CloneParameters,
  Scenario,
} from './types.js';
import { getScenario } from './decisionGraph.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

// LLM Call tracking
interface LLMUsage {
  standardCalls: number;
  reasoningCalls: number;
  totalTokens: number;
  estimatedCost: number;
}

export class ForkEvaluator {
  private client: OpenAI | null = null;
  private model: string;
  private reasoningModel: string | null;
  private usage: LLMUsage = {
    standardCalls: 0,
    reasoningCalls: 0,
    totalTokens: 0,
    estimatedCost: 0,
  };

  private readonly MAX_REASONING_CALLS = 20;
  private readonly COMPLEXITY_THRESHOLD = 0.6;

  constructor() {
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

  // Evaluate a decision fork for a clone
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
      return this.heuristicEvaluation(request, complexity);
    }
  }

  // Calculate complexity score (0-1)
  calculateComplexity(
    decisionNode: DecisionNode,
    cloneParams: CloneParameters,
    state: SimulationState
  ): number {
    let complexity = 0;
    const factors: number[] = [];

    // Factor 1: Number of options (more options = more complex)
    const optionCount = decisionNode.options.length;
    factors.push(Math.min(1, optionCount / 5));

    // Factor 2: Financial stakes (high capital = high stakes)
    const capitalAtRisk = Math.abs(state.capital) / 100000;
    factors.push(Math.min(1, capitalAtRisk));

    // Factor 3: Time pressure (low timeElapsed relative to typical scenario)
    const timePressure = state.timeElapsed < 3 ? 0.3 : 0;
    factors.push(timePressure);

    // Factor 4: Clone behavioral complexity
    // High risk tolerance with emotional volatility = complex decision
    const behavioralComplexity =
      (cloneParams.riskTolerance * cloneParams.emotionalVolatility +
       cloneParams.decisionSpeed * (1 - cloneParams.timePreference)) / 2;
    factors.push(behavioralComplexity);

    // Factor 5: Scenario requires evaluation flag
    const requiresDeepThought = decisionNode.options.some(o => o.requiresEvaluation) ? 0.3 : 0;
    factors.push(requiresDeepThought);

    // Factor 6: Contradictions in state (high stress + high stakes)
    const stressVal = state.metrics.stressLevel;
    const stateStress = typeof stressVal === 'number' ? stressVal : 0;
    const contradictionFactor = stateStress * capitalAtRisk;
    factors.push(Math.min(1, contradictionFactor));

    // Weighted average
    const weights = [0.2, 0.25, 0.1, 0.2, 0.15, 0.1];
    complexity = factors.reduce((sum, f, i) => sum + f * weights[i], 0);

    return Math.min(1, Math.max(0, complexity));
  }

  // Call LLM (unified OpenAI SDK client)
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

    const completion = await this.client.chat.completions.create({
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

  // Build prompt for LLM
  private buildPrompt(request: ForkEvaluationRequest): string {
    const { cloneParams, decisionNode, state, scenario } = request;

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

  // Describe clone traits for prompt
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

  // Describe current state for prompt
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

  // Parse LLM response
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

      // Validate option exists
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

      // Fallback to first option
      return {
        chosenOptionId: decisionNode.options[0].id,
        reasoning: 'Parsing failed, defaulting to first option',
        confidence: 0.5,
        complexity,
      };
    }
  }

  // Heuristic evaluation when LLM unavailable
  private heuristicEvaluation(
    request: ForkEvaluationRequest,
    complexity: number
  ): LLMEvaluation {
    const { cloneParams, decisionNode, state } = request;

    // Simple heuristic based on trait matching
    let bestOption = decisionNode.options[0];
    let bestScore = -Infinity;

    for (const option of decisionNode.options) {
      let score = 0;
      const label = option.label.toLowerCase();

      // Risk matching
      if (cloneParams.riskTolerance > 0.7) {
        if (label.includes('aggressive') || label.includes('bold') || label.includes('all-in')) {
          score += 2;
        }
      } else if (cloneParams.riskTolerance < 0.3) {
        if (label.includes('safe') || label.includes('cautious') || label.includes('preserve')) {
          score += 2;
        }
      }

      // Speed matching
      if (cloneParams.decisionSpeed > 0.7) {
        if (label.includes('now') || label.includes('immediate') || label.includes('start')) {
          score += 1;
        }
      } else if (cloneParams.decisionSpeed < 0.3) {
        if (label.includes('plan') || label.includes('analyze') || label.includes('research')) {
          score += 1;
        }
      }

      // Social matching
      if (cloneParams.socialDependency > 0.7) {
        if (label.includes('partner') || label.includes('team') || label.includes('network')) {
          score += 1;
        }
      }

      // Capital stress adjustment
      if (state.capital < 10000 && label.includes('quit') || label.includes('stop')) {
        score += 1; // Prefer exit when broke
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

  // Get usage stats
  getUsage(): LLMUsage {
    return { ...this.usage };
  }

  // Reset usage stats
  resetUsage(): void {
    this.usage = {
      standardCalls: 0,
      reasoningCalls: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };
  }

  // Check if LLM services are available
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

// Export singleton instance
export const forkEvaluator = new ForkEvaluator();

// Export factory for fresh instances (useful for testing)
export function createForkEvaluator(): ForkEvaluator {
  return new ForkEvaluator();
}

// Quick evaluation function
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

// Batch evaluation for efficiency
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

// Complexity scoring for external use
export { calculateComplexity };
function calculateComplexity(
  decisionNode: DecisionNode,
  cloneParams: CloneParameters,
  state: SimulationState
): number {
  return forkEvaluator.calculateComplexity(decisionNode, cloneParams, state);
}

// Cost estimation
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

  // Generic cost estimation ($0.50-1.00 per 1M tokens typical range)
  const standardCost = simpleCount * tokensPerCall * 0.0000005;
  const reasoningCost = Math.min(complexCount, 20) * reasoningTokensPerCall * 0.000001;

  return {
    standardCalls: simpleCount,
    reasoningCalls: Math.min(complexCount, 20),
    estimatedCost: standardCost + reasoningCost,
    totalTokens: simpleCount * tokensPerCall + Math.min(complexCount, 20) * reasoningTokensPerCall,
  };
}
