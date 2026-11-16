import { z } from 'zod';
import { runFileSchema } from './run-protocol.ts';

// Server-side code drafts (FR-CODE-06, NFR-04; data-model.md#code_drafts). The code is learner
// text: the server stores and returns it, and never runs or interprets it.

/** What a draft belongs to: a code exercise, or a lesson's `<RunnableExample>`. */
export const CODE_DRAFT_KINDS = ['exercise', 'example'] as const;
export type CodeDraftKind = (typeof CODE_DRAFT_KINDS)[number];

/** Total UTF-8 size of a draft's files. Starter code is a few KB; this leaves ample room. */
export const CODE_DRAFT_MAX_BYTES = 256 * 1024;
export const CODE_DRAFT_MAX_FILES = 20;

/** `<RunnableExample id>` inside a lesson (content-schema slug segment). */
export const exampleIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/** UTF-8 byte length (no `TextEncoder`: this package has no DOM or Node types). */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export const codeDraftFileSchema = z
  .object({
    path: runFileSchema.shape.path,
    content: z.string().max(200_000),
  })
  .strict();
export type CodeDraftFile = z.infer<typeof codeDraftFileSchema>;

export const codeDraftFilesSchema = z
  .array(codeDraftFileSchema)
  .min(1)
  .max(CODE_DRAFT_MAX_FILES)
  .superRefine((files, ctx) => {
    const seen = new Set<string>();
    for (const [i, f] of files.entries()) {
      if (seen.has(f.path))
        ctx.addIssue({ code: 'custom', message: `duplicate path ${f.path}`, path: [i, 'path'] });
      seen.add(f.path);
    }
    const bytes = files.reduce((sum, f) => sum + utf8Length(f.content), 0);
    if (bytes > CODE_DRAFT_MAX_BYTES)
      ctx.addIssue({
        code: 'custom',
        message: `draft is larger than ${String(CODE_DRAFT_MAX_BYTES)} bytes`,
      });
  });

/**
 * `PUT /code-drafts/exercises/:id`, `PUT /lessons/:id/example-drafts/:exampleId`. `updatedAt` is
 * the edit time in the browser: a write older than the stored draft is ignored (another tab or a
 * late request), so the newest edit wins.
 */
export const codeDraftPutSchema = z
  .object({
    files: codeDraftFilesSchema,
    updatedAt: z.int().min(0).max(8_640_000_000_000_000),
    /** Practice set item the draft was written in (exercises only); restores only into it. */
    practiceSetItemId: z
      .string()
      .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)
      .nullable()
      .optional(),
  })
  .strict();
export type CodeDraftPut = z.infer<typeof codeDraftPutSchema>;

export const codeDraftSchema = z.object({
  kind: z.enum(CODE_DRAFT_KINDS),
  /** Exercise ID, or the example's `<RunnableExample id>`. */
  id: z.string(),
  files: z.array(codeDraftFileSchema),
  updatedAt: z.int(),
  practiceSetItemId: z.string().nullable(),
});
export type CodeDraft = z.infer<typeof codeDraftSchema>;

export const codeDraftResponseSchema = z.object({ draft: codeDraftSchema.nullable() });
export type CodeDraftResponse = z.infer<typeof codeDraftResponseSchema>;

/** `applied: false`: the stored draft was newer and is returned unchanged. */
export const codeDraftPutResponseSchema = z.object({
  draft: codeDraftSchema,
  applied: z.boolean(),
});
export type CodeDraftPutResponse = z.infer<typeof codeDraftPutResponseSchema>;

/** `GET /lessons/:id/example-drafts`: every edited example of a lesson. */
export const exampleDraftListSchema = z.object({ drafts: z.array(codeDraftSchema) });
export type ExampleDraftList = z.infer<typeof exampleDraftListSchema>;
