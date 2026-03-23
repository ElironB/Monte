import { MonteAPIError } from './api.js';

interface JsonErrorPayload {
  ok: false;
  error: {
    code: string;
    message: string;
    status?: number;
  };
}

export function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

export function buildJsonErrorPayload(error: unknown): JsonErrorPayload {
  if (error instanceof MonteAPIError) {
    return {
      ok: false,
      error: {
        code: error.code || 'API_ERROR',
        message: error.message,
        status: error.status,
      },
    };
  }

  if (error instanceof Error) {
    return {
      ok: false,
      error: {
        code: 'CLI_ERROR',
        message: error.message,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'UNKNOWN_ERROR',
      message: 'Unknown error',
    },
  };
}

export function printJsonErrorAndExit(error: unknown): never {
  printJson(buildJsonErrorPayload(error));
  process.exit(1);
}
