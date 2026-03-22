import OpenAI from 'openai';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { RawSourceData, BehavioralSignal } from '../types.js';
import { SignalExtractor } from './base.js';
import { parseJsonResponse } from '../../utils/json.js';

interface SemanticSignalCandidate {
  type?: BehavioralSignal['type'];
  value?: string;
  confidence?: number;
  evidence?: string;
  category?: string;
  sentiment?: BehavioralSignal['dimensions']['sentiment'];
  urgency?: number;
}

export class SemanticExtractor extends SignalExtractor {
  readonly sourceTypes = ['search_history', 'watch_history', 'social_media', 'financial', 'notes', 'files', 'ai_chat'];
  private client: OpenAI | null = null;
  private model: string;

  constructor() {
    super();
    if (config.llm?.apiKey) {
      this.client = new OpenAI({
        apiKey: config.llm.apiKey,
        baseURL: config.llm.baseUrl,
      });
      this.model = config.llm.model || 'openai/gpt-oss-20b';
    } else {
      this.model = '';
    }
  }

  async extract(data: RawSourceData): Promise<BehavioralSignal[]> {
    if (!this.client) {
      return [];
    }

    try {
      const content = data.rawContent.slice(0, 4000);

      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a behavioral analyst extracting psychological signals from personal data.

Extract behavioral signals from the provided content. For each signal, identify:
- type: one of "search_intent", "interest", "financial_behavior", "social_pattern", "cognitive_trait", "emotional_state"
- value: a short descriptor (e.g., "impulse_spending", "career_anxiety", "risk_seeking", "conflict_avoidance", "novelty_addiction")
- confidence: 0.0-1.0 based on how clearly the data supports this signal
- evidence: the specific text/pattern that reveals this signal (quote or paraphrase)
- category: the life domain (finance, career, health, relationships, education, lifestyle)
- sentiment: positive, negative, or neutral
- urgency: 0.0-1.0 how time-sensitive this behavioral pattern appears

Focus on REVEALED behavior, not stated preferences. Look for:
- Patterns the person probably doesn't realize they have
- Contradictions between what they say and what they do
- Temporal patterns (late night activity, weekend binges, cyclical behavior)
- Emotional undertones in seemingly rational decisions
- Avoidance patterns disguised as research or deliberation

Return valid JSON with a top-level "signals" array. If no meaningful signals found, return {"signals":[]}.`,
          },
          {
            role: 'user',
            content: `Source type: ${data.sourceType}\nFilename: ${data.metadata.fileName || 'unknown'}\n\nContent:\n${content}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      });

      const raw = completion.choices[0]?.message?.content || '{}';
      const parsed = parseJsonResponse<SemanticSignalCandidate[] | { signals?: SemanticSignalCandidate[] }>(raw);
      const signals = Array.isArray(parsed) ? parsed : (parsed.signals || []);

      return signals
        .filter((signal): signal is SemanticSignalCandidate & { value: string } => typeof signal?.value === 'string' && signal.value.trim().length > 0)
        .map((signal) => this.createSignal(
          signal.type || 'cognitive_trait',
          signal.value.trim(),
          Math.min(1, Math.max(0, signal.confidence ?? 0.5)),
          signal.evidence || 'LLM semantic extraction',
          data.sourceId,
          {
            category: signal.category,
            sentiment: signal.sentiment,
            urgency: typeof signal.urgency === 'number' ? Math.min(1, Math.max(0, signal.urgency)) : undefined,
          },
        ))
        .slice(0, 10);
    } catch (err) {
      logger.warn({ err, sourceId: data.sourceId, rawPreview: data.rawContent.slice(0, 160) }, 'Semantic extraction failed — falling back to regex only');
      return [];
    }
  }
}
