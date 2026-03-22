export function stripCodeFence(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  }
  return cleaned.trim();
}

export function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;

    if (depth === 0) {
      return raw.slice(start, i + 1);
    }
  }

  return null;
}

/** Attempt to close a truncated JSON object by appending brackets/values. */
export function repairTruncatedJson(raw: string): string | null {
  const t = raw.trim();
  if (!t.startsWith('{')) return null;

  // Most common case: object truncated before the closing brace
  const closers = ['}', '"}', '0}', '0.8}', 'null}'];
  for (const closer of closers) {
    try {
      JSON.parse(t + closer);
      return t + closer;
    } catch { /* try next */ }
  }

  // Drop the last incomplete key-value pair (everything after the last complete comma)
  const lastComma = t.lastIndexOf(',');
  if (lastComma > 0) {
    const truncated = t.slice(0, lastComma) + '}';
    try {
      JSON.parse(truncated);
      return truncated;
    } catch { /* try next */ }
  }

  return null;
}

export function parseJsonResponse<T>(raw: string): T {
  const cleaned = stripCodeFence(raw);

  try {
    return JSON.parse(cleaned) as T;
  } catch { /* try extraction */ }

  const extracted = extractFirstJsonObject(cleaned);
  if (extracted) {
    try {
      return JSON.parse(extracted) as T;
    } catch { /* try repair */ }
  }

  // Last resort: try to repair truncated JSON
  const repaired = repairTruncatedJson(extracted ?? cleaned);
  if (repaired) {
    try {
      return JSON.parse(repaired) as T;
    } catch { /* give up */ }
  }

  const preview = cleaned.slice(0, 200) || '[empty response]';
  throw new Error(`LLM returned invalid or incomplete JSON: ${preview}`);
}
