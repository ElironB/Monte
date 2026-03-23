import { describe, expect, test } from 'vitest';
import { resolveCliProviderConfig, resolveEmbeddingProviderConfig, resolveLLMProviderConfig } from '../src/cli/providerConfig.js';
import type { CLIConfig } from '../src/cli/config.js';

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

describe('CLI provider config', () => {
  test('falls back to config-backed OpenRouter credentials for global CLI usage', () => {
    const config: CLIConfig = {
      apiUrl: 'http://localhost:3000',
      llmProvider: 'openrouter',
      llmApiKey: 'sk-or-config-test-1234',
    };

    const resolved = resolveCliProviderConfig(config);

    expect(resolved.llm).toMatchObject({
      source: 'config',
      provider: 'openrouter',
      apiKey: 'sk-or-config-test-1234',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
    expect(resolved.embedding).toMatchObject({
      source: 'config',
      provider: 'openrouter',
      apiKey: 'sk-or-config-test-1234',
      usesSharedLlmKey: true,
    });
  });

  test('supports Groq chat plus a dedicated embedding key in config', () => {
    const config: CLIConfig = {
      apiUrl: 'http://localhost:3000',
      llmProvider: 'groq',
      llmApiKey: 'gsk_groq_config_1234',
      embeddingApiKey: 'sk-or-embed-5678',
      embeddingBaseUrl: 'https://openrouter.ai/api/v1',
    };

    expect(resolveLLMProviderConfig(config)).toMatchObject({
      source: 'config',
      provider: 'groq',
      apiKey: 'gsk_groq_config_1234',
      baseUrl: 'https://api.groq.com/openai/v1',
    });

    expect(resolveEmbeddingProviderConfig(config)).toMatchObject({
      source: 'config',
      provider: 'custom',
      apiKey: 'sk-or-embed-5678',
      baseUrl: 'https://openrouter.ai/api/v1',
      usesSharedLlmKey: false,
    });
  });

  test('prefers environment variables over stored CLI config', () => {
    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

    process.env.OPENROUTER_API_KEY = 'sk-or-env-9999';

    const resolved = resolveLLMProviderConfig({
      apiUrl: 'http://localhost:3000',
      llmProvider: 'groq',
      llmApiKey: 'gsk_groq_config_1234',
    });

    expect(resolved).toMatchObject({
      source: 'env',
      provider: 'openrouter',
      apiKey: 'sk-or-env-9999',
      baseUrl: 'https://openrouter.ai/api/v1',
    });

    restoreEnv('OPENROUTER_API_KEY', originalOpenRouterKey);
  });
});
