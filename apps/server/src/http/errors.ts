import { isAIError, type AIError, type AIErrorCode } from '@proginone/ai';
import { apiError, type ErrorCode } from '@proginone/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import type { Logger } from '../observability/logger.ts';

/** An expected failure with a stable code. Anything else becomes INTERNAL. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ContentfulStatusCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    status: ContentfulStatusCode,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function errorResponse(c: Context, err: AppError) {
  return c.json(
    apiError(err.code, err.message, {
      retryable: err.retryable,
      ...(err.details ? { details: err.details } : {}),
    }),
    err.status,
  );
}

/**
 * HTTP status per AI error code. 401 is avoided on purpose: the web app treats 401 as an expired
 * session token (`UNAUTHORIZED`), while `AI_UNAUTHORIZED` only needs a new ChatGPT login.
 */
const AI_STATUS: Record<AIErrorCode, ContentfulStatusCode> = {
  AI_NOT_CONNECTED: 409,
  AI_UNAUTHORIZED: 409,
  AI_RATE_LIMITED: 429,
  AI_CONTEXT_TOO_LARGE: 413,
  AI_TIMEOUT: 504,
  AI_CANCELLED: 409,
  AI_BAD_OUTPUT: 502,
  AI_PROVIDER_ERROR: 502,
  AI_OVERLOADED: 503,
  AI_UNAVAILABLE: 503,
  AI_LOCKED_IN_ASSESSMENT: 403,
};

/** An `AIError` as an API error (code, Korean message, retryable, details). */
export function aiAppError(e: AIError): AppError {
  return new AppError(e.code, AI_STATUS[e.code], e.message, {
    retryable: e.retryable,
    ...(e.details ? { details: e.details } : {}),
    cause: e,
  });
}

/** Hono onError handler: maps known errors, hides internals (stack goes to the log only). */
export function handleError(err: Error, c: Context, log: Logger) {
  if (err instanceof AppError) return errorResponse(c, err);
  if (isAIError(err)) return errorResponse(c, aiAppError(err));
  if (err instanceof ZodError) {
    return errorResponse(
      c,
      new AppError('VALIDATION_FAILED', 400, '요청 값이 올바르지 않습니다.', {
        details: {
          issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      }),
    );
  }
  log.error({ err, requestId: c.get('requestId') }, 'unhandled error');
  return errorResponse(c, new AppError('INTERNAL', 500, '예기치 않은 오류가 발생했습니다.'));
}
