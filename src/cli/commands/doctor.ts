import 'dotenv/config';

import chalk from 'chalk';
import { Command } from 'commander';
import OpenAI from 'openai';
import { api } from '../api.js';
import { loadConfig } from '../config.js';
import { buildJsonErrorPayload, printJson, printJsonErrorAndExit } from '../output.js';
import { resolveCliProviderConfig } from '../providerConfig.js';
import { dimText, icons, infoLabel, sectionHeader } from '../styles.js';
import { resolveIngestionRuntimeConfig } from '../../config/ingestionRuntime.js';
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
  ingestionWorkerConcurrency: number;
  decisionConcurrency: number;
  cloneConcurrency: number;
  activeFrontier: number;
  decisionBatchSize: number;
  decisionBatchFlushMs: number;
  llmRpmLimit: number | null;
  llmProvider: string;
  llmConfigSource: string;
  embeddingConfigSource: string;
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
  const { llm } = resolveCliProviderConfig();
  return {
    apiKey: llm.apiKey,
    baseUrl: llm.baseUrl,
    model: llm.model,
  };
}

function resolveEmbeddingConfig(): ResolvedProviderConfig {
  const { embedding } = resolveCliProviderConfig();
  return {
    apiKey: embedding.apiKey,
    baseUrl: embedding.baseUrl,
    model: embedding.model,
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
  const ingestionRuntime = resolveIngestionRuntimeConfig();
  const providers = resolveCliProviderConfig();

  return {
    apiUrl,
    batchSize: runtime.batchSize,
    workerConcurrency: runtime.workerConcurrency,
    ingestionWorkerConcurrency: ingestionRuntime.workerConcurrency,
    decisionConcurrency: runtime.decisionConcurrency,
    cloneConcurrency: runtime.cloneConcurrency,
    activeFrontier: runtime.activeFrontier,
    decisionBatchSize: runtime.decisionBatchSize,
    decisionBatchFlushMs: runtime.decisionBatchFlushMs,
    llmRpmLimit: runtime.llmRpmLimit ?? null,
    llmProvider: providers.llm.provider,
    llmConfigSource: providers.llm.source,
    embeddingConfigSource: providers.embedding.source,
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
      details: 'Set OPENROUTER_API_KEY / GROQ_API_KEY / LLM_API_KEY, or run `monte config set-provider ...` and `monte config set-api-key ...`',
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
      details: 'Set OPENROUTER_API_KEY / EMBEDDING_API_KEY, or run `monte config set-embedding-key ...`',
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
  console.log(`  ${infoLabel('Ingestion Workers:')} ${runtime.ingestionWorkerConcurrency}`);
  console.log(`  ${infoLabel('Decision Concurrency:')} ${runtime.decisionConcurrency}`);
  console.log(`  ${infoLabel('Clone Concurrency:')} ${runtime.cloneConcurrency}`);
  console.log(`  ${infoLabel('Active Frontier:')} ${runtime.activeFrontier}`);
  console.log(`  ${infoLabel('Decision Batch Size:')} ${runtime.decisionBatchSize}`);
  console.log(`  ${infoLabel('Decision Flush:')} ${runtime.decisionBatchFlushMs}ms`);
  console.log(`  ${infoLabel('LLM RPM Limit:')} ${rpmText}`);
  console.log(`  ${infoLabel('LLM Provider:')} ${runtime.llmProvider} (${runtime.llmConfigSource})`);
  console.log(`  ${infoLabel('Embedding Auth:')} ${runtime.embeddingConfigSource}`);
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
