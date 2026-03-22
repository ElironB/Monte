import { describe, expect, test } from 'vitest';
import { formatBenchmarkSummary, runBenchmarkSuite } from '../../src/benchmarks/harness.js';

describe('Phase 3 benchmark harness', () => {
  test('produces a passing machine-readable summary across the fixture corpus', async () => {
    const summary = await runBenchmarkSuite();

    expect(summary.version).toBe('phase3-v2');
    expect(summary.fixtureCount).toBeGreaterThanOrEqual(3);
    expect(summary.pass).toBe(true);
    expect(summary.metrics.meanCalibrationError).toBeLessThanOrEqual(0.2);
    expect(summary.metrics.meanUncertaintyReduction).toBeGreaterThan(0.02);
    expect(summary.metrics.maxStabilityDrift).toBe(0);
  });

  test('renders a readable benchmark summary for human inspection', async () => {
    const summary = await runBenchmarkSuite();
    const formatted = formatBenchmarkSummary(summary);

    expect(formatted).toContain('Calibration MAE');
    expect(formatted).toContain('Policy regret');
    expect(formatted).toContain('uncertaintyReduction');
    expect(formatted).toContain('stability');
  });
});
