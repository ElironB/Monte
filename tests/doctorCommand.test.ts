import { describe, expect, test } from 'vitest';
import { buildDoctorReport } from '../src/cli/commands/doctor.js';

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
        cloneConcurrency: 10,
        llmRpmLimit: 30,
      },
    );

    expect(report).toEqual({
      ok: true,
      apiUrl: 'http://localhost:3000',
      runtime: {
        apiUrl: 'http://localhost:3000',
        batchSize: 100,
        workerConcurrency: 5,
        cloneConcurrency: 10,
        llmRpmLimit: 30,
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
        cloneConcurrency: 10,
        llmRpmLimit: null,
      },
    );

    expect(report.ok).toBe(false);
    expect(report.summary.failCount).toBe(1);
  });
});
