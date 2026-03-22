import OpenAI from 'openai';
import { config } from '../config/index.js';

export interface GenerationOptions {
  description: string;
  entries: number;
  timespanMonths: number;
  outputDir: string;
}

export interface GeneratedPersona {
  searchHistory: object;
  redditPosts: object;
  transactions: string;
  watchHistory: object;
  notes: string;
}

function stripCodeFence(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  }
  return cleaned.trim();
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;

    if (depth === 0) {
      return raw.slice(start, i + 1);
    }
  }

  return null;
}

export function parseJsonResponse(raw: string): object {
  const cleaned = stripCodeFence(raw);

  try {
    return JSON.parse(cleaned);
  } catch {
    const extracted = extractFirstJsonObject(cleaned);
    if (extracted) {
      return JSON.parse(extracted);
    }
  }

  const preview = cleaned.slice(0, 200) || '[empty response]';
  throw new Error(`LLM returned invalid or incomplete JSON: ${preview}`);
}

function parseCsvResponse(raw: string): string {
  return stripCodeFence(raw);
}

function parseMarkdownResponse(raw: string): string {
  let cleaned = stripCodeFence(raw);
  if (cleaned.startsWith('```markdown') || cleaned.startsWith('```md')) {
    cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  }
  return cleaned;
}

interface LLMCallOptions {
  maxTokens?: number;
  temperature?: number;
  responseFormat?: { type: 'json_object' };
}

export class SyntheticGenerator {
  private client: OpenAI | null = null;
  private model: string;

  constructor() {
    if (config.llm?.apiKey) {
      this.client = new OpenAI({
        apiKey: config.llm.apiKey,
        baseURL: config.llm.baseUrl || 'https://api.groq.com/openai/v1',
      });
      this.model = config.llm.model || 'openai/gpt-oss-20b';
    } else {
      this.model = '';
    }
  }

  async generate(options: GenerationOptions): Promise<GeneratedPersona> {
    if (!this.client) {
      throw new Error('OPENROUTER_API_KEY or GROQ_API_KEY required for persona generation. Set one in your .env file.');
    }

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - options.timespanMonths);
    const startDateStr = startDate.toISOString().split('T')[0];

    const [searchHistory, redditPosts, transactions, watchHistory, notes] = await Promise.all([
      this.generateSearchHistory(options, startDateStr),
      this.generateRedditPosts(options, startDateStr),
      this.generateTransactions(options, startDateStr),
      this.generateWatchHistory(options, startDateStr),
      this.generateNotes(options),
    ]);

