import { describe, expect, test } from 'vitest';
import { parseJsonResponse } from '../../src/persona/syntheticGenerator.js';

describe('parseJsonResponse', () => {
  test('parses JSON wrapped in code fences', () => {
    const parsed = parseJsonResponse('```json\n{"searches":[{"query":"career growth","timestamp":"2026-03-01T12:00:00Z"}]}\n```') as {
      searches: Array<{ query: string }>;
    };

    expect(parsed.searches[0]?.query).toBe('career growth');
  });

  test('extracts the first JSON object from extra surrounding text', () => {
    const parsed = parseJsonResponse('Here is your data:\n{"history":[{"title":"Day trading mistakes","date":"2026-03-01"}]}\nThanks!') as {
      history: Array<{ title: string }>;
    };

    expect(parsed.history[0]?.title).toBe('Day trading mistakes');
  });

  test('throws a clearer error for incomplete JSON', () => {
    expect(() => parseJsonResponse('{"posts":[{"title":"help me')).toThrow(/invalid or incomplete JSON/i);
  });
});
