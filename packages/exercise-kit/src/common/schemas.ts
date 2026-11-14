import { z } from 'zod';

import type { JsonValue } from './values.ts';

/** Local IDs inside one exercise (option, blank, check, milestone, choice). */
export const localIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/);

/** Markdown/plain text shown to the learner (raw HTML is rejected by content-schema). */
export const displayTextSchema = z.string().min(1).max(4_000);

/** Source code embedded in a spec. */
export const codeTextSchema = z.string().max(100_000);

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string().max(100_000),
    z.array(jsonValueSchema).max(10_000),
    z.record(z.string().max(1_000), jsonValueSchema),
  ]),
);

/** Adds a custom issue when IDs repeat. */
export function uniqueIds(
  ids: readonly string[],
  ctx: z.RefinementCtx,
  path: (string | number)[],
  label: string,
): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      ctx.addIssue({
        code: 'custom',
        message: `duplicate ${label} id: ${id}`,
        path: [...path, index],
      });
    }
    seen.add(id);
  });
}
