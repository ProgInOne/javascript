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

/** Hono onError handler: maps known errors, hides internals (stack goes to the log only). */
export function handleError(err: Error, c: Context, log: Logger) {
  if (err instanceof AppError) return errorResponse(c, err);
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
