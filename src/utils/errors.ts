export class MonteError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends MonteError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

export class AuthenticationError extends MonteError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTHENTICATION_ERROR', 401);
  }
}

export class NotFoundError extends MonteError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
  }
}

export class ConflictError extends MonteError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409);
  }
}

export function getErrorResponse(error: unknown): { message: string; code: string; statusCode: number } {
  if (error instanceof MonteError) {
    return { message: error.message, code: error.code, statusCode: error.statusCode };
  }
  if (error instanceof Error) {
    return { message: error.message, code: 'INTERNAL_ERROR', statusCode: 500 };
  }
  return { message: 'Unknown error', code: 'UNKNOWN_ERROR', statusCode: 500 };
}
