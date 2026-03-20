import OpenAI from 'openai';
import { config } from '../config/index.js';
import { cacheGet, cacheSet } from '../config/redis.js';
import { logger } from '../utils/logger.js';

const CACHE_TTL = 86400 * 7;
const CACHE_PREFIX = 'emb:';

export class EmbeddingService {
  private static instance: EmbeddingService | null = null;
  private client: OpenAI;
  private model: string;
  private dimensions: number;

  private constructor() {
    const embConfig = config.embedding;
    if (!embConfig?.apiKey) {
      throw new Error(
        'Embeddings require OPENROUTER_API_KEY or EMBEDDING_API_KEY. Groq does not support embeddings.'
      );
    }

    this.client = new OpenAI({
      apiKey: embConfig.apiKey,
      baseURL: embConfig.baseUrl,
    });
    this.model = embConfig.model;
    this.dimensions = embConfig.dimensions;
  }

  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  static isAvailable(): boolean {
    return Boolean(config.embedding?.apiKey);
  }

  get vectorDimensions(): number {
    return this.dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const cacheKey = `${CACHE_PREFIX}${this.hashText(text)}`;
    const cached = await cacheGet<number[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    const vector = response.data[0]?.embedding ?? [];
    await cacheSet(cacheKey, vector, CACHE_TTL);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const cacheKeys = texts.map(text => `${CACHE_PREFIX}${this.hashText(text)}`);
    const results = await Promise.all(cacheKeys.map(cacheKey => cacheGet<number[]>(cacheKey)));
    const vectors: (number[] | null)[] = [...results];

    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    for (let i = 0; i < texts.length; i++) {
      if (!vectors[i]) {
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i]);
      }
    }

    if (uncachedTexts.length > 0) {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: uncachedTexts,
      });

      for (let i = 0; i < response.data.length; i++) {
        const index = uncachedIndices[i];
        const vector = response.data[i]?.embedding ?? [];
        vectors[index] = vector;
        const cacheKey = `${CACHE_PREFIX}${this.hashText(uncachedTexts[i])}`;
        void cacheSet(cacheKey, vector, CACHE_TTL).catch(err => {
          logger.warn({ err, cacheKey }, 'Failed to cache embedding');
        });
      }
    }

    return vectors.map(vector => vector ?? []);
  }

  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return `${this.model}:${hash.toString(36)}`;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}
