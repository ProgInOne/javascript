import { z } from 'zod';
import { conceptId, courseId, lessonAnchor, misconceptionId, exerciseId, trackId } from './slug.ts';

export const IMPORTANCE = ['core', 'standard', 'minor'] as const;
export const importance = z.enum(IMPORTANCE);

/** content/pack.yaml */
export const packSchema = z
  .object({
    id: z.string().min(1),
    version: z
      .string()
      .regex(/^\d{4}\.\d{2}\.\d{2}\.\d+$/, { message: 'YYYY.MM.DD.N 형식이어야 합니다' }),
    schemaVersion: z.literal(1),
    title: z.string().min(1),
    /** Tracks group courses on the course list; order is the list order. */
    tracks: z
      .array(
        z.strictObject({
          id: trackId,
          title: z.string().min(1),
          summary: z.string().min(1),
          courses: z.array(courseId).min(1),
        }),
      )
      .min(1),
  })
  .strict();
export type Pack = z.infer<typeof packSchema>;

const prerequisite = z.union([
  conceptId,
  z.strictObject({ id: conceptId, strength: z.enum(['required', 'helpful']) }),
]);

/** One entry of content/concepts/<lang>.yaml */
export const conceptSchema = z.strictObject({
  id: conceptId,
  title: z.string().min(1),
  importance,
  summary: z.string().min(1),
  prerequisites: z.array(prerequisite).default([]),
  misconceptions: z.array(misconceptionId).default([]),
  /** MDN path, e.g. `Web/JavaScript/Reference/Statements/return`. */
  mdn: z
    .string()
    .regex(/^Web\/[\w./-]+$/)
    .optional(),
});
export type ConceptSource = z.infer<typeof conceptSchema>;
export const conceptsFileSchema = z.array(conceptSchema);

/** One entry of content/misconceptions/<lang>.yaml */
export const misconceptionSchema = z.strictObject({
  id: misconceptionId,
  concept: conceptId,
  /** Short name shown in feedback, e.g. "`==`와 `===`를 같다고 생각함". */
  title: z.string().min(1),
  statement: z.string().min(1),
  reality: z.string().min(1),
  diagnosticHint: z.string().min(1).optional(),
  remediation: z
    .strictObject({
      lessonSection: lessonAnchor.optional(),
      exercises: z.array(exerciseId).default([]),
    })
    .optional(),
});
export type MisconceptionSource = z.infer<typeof misconceptionSchema>;
export const misconceptionsFileSchema = z.array(misconceptionSchema);
