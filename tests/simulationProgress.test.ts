import { describe, expect, test } from 'vitest';
import { calculateSimulationProgress, estimateTimeRemainingSeconds } from '../src/simulation/progress.js';

describe('simulation progress helpers', () => {
  test('caps in-flight progress at 99% until the simulation is completed', () => {
    expect(calculateSimulationProgress(1_000, 1_000, 'running')).toBe(99);
    expect(calculateSimulationProgress(1_000, 1_000, 'aggregating')).toBe(99);
    expect(calculateSimulationProgress(1_000, 1_000, 'completed')).toBe(100);
  });

  test('estimates remaining seconds from observed clone throughput', () => {
    expect(estimateTimeRemainingSeconds(1_000, 40, 100, 21_000)).toBe(30);
  });
});