    return { searchHistory, redditPosts, transactions, watchHistory, notes };
  }

  private async callLLM(systemPrompt: string, userPrompt: string, options: LLMCallOptions = {}): Promise<string> {
    const completion = await this.client!.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: options.temperature ?? 0.8,
      max_tokens: options.maxTokens ?? 4000,
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    });
    return completion.choices[0]?.message?.content || '';
  }

  private async callLLMWithRetry(
    systemPrompt: string,
    userPrompt: string,
    parser: (raw: string) => unknown,
    retryHint: string,
    options: LLMCallOptions = {},
  ): Promise<unknown> {
    let raw = await this.callLLM(systemPrompt, userPrompt, options);
    try {
      return parser(raw);
    } catch (initialError) {
      raw = await this.callLLM(systemPrompt, userPrompt + `\n\n${retryHint}`, {
        ...options,
        maxTokens: Math.max(options.maxTokens ?? 4000, 6000),
      });
      try {
        return parser(raw);
      } catch {
        throw initialError;
      }
    }
  }

  private async generateSearchHistory(options: GenerationOptions, startDate: string): Promise<object> {
    const system = 'You generate realistic Google search history data for behavioral simulation.';
    const user = `Generate a JSON file of search history entries for this persona:
"${options.description}"

Requirements:
- Generate approximately ${options.entries} search entries
- Span ${options.timespanMonths} months starting from ${startDate}
- Use realistic timestamps (vary time of day based on personality)
- Searches should reveal the persona's interests, anxieties, goals
- Include mundane searches too (weather, recipes, directions) — not everything should be a signal
- Format: {"searches": [{"query": "...", "timestamp": "ISO8601"}, ...]}

Output ONLY valid JSON, no markdown code blocks.`;

    return this.callLLMWithRetry(
      system,
      user,
      parseJsonResponse,
      'IMPORTANT: Return exactly one complete JSON object that matches the requested format. No markdown, no prose, no truncation.',
      { responseFormat: { type: 'json_object' }, temperature: 0.4, maxTokens: 6000 },
    ) as Promise<object>;
  }

  private async generateRedditPosts(options: GenerationOptions, startDate: string): Promise<object> {
    const postCount = Math.max(5, Math.floor(options.entries * 0.3));
    const system = 'You generate realistic Reddit post history for behavioral simulation.';
    const user = `Generate Reddit posts for this persona:
"${options.description}"

Requirements:
- Generate approximately ${postCount} posts (people post less than they search)
- Use relevant subreddits (r/personalfinance, r/cscareerquestions, r/wallstreetbets, etc.)
- Posts should reveal personality through language (risk-taking, anxiety, ambition, etc.)
- Include both confident and vulnerable posts — people contradict themselves
- Span ${options.timespanMonths} months starting from ${startDate}
- Format: {"posts": [{"subreddit": "...", "title": "...", "body": "...", "timestamp": "ISO8601"}, ...]}

Output ONLY valid JSON, no markdown code blocks.`;

    return this.callLLMWithRetry(
      system,
      user,
      parseJsonResponse,
      'IMPORTANT: Return exactly one complete JSON object that matches the requested format. No markdown, no prose, no truncation.',
      { responseFormat: { type: 'json_object' }, temperature: 0.4, maxTokens: 6000 },
    ) as Promise<object>;
  }

  private async generateTransactions(options: GenerationOptions, startDate: string): Promise<string> {
    const txCount = options.entries * 3;
    const system = 'You generate realistic bank transaction data for behavioral simulation.';
    const user = `Generate a CSV of transactions for this persona:
"${options.description}"

Requirements:
- Generate approximately ${txCount} transactions (people have more transactions than searches)
- Include: regular income, bills, discretionary spending, investments if applicable
- Spending patterns should match personality (impulse buyers have late-night Amazon orders)
- Include financial stress signals if appropriate (overdrafts, late fees)
- Format: CSV with headers: date,description,amount,category
- Dates span ${options.timespanMonths} months from ${startDate}

Output ONLY valid CSV with headers, no markdown code blocks.`;

    return this.callLLMWithRetry(
      system,
      user,
      parseCsvResponse,
      'IMPORTANT: Output ONLY valid CSV with headers. No markdown, no code blocks, no explanation.',
      { temperature: 0.5, maxTokens: 6000 },
    ) as Promise<string>;
  }

  private async generateWatchHistory(options: GenerationOptions, startDate: string): Promise<object> {
    const watchCount = Math.floor(options.entries * 1.5);
    const system = 'You generate realistic YouTube/streaming watch history for behavioral simulation.';
    const user = `Generate watch history for this persona:
"${options.description}"

Requirements:
- Generate approximately ${watchCount} entries
- Mix educational and entertainment content based on personality
- Titles should be realistic YouTube-style titles
- Include tutorials, documentaries, courses, vlogs, etc. proportional to personality
- Span ${options.timespanMonths} months starting from ${startDate}
- Format: {"history": [{"title": "...", "date": "YYYY-MM-DD"}, ...]}

Output ONLY valid JSON, no markdown code blocks.`;

    return this.callLLMWithRetry(
      system,
      user,
      parseJsonResponse,
      'IMPORTANT: Return exactly one complete JSON object that matches the requested format. No markdown, no prose, no truncation.',
      { responseFormat: { type: 'json_object' }, temperature: 0.4, maxTokens: 6000 },
    ) as Promise<object>;
  }

  private async generateNotes(options: GenerationOptions): Promise<string> {
    const wordCount = options.entries * 50;
    const system = 'You generate realistic personal notes/journal entries for behavioral simulation.';
    const user = `Generate a markdown journal/notes file for this persona:
"${options.description}"

Requirements:
- Write as if this person keeps notes in Obsidian/Notion
- Include goals, reflections, weekly planning, daily habits
- Use markdown structure (headings, lists, tables) based on how organized the persona is
- Include self-reflection language (feel, think, realized, learned, why)
- Show internal contradictions (ambitious goals vs procrastination, etc.)
- Approximately ${wordCount} words
- Span thoughts across ${options.timespanMonths} months

Output ONLY valid markdown, no code blocks wrapping.`;

    return this.callLLMWithRetry(
      system,
      user,
      parseMarkdownResponse,
      'IMPORTANT: Output ONLY valid markdown. Do not wrap in code blocks.',
      { temperature: 0.7, maxTokens: 6000 },
    ) as Promise<string>;
  }
}
