import { z } from 'zod';

/**
 * Stable API error codes. The web app branches on `code`; `message` is display text only.
 * Prefixes follow docs/design/system-architecture.md#api-규약.
 * AI_* codes are owned by docs/design/ai-system.md and are added with packages/ai.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'FORBIDDEN_HOST',
  'FORBIDDEN_ORIGIN',
  'UNAUTHORIZED',
  'MAINTENANCE',
  'BACKUP_FAILED',
  'BACKUP_NOT_FOUND',
  'RESTORE_FAILED',
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
