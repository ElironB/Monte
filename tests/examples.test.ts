import { describe, expect, test } from 'vitest';
import { existsSync } from 'fs';
import { assertBundledExamplePersonaExists, getBundledExamplePersona, listBundledExamplePersonas } from '../src/cli/examples.js';

describe('bundled example personas', () => {
  test('ships a starter persona that is discoverable from the CLI', () => {
    const example = getBundledExamplePersona('starter');

    expect(example.id).toBe('starter');
    expect(example.recommendedScenario).toBe('startup_founding');
  });

  test('resolves the bundled example persona path inside the package', () => {
    const path = assertBundledExamplePersonaExists('starter');

    expect(existsSync(path)).toBe(true);
  });

  test('lists all bundled example personas', () => {
    expect(listBundledExamplePersonas().map((entry) => entry.id)).toContain('starter');
  });
});
