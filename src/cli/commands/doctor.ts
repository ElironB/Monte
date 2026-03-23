import 'dotenv/config';

import chalk from 'chalk';
import { Command } from 'commander';
import OpenAI from 'openai';
import { api } from '../api.js';
import { loadConfig } from '../config.js';
import { buildJsonErrorPayload, printJson, printJsonErrorAndExit } from '../output.js';
import { dimText, icons, infoLabel, sectionHeader } from '../styles.js';
import { resolveSimulationRuntimeConfig } from '../../config/simulationRuntime.js';

interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message?: string;
  details?: string;
}

interface ReadyHealthResponse {
  status?: string;
  services?: {
    neo4j?: string;
    redis?: string;
    minio?: string;
  };
}

interface ResolvedProviderConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
}

interface DoctorRuntimeSettings {
  apiUrl: string;
  batchSize: number;
  workerConcurrency: number;
  cloneConcurrency: number;
  llmRpmLimit: number | null;
}

interface DoctorReport {
  ok: boolean;
  apiUrl: string;
  runtime: DoctorRuntimeSettings;
  checks: HealthCheck[];
  summary: {
    passCount: number;
    failCount: number;
    warnCount: number;
  };
}

export const doctorCommands = new Command('doctor')
  .description(chalk.dim('Run health checks on your Monte setup'))
  .option('--json', 'output machine-readable JSON', false);

function resolveLlmConfig(): ResolvedProviderConfig {
  if (process.env.OPENROUTER_API_KEY) {
    return {
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: 'https://openrouter.ai/api/v1',
      model: process.env.LLM_MODEL || 'openai/gpt-oss-20b',
    };
  }

  if (process.env.GROQ_API_KEY) {
    return {
      apiKey: process.env.GROQ_API_KEY,
      baseUrl: 'https://api.groq.com/openai/v1',
      model: process.env.LLM_MODEL || 'openai/gpt-oss-20b',
    };
  }

  return {
    apiKey: process.env.LLM_API_KEY,
    baseUrl: process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1',
    model: process.env.LLM_MODEL || 'openai/gpt-oss-20b',
  };
}

function resolveEmbeddingConfig(): ResolvedProviderConfig {
  if (process.env.EMBEDDING_API_KEY) {
    return {
      apiKey: process.env.EMBEDDING_API_KEY,
      baseUrl: process.env.EMBEDDING_BASE_URL || 'https://openrouter.ai/api/v1',
      model: process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small',
    };
  }

  return {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: 'https://openrouter.ai/api/v1',
    model: process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small',
  };
}

function formatStatus(status: HealthCheck['status']): string {
  switch (status) {
    case 'pass':
      return chalk.green.bold('pass');
    case 'fail':
      return chalk.red.bold('fail');
    case 'warn':
      return chalk.yellow('warn');
  }
}

function formatIcon(status: HealthCheck['status']): string {
  switch (status) {
    case 'pass':
      return icons.success;
    case 'fail':
      return icons.error;
    case 'warn':
      return icons.warning;
  }
}

async function fetchReadyHealth(apiUrl: string): Promise<{ response?: ReadyHealthResponse; error?: Error }> {
  try {
    const result = await fetch(`${apiUrl}/health/ready`);
    const response = await result.json().catch(() => ({})) as ReadyHealthResponse;
    return { response };
  } catch (err) {
    return { error: err as Error };
  }
}

export function getDoctorRuntimeSettings(): DoctorRuntimeSettings {
  const { apiUrl } = loadConfig();
  const runtime = resolveSimulationRuntimeConfig();

  return {
    apiUrl,
    batchSize: runtime.batchSize,
    workerConcurrency: runtime.workerConcurrency,
    cloneConcurrency: runtime.cloneConcurrency,
    llmRpmLimit: runtime.llmRpmLimit ?? null,
  };
}

export function buildDoctorReport(checks: HealthCheck[], runtime: DoctorRuntimeSettings): DoctorReport {
  const failCount = checks.filter((check) => check.status === 'fail').length;
  const passCount = checks.filter((check) => check.status === 'pass').length;
  const warnCount = checks.filter((check) => check.status === 'warn').length;

  return {
    ok: failCount === 0,
    apiUrl: runtime.apiUrl,
    runtime,
    checks,
    summary: {
      passCount,
      failCount,
      warnCount,
    },
  };
}

