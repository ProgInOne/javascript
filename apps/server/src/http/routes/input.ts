import { hasProtoKey, withinDepth } from '@proginone/shared';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { AppError } from '../errors.ts';

// Shared request parsing for the practice routes. Bodies are untrusted: size-limited, parsed
// with depth and `__proto__` guards, then validated with the route's zod schema.

const invalid = (message: string) => new AppError('VALIDATION_FAILED', 400, message);

/** Rejects bodies over `maxSize` bytes with 413 before they are read. */
export function limitBody(maxSize: number) {
  return bodyLimit({
    maxSize,
    onError: () => {
      throw new AppError('VALIDATION_FAILED', 413, '요청 본문이 너무 큽니다.', {
        details: { maxBytes: maxSize },
      });
    },
  });
}

/**
 * Parses a JSON body. An empty body yields `empty` when given (optional bodies), otherwise it is
 * an error.
 */
export async function jsonBody(c: Context, empty?: unknown): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '') {
    if (empty !== undefined) return empty;
    throw invalid('요청 본문이 비어 있습니다.');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalid('요청 본문이 JSON이 아닙니다.');
  }
  if (!withinDepth(value) || hasProtoKey(value))
    throw invalid('요청 본문 구조가 올바르지 않습니다.');
  return value;
}

/** Content IDs: slugs, template variants (`…@seed`) and generated IDs (`gen.<ULID>`). */
const contentIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._@-]*$/);

export function contentIdParam(value: string): string {
  const parsed = contentIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError('NOT_FOUND', 404, '찾을 수 없습니다.', {
      details: { id: value.slice(0, 200) },
    });
  }
  return parsed.data;
}

/** User-data IDs (ULIDs). */
const rowIdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);

export function rowIdParam(value: string): string {
  const parsed = rowIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError('NOT_FOUND', 404, '찾을 수 없습니다.', {
      details: { id: value.slice(0, 64) },
    });
  }
  return parsed.data;
}
