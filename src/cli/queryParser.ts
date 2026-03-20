import 'dotenv/config';
import OpenAI from 'openai';

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
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY || process.env.LLM_API_KEY;

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY or GROQ_API_KEY is required. Set one in your .env file.');
  }

  const baseUrl = process.env.OPENROUTER_API_KEY
    ? 'https://openrouter.ai/api/v1'
    : process.env.GROQ_API_KEY
      ? 'https://api.groq.com/openai/v1'
      : process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';

  return {
    apiKey,
    baseUrl,
    model: process.env.LLM_MODEL || 'openai/gpt-oss-20b',
  };
}

function isScenarioType(value: unknown): value is ScenarioType {
  return typeof value === 'string' && SCENARIO_TYPES.includes(value as ScenarioType);
}

export async function parseSimulationQuery(query: string): Promise<ParsedSimulation> {
  const { apiKey, baseUrl, model } = loadLLMConfig();
  const client = new OpenAI({ apiKey, baseURL: baseUrl });

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `You parse natural language decision questions into structured simulation parameters.

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

Return valid JSON only with these keys: scenarioType, name, capitalAtRisk, timeframe, context.`,
      },
      { role: 'user', content: query },
    ],
    temperature: 0.1,
    max_tokens: 500,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw) as {
    scenarioType?: unknown;
    name?: unknown;
    capitalAtRisk?: unknown;
    timeframe?: unknown;
    context?: unknown;
  };

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
}
