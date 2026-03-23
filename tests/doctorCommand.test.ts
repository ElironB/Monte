import { describe, expect, test } from 'vitest';
import { buildDoctorReport } from '../src/cli/commands/doctor.js';
import { getDoctorRuntimeSettings } from '../src/cli/commands/doctor.js';

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

describe('doctor command', () => {
  test('builds a machine-readable readiness payload', () => {
    const report = buildDoctorReport(
      [
        { name: 'API Server', status: 'pass' },
        { name: 'Neo4j', status: 'pass' },
        { name: 'Redis', status: 'warn', message: 'Slow startup' },
      ],
      {
        apiUrl: 'http://localhost:3000',
        batchSize: 100,
        workerConcurrency: 5,
        decisionConcurrency: 10,
        cloneConcurrency: 10,
        activeFrontier: 100,
        decisionBatchSize: 20,
        decisionBatchFlushMs: 40,
        llmRpmLimit: 30,
        llmProvider: 'openrouter',
        llmConfigSource: 'config',
        embeddingConfigSource: 'config',
      },
    );

    expect(report).toEqual({
      ok: true,
      apiUrl: 'http://localhost:3000',
      runtime: {
        apiUrl: 'http://localhost:3000',
        batchSize: 100,
        workerConcurrency: 5,
        decisionConcurrency: 10,
        cloneConcurrency: 10,
        activeFrontier: 100,
        decisionBatchSize: 20,
        decisionBatchFlushMs: 40,
        llmRpmLimit: 30,
        llmProvider: 'openrouter',
        llmConfigSource: 'config',
        embeddingConfigSource: 'config',
      },
      checks: [
        { name: 'API Server', status: 'pass' },
        { name: 'Neo4j', status: 'pass' },
        { name: 'Redis', status: 'warn', message: 'Slow startup' },
      ],
      summary: {
        passCount: 2,
        failCount: 0,
        warnCount: 1,
      },
    });
  });

  test('marks the report as not ok when any critical check fails', () => {
    const report = buildDoctorReport(
      [{ name: 'API Server', status: 'fail', message: 'Cannot reach API' }],
      {
        apiUrl: 'http://localhost:3000',
        batchSize: 100,
        workerConcurrency: 5,
        decisionConcurrency: 10,
        cloneConcurrency: 10,
        activeFrontier: 100,
        decisionBatchSize: 20,
        decisionBatchFlushMs: 40,
        llmRpmLimit: null,
        llmProvider: 'openrouter',
        llmConfigSource: 'config',
        embeddingConfigSource: 'config',
      },
    );

    expect(report.ok).toBe(false);
    expect(report.summary.failCount).toBe(1);
  });

  test('resolves runtime defaults without requiring server credentials', () => {
    const originalBatchSize = process.env.SIMULATION_BATCH_SIZE;
    const originalConcurrency = process.env.SIMULATION_CONCURRENCY;
    const originalWorkerConcurrency = process.env.SIMULATION_WORKER_CONCURRENCY;
    const originalDecisionBatchSize = process.env.SIMULATION_DECISION_BATCH_SIZE;
    const originalDecisionBatchFlushMs = process.env.SIMULATION_DECISION_BATCH_FLUSH_MS;
    const originalRpm = process.env.LLM_RPM_LIMIT;
    const originalNodeEnv = process.env.NODE_ENV;

    delete process.env.SIMULATION_BATCH_SIZE;
    delete process.env.SIMULATION_CONCURRENCY;
    delete process.env.SIMULATION_WORKER_CONCURRENCY;
    delete process.env.SIMULATION_DECISION_BATCH_SIZE;
    delete process.env.SIMULATION_DECISION_BATCH_FLUSH_MS;
    delete process.env.LLM_RPM_LIMIT;
    process.env.NODE_ENV = 'development';

    expect(getDoctorRuntimeSettings()).toMatchObject({
      batchSize: 100,
      decisionConcurrency: 10,
      cloneConcurrency: 10,
      activeFrontier: 100,
      workerConcurrency: 5,
      decisionBatchSize: 20,
      decisionBatchFlushMs: 40,
      llmRpmLimit: null,
    });

    restoreEnv('SIMULATION_BATCH_SIZE', originalBatchSize);
    restoreEnv('SIMULATION_CONCURRENCY', originalConcurrency);
    restoreEnv('SIMULATION_WORKER_CONCURRENCY', originalWorkerConcurrency);
    restoreEnv('SIMULATION_DECISION_BATCH_SIZE', originalDecisionBatchSize);
    restoreEnv('SIMULATION_DECISION_BATCH_FLUSH_MS', originalDecisionBatchFlushMs);
    restoreEnv('LLM_RPM_LIMIT', originalRpm);
    restoreEnv('NODE_ENV', originalNodeEnv);
  });
});
