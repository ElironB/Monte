import OpenAI from 'openai';
import { config } from './index.js';
import { EmbeddingService } from '../embeddings/embeddingService.js';
import { logger } from '../utils/logger.js';

export async function validateStartupConfig(): Promise<void> {
  const errors: string[] = [];

  if (!config.llm.apiKey) {
    errors.push('LLM_API_KEY is required. Set OPENROUTER_API_KEY, GROQ_API_KEY, or LLM_API_KEY.');
  } else {
    try {
      const client = new OpenAI({
        apiKey: config.llm.apiKey,
        baseURL: config.llm.baseUrl,
      });

      await client.chat.completions.create({
        model: config.llm.model,
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 5,
      });

      logger.info('LLM API key validated');
    } catch (err) {
      errors.push(`LLM API key validation failed: ${(err as Error).message}`);
    }
  }

  if (!EmbeddingService.isAvailable()) {
    errors.push(
      'Embedding API key is required. ' +
      'Set OPENROUTER_API_KEY (recommended) or EMBEDDING_API_KEY. ' +
      'Groq does not support embeddings.',
    );
  } else {
    try {
      const service = EmbeddingService.getInstance();
      await service.embed('test');
      logger.info('Embedding API key validated');
    } catch (err) {
      errors.push(`Embedding API key validation failed: ${(err as Error).message}`);
    }
  }

  if (errors.length > 0) {
    logger.error({ errors }, 'Startup validation failed');
    console.error('\n❌ Monte Engine startup validation failed:\n');
    for (const error of errors) {
      console.error(`  • ${error}`);
    }
    console.error('\nFix these issues and restart.\n');
    process.exit(1);
  }

  logger.info('Startup validation passed');
}
