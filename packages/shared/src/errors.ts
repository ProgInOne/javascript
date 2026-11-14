import { z } from 'zod';

/**
 * AI error codes (docs/design/ai-system.md#providerAdapter-인터페이스).
 * - `AI_NOT_CONNECTED`: not logged in, or the provider process is not running.
 * - `AI_UNAVAILABLE`: AI is disabled on this machine (Codex not installed, unsupported version,
 *   tutor isolation check failed, restarts exhausted). `details.reason` says which.
 * - `AI_LOCKED_IN_ASSESSMENT`: policy refusal by the service layer (assessment context).
 */
export const AI_ERROR_CODES = [
  'AI_NOT_CONNECTED',
  'AI_UNAUTHORIZED',
  'AI_RATE_LIMITED',
  'AI_CONTEXT_TOO_LARGE',
  'AI_TIMEOUT',
  'AI_CANCELLED',
  'AI_BAD_OUTPUT',
  'AI_PROVIDER_ERROR',
  'AI_OVERLOADED',
  'AI_UNAVAILABLE',
  'AI_LOCKED_IN_ASSESSMENT',
] as const;
export type AIErrorCode = (typeof AI_ERROR_CODES)[number];

/**
 * Stable API error codes. The web app branches on `code`; `message` is display text only.
 * Prefixes follow docs/design/system-architecture.md#api-규약.
 * AI_* codes are owned by docs/design/ai-system.md (provider errors normalized by packages/ai,
 * plus the service-level policy code `AI_LOCKED_IN_ASSESSMENT`).
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'VALIDATION_ANSWER_INVALID',
  'VALIDATION_RUN_RESULT_INVALID',
  'NOT_FOUND',
  'FORBIDDEN_HOST',
  'FORBIDDEN_ORIGIN',
  'UNAUTHORIZED',
  'MAINTENANCE',
  'CONTENT_UNAVAILABLE',
  'EXERCISE_UNSUPPORTED',
  'EXERCISE_NOT_RUNNABLE',
  'EXERCISE_RUN_REQUIRED',
  'EXERCISE_HINTS_EXHAUSTED',
  'EXERCISE_SOLUTION_LOCKED',
  'EXERCISE_HINT_REQUIRED',
  'PRACTICE_NO_EXERCISES',
  'PRACTICE_NOTHING_DUE',
  'PRACTICE_SET_CLOSED',
  'PRACTICE_ITEM_MISMATCH',
  'PRACTICE_ITEM_DONE',
  'PRACTICE_NOTHING_WEAK',
  /** `POST /attempts/:id/explanation` on a correct attempt (nothing to explain). */
  'ATTEMPT_CORRECT',
  'BACKUP_FAILED',
  'BACKUP_NOT_FOUND',
  'RESTORE_FAILED',
  ...AI_ERROR_CODES,
  'INTERNAL',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Builds the wire-format error body. */
export function apiError(
  code: ErrorCode,
  message: string,
  options: { retryable?: boolean; details?: Record<string, unknown> } = {},
): ApiError {
  return {
    error: {
      code,
      message,
      retryable: options.retryable ?? false,
      ...(options.details ? { details: options.details } : {}),
    },
  };
}
