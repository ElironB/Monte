import 'dotenv/config';
import OpenAI from 'openai';
import { resolveLLMProviderConfig } from './providerConfig.js';
import { parseJsonResponse } from '../utils/json.js';

export interface ParsedSimulation {
  scenarioType: string;
  name: string;
  capitalAtRisk?: number;
  timeframe?: number;
  context: Record<string, unknown>;
}

export const SCENARIO_TYPES = [
  'day_trading',
  'startup_founding',
  'career_change',
  'advanced_degree',
  'geographic_relocation',
  'real_estate_purchase',
  'health_fitness_goal',
  'custom',
] as const;

type ScenarioType = (typeof SCENARIO_TYPES)[number];

function loadLLMConfig(): { apiKey: string; baseUrl: string; model: string } {
  const llm = resolveLLMProviderConfig();

  if (!llm.apiKey) {
    throw new Error('No LLM API key found. Set OPENROUTER_API_KEY / GROQ_API_KEY, or run `monte config set-provider ...` and `monte config set-api-key ...`.');
  }

  return {
    apiKey: llm.apiKey,
    baseUrl: llm.baseUrl,
    model: llm.model,
  };
}

function isScenarioType(value: unknown): value is ScenarioType {
  return typeof value === 'string' && SCENARIO_TYPES.includes(value as ScenarioType);
}

export async function parseSimulationQuery(query: string): Promise<ParsedSimulation> {
  const { apiKey, baseUrl, model } = loadLLMConfig();
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/ElironB/Monte',
      'X-Title': 'Monte Engine',
    },
  });

  const systemPrompt = `You parse natural language decision questions into structured simulation parameters.

Available scenario types: ${SCENARIO_TYPES.join(', ')}

Extract:
- scenarioType: best matching scenario from the list above. Use "custom" if none fit well.
- name: short descriptive name for this simulation (2-5 words)
- capitalAtRisk: dollar amount if mentioned or clearly implied (number only, no currency symbol)
- timeframe: total timeframe in months if mentioned or clearly implied
- context: any additional structured data extracted from the query as flat or nested JSON key-value pairs

Examples:
"should I quit my job and day trade with my $80k savings?" -> {"scenarioType":"day_trading","name":"Quit job to day trade","capitalAtRisk":80000,"context":{"currentEmployment":true,"savingsAmount":80000}}
"should I buy this $1300 iPhone or wait a year?" -> {"scenarioType":"custom","name":"Buy iPhone or wait","capitalAtRisk":1300,"timeframe":12,"context":{"item":"iPhone","alternative":"wait","purchasePrice":1300}}
"is it worth getting an MBA at $120k tuition?" -> {"scenarioType":"advanced_degree","name":"MBA decision","capitalAtRisk":120000,"timeframe":24,"context":{"degreeType":"MBA","tuitionCost":120000}}
"should I move to Berlin from NYC?" -> {"scenarioType":"geographic_relocation","name":"Move to Berlin","context":{"origin":"NYC","destination":"Berlin"}}

Return valid JSON only with these keys: scenarioType, name, capitalAtRisk, timeframe, context.`;

  let lastError: Error | undefined;
  let raw = '{}';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: attempt === 0
            ? query
            : `${query}\n\nYour previous response was malformed. Return valid JSON only.`,
        },
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    raw = completion.choices[0]?.message?.content || '{}';

    try {
      const parsed = parseJsonResponse<{
        scenarioType?: unknown;
        name?: unknown;
        capitalAtRisk?: unknown;
        timeframe?: unknown;
        context?: unknown;
      }>(raw);

      return {
        scenarioType: isScenarioType(parsed.scenarioType) ? parsed.scenarioType : 'custom',
        name: typeof parsed.name === 'string' && parsed.name.trim().length > 0 ? parsed.name.trim() : query.slice(0, 40),
        capitalAtRisk: typeof parsed.capitalAtRisk === 'number' && Number.isFinite(parsed.capitalAtRisk)
          ? parsed.capitalAtRisk
          : undefined,
        timeframe: typeof parsed.timeframe === 'number' && Number.isFinite(parsed.timeframe)
          ? parsed.timeframe
          : undefined,
        context: parsed.context && typeof parsed.context === 'object' && !Array.isArray(parsed.context)
          ? parsed.context as Record<string, unknown>
          : {},
      };
    } catch (err) {
      lastError = err as Error;
    }
  }

  throw new Error(
    `Simulation query parsing failed; retry your prompt or use \`monte simulate run -s <scenario>\`. ${lastError?.message || `Raw response: ${raw.slice(0, 200)}`}`
  );
}
