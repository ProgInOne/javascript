import type { z } from 'zod';

/**
 * A JSON column value that failed its schema on read (docs/design/data-model.md#json-컬럼-원칙).
 * The request fails with INTERNAL (the error handler logs table, key and issues); other features
 * keep working.
 */
export class CorruptRowError extends Error {
  constructor(table: string, key: string, issues: string) {
    super(`corrupt ${table} row ${key}: ${issues}`);
    this.name = 'CorruptRowError';
  }
}

/** Validates a value before it is written to a `*_json` column. A failure is a server bug. */
export function forWrite<T extends z.ZodType>(
  schema: T,
  value: unknown,
  column: string,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new Error(`refusing to write invalid ${column}: ${parsed.error.message}`);
  return parsed.data;
}

/** Validates a `*_json` column value after reading it. */
export function fromRow<T extends z.ZodType>(
  schema: T,
  value: unknown,
  table: string,
  key: string,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CorruptRowError(table, key, parsed.error.message);
  return parsed.data;
}
