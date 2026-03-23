import { loadConfig, type CLIConfig, type LLMProvider } from './config.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_LLM_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_REASONING_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';

export type ConfigSource = 'env' | 'config' | 'none';

export interface ResolvedLLMConfig {
  source: ConfigSource;
  provider: LLMProvider;
  apiKey?: string;
  baseUrl: string;
  model: string;
  reasoningModel: string;
}

export interface ResolvedEmbeddingConfig {
  source: ConfigSource;
  provider: 'openrouter' | 'custom';
  apiKey?: string;
  baseUrl: string;
  model: string;
  usesSharedLlmKey: boolean;
}

export interface ResolvedProviderConfigs {
  llm: ResolvedLLMConfig;
  embedding: ResolvedEmbeddingConfig;
}

function resolveProviderBaseUrl(provider: LLMProvider, configuredBaseUrl?: string): string {
  if (provider === 'openrouter') {
    return OPENROUTER_BASE_URL;
  }

  if (provider === 'groq') {
    return GROQ_BASE_URL;
  }

  return configuredBaseUrl || GROQ_BASE_URL;
}

export function resolveLLMProviderConfig(cliConfig: CLIConfig = loadConfig()): ResolvedLLMConfig {
  if (process.env.OPENROUTER_API_KEY) {
    return {
      source: 'env',
      provider: 'openrouter',
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: OPENROUTER_BASE_URL,
      model: process.env.LLM_MODEL || DEFAULT_LLM_MODEL,
      reasoningModel: process.env.LLM_REASONING_MODEL || DEFAULT_REASONING_MODEL,
    };
  }

  if (process.env.GROQ_API_KEY) {
    return {
      source: 'env',
      provider: 'groq',
      apiKey: process.env.GROQ_API_KEY,
      baseUrl: GROQ_BASE_URL,
      model: process.env.LLM_MODEL || DEFAULT_LLM_MODEL,
      reasoningModel: process.env.LLM_REASONING_MODEL || DEFAULT_REASONING_MODEL,
    };
  }

  if (process.env.LLM_API_KEY) {
    return {
      source: 'env',
      provider: 'custom',
      apiKey: process.env.LLM_API_KEY,
      baseUrl: process.env.LLM_BASE_URL || GROQ_BASE_URL,
      model: process.env.LLM_MODEL || DEFAULT_LLM_MODEL,
      reasoningModel: process.env.LLM_REASONING_MODEL || DEFAULT_REASONING_MODEL,
    };
  }

  const provider = cliConfig.llmProvider || 'openrouter';

  return {
    source: cliConfig.llmApiKey ? 'config' : 'none',
    provider,
    apiKey: cliConfig.llmApiKey,
    baseUrl: resolveProviderBaseUrl(provider, cliConfig.llmBaseUrl),
    model: cliConfig.llmModel || DEFAULT_LLM_MODEL,
    reasoningModel: cliConfig.llmReasoningModel || DEFAULT_REASONING_MODEL,
  };
}

export function resolveEmbeddingProviderConfig(cliConfig: CLIConfig = loadConfig()): ResolvedEmbeddingConfig {
  if (process.env.EMBEDDING_API_KEY) {
    return {
      source: 'env',
      provider: 'custom',
      apiKey: process.env.EMBEDDING_API_KEY,
      baseUrl: process.env.EMBEDDING_BASE_URL || OPENROUTER_BASE_URL,
      model: process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
      usesSharedLlmKey: false,
    };
  }

  if (process.env.OPENROUTER_API_KEY) {
    return {
      source: 'env',
      provider: 'openrouter',
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: OPENROUTER_BASE_URL,
      model: process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
      usesSharedLlmKey: true,
    };
  }

  const llm = resolveLLMProviderConfig(cliConfig);
  if (cliConfig.embeddingApiKey) {
    const provider = cliConfig.embeddingBaseUrl ? 'custom' : llm.provider === 'openrouter' ? 'openrouter' : 'custom';

    return {
      source: 'config',
      provider,
      apiKey: cliConfig.embeddingApiKey,
      baseUrl: cliConfig.embeddingBaseUrl || OPENROUTER_BASE_URL,
      model: cliConfig.embeddingModel || DEFAULT_EMBEDDING_MODEL,
      usesSharedLlmKey: false,
    };
  }

  if (llm.source === 'config' && llm.provider === 'openrouter' && llm.apiKey) {
    return {
      source: 'config',
      provider: 'openrouter',
      apiKey: llm.apiKey,
      baseUrl: OPENROUTER_BASE_URL,
      model: cliConfig.embeddingModel || DEFAULT_EMBEDDING_MODEL,
      usesSharedLlmKey: true,
    };
  }

  return {
    source: 'none',
    provider: cliConfig.embeddingBaseUrl ? 'custom' : 'openrouter',
    apiKey: undefined,
    baseUrl: cliConfig.embeddingBaseUrl || OPENROUTER_BASE_URL,
    model: cliConfig.embeddingModel || DEFAULT_EMBEDDING_MODEL,
    usesSharedLlmKey: false,
  };
}

export function resolveCliProviderConfig(cliConfig: CLIConfig = loadConfig()): ResolvedProviderConfigs {
  return {
    llm: resolveLLMProviderConfig(cliConfig),
    embedding: resolveEmbeddingProviderConfig(cliConfig),
  };
}

export function maskSecret(secret?: string): string {
  if (!secret) {
    return 'not set';
  }

  if (secret.length <= 8) {
    return `${secret.slice(0, 2)}***${secret.slice(-2)}`;
  }

  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}
