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

export function parseJsonResponse<T>(raw: string): T {
  const cleaned = stripCodeFence(raw);

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const extracted = extractFirstJsonObject(cleaned);
    if (extracted) {
      return JSON.parse(extracted) as T;
    }
  }

  const preview = cleaned.slice(0, 200) || '[empty response]';
  throw new Error(`LLM returned invalid or incomplete JSON: ${preview}`);
}