async function collectHealthChecks(apiUrl: string): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];

  try {
    await api.health();
    checks.push({ name: 'API Server', status: 'pass' });
  } catch (err) {
    checks.push({
      name: 'API Server',
      status: 'fail',
      message: 'Cannot reach API',
      details: (err as Error).message,
    });
  }

  const ready = await fetchReadyHealth(apiUrl);
  if (ready.error) {
    checks.push({
      name: 'Neo4j',
      status: 'fail',
      message: 'Readiness check failed',
      details: ready.error.message,
    });
    checks.push({
      name: 'Redis',
      status: 'fail',
      message: 'Readiness check failed',
      details: ready.error.message,
    });
    checks.push({
      name: 'MinIO',
      status: 'fail',
      message: 'Readiness check failed',
      details: ready.error.message,
    });
  } else {
    const services = ready.response?.services;
    const neo4j = services?.neo4j === 'connected';
    const redis = services?.redis === 'connected';
    const minio = services?.minio === 'connected';

    checks.push({
      name: 'Neo4j',
      status: neo4j ? 'pass' : 'fail',
      message: neo4j ? undefined : 'Database not connected',
    });
    checks.push({
      name: 'Redis',
      status: redis ? 'pass' : 'fail',
      message: redis ? undefined : 'Cache not connected',
    });
    checks.push({
      name: 'MinIO',
      status: minio ? 'pass' : 'fail',
      message: minio ? undefined : 'Storage not connected',
    });
  }

  const llmConfig = resolveLlmConfig();
  if (!llmConfig.apiKey) {
    checks.push({
      name: 'LLM API Key',
      status: 'fail',
      message: 'No API key found',
      details: 'Set OPENROUTER_API_KEY, GROQ_API_KEY, or LLM_API_KEY',
    });
  } else {
    try {
      const client = new OpenAI({
        apiKey: llmConfig.apiKey,
        baseURL: llmConfig.baseUrl,
      });

      await client.chat.completions.create({
        model: llmConfig.model,
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 5,
      });

      checks.push({ name: 'LLM API Key', status: 'pass' });
    } catch (err) {
      checks.push({
        name: 'LLM API Key',
        status: 'fail',
        message: 'API call failed',
        details: (err as Error).message,
      });
    }
  }

  const embeddingConfig = resolveEmbeddingConfig();
  if (!embeddingConfig.apiKey) {
    checks.push({
      name: 'Embedding API Key',
      status: 'fail',
      message: 'No embedding key found',
      details: 'Set OPENROUTER_API_KEY or EMBEDDING_API_KEY',
    });
  } else {
    try {
      const client = new OpenAI({
        apiKey: embeddingConfig.apiKey,
        baseURL: embeddingConfig.baseUrl,
      });

      await client.embeddings.create({
        model: embeddingConfig.model,
        input: 'test',
      });

      checks.push({ name: 'Embedding API Key', status: 'pass' });
    } catch (err) {
      checks.push({
        name: 'Embedding API Key',
        status: 'fail',
        message: 'API call failed',
        details: (err as Error).message,
      });
    }
  }

  if (process.env.COMPOSIO_API_KEY) {
    checks.push({ name: 'Composio API Key', status: 'warn', message: 'Set (WIP feature)' });
  } else {
    checks.push({ name: 'Composio API Key', status: 'warn', message: 'Not set (optional)' });
  }

  return checks;
}

function renderRuntimeSettings(runtime: DoctorRuntimeSettings): void {
  const rpmText = runtime.llmRpmLimit === null ? 'auto-detected' : String(runtime.llmRpmLimit);

  console.log(`\n${sectionHeader('Runtime Tuning')}`);
  console.log(`  ${infoLabel('API URL:')} ${runtime.apiUrl}`);
  console.log(`  ${infoLabel('Batch Size:')} ${runtime.batchSize}`);
  console.log(`  ${infoLabel('Worker Concurrency:')} ${runtime.workerConcurrency}`);
  console.log(`  ${infoLabel('Clone Concurrency:')} ${runtime.cloneConcurrency}`);
  console.log(`  ${infoLabel('LLM RPM Limit:')} ${rpmText}`);
}

doctorCommands.action(async (options: { json?: boolean }) => {
  try {
    const runtime = getDoctorRuntimeSettings();
    const checks = await collectHealthChecks(runtime.apiUrl);
    const report = buildDoctorReport(checks, runtime);

    if (options.json) {
      printJson(report);
      if (!report.ok) {
        process.exit(1);
      }
      return;
    }

    console.log(`\n${sectionHeader('Monte Engine Health Check')}\n`);

    for (const check of checks) {
      const icon = formatIcon(check.status);
      const status = formatStatus(check.status);
      const msg = check.message ? dimText(` — ${check.message}`) : '';
      console.log(`  ${icon} ${infoLabel(check.name.padEnd(20))} ${status}${msg}`);
      if (check.details) {
        console.log(`     ${dimText(check.details)}`);
      }
    }

    renderRuntimeSettings(runtime);
    console.log();

    if (!report.ok) {
      console.log(chalk.red.bold(`✗ ${report.summary.failCount} check(s) failed`));
      process.exit(1);
    }

    console.log(chalk.green.bold(`✓ All critical checks passed (${report.summary.passCount}/${checks.length})`));
  } catch (err) {
    if (options.json) {
      printJsonErrorAndExit(err);
    }

    const payload = buildJsonErrorPayload(err);
    console.error(`${icons.error} ${payload.error.message}`);
    process.exit(1);
  }
});
