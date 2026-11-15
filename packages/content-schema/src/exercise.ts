import { z } from 'zod';
import { conceptId, exerciseId, misconceptionId } from './slug.ts';

/** Allowed `review.reviewedBy` values (D-027). */
export const REVIEWERS = ['human', 'ai:reviewer'] as const;

export const EXERCISE_USAGES = [
  'practice',
  'assessment',
  'diagnostic',
  'remedial',
  'worked_example',
  /** The milestone `web_task` of a `kind: project` unit (only served on the project screen). */
  'project',
] as const;

/**
 * Common fields of an exercise YAML (docs/design/content-and-exercises.md#문제-파일-형식-공통-필드).
 * `spec` is type-specific and validated by the exercise-kit registry, not here.
 */
export const exerciseSourceSchema = z
  .strictObject({
    id: exerciseId,
    type: z.string().regex(/^[a-z][a-z0-9_]*$/),
    difficulty: z.number().int().min(1).max(5),
    concepts: z.array(z.strictObject({ id: conceptId, weight: z.number().gt(0).max(1) })).min(1),
    tags: z.array(z.string().min(1)).default([]),
    estimatedSeconds: z.number().int().min(5).max(3600),
    usage: z.enum(EXERCISE_USAGES).default('practice'),
    workedExampleStage: z
      .union([z.literal(0), z.literal(1), z.literal(2)])
      .nullable()
      .default(null),
    variantGroup: z.string().min(1).nullable().default(null),
    prompt: z.string().min(1),
    code: z.string().optional(),
    spec: z.record(z.string(), z.unknown()),
    hints: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)], {
      message: '힌트는 정확히 3개여야 합니다',
    }),
    explanation: z.string().min(1),
    misconceptions: z.array(misconceptionId).default([]),
    origin: z.literal('authored').default('authored'),
    review: z.strictObject({
      status: z.enum(['draft', 'approved']),
      draftedBy: z.string().regex(/^(human|ai:[a-z0-9-]+)$/),
      /**
       * Who approved it (D-027): a person, or an independent AI reviewer working in a separate
       * context from the drafter. Must differ from `draftedBy`.
       */
      reviewedBy: z.enum(REVIEWERS).optional(),
    }),
  })
  .superRefine((ex, ctx) => {
    const primary = ex.concepts.filter((c) => c.weight === 1);
    if (primary.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['concepts'],
        message: '주 개념(weight: 1)이 정확히 1개여야 합니다',
      });
    }
    if (ex.usage === 'worked_example' && ex.workedExampleStage === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['workedExampleStage'],
        message: 'worked_example에는 단계가 필요합니다',
      });
    }
    if (ex.review.status === 'approved' && ex.review.reviewedBy === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['review', 'reviewedBy'],
        message: '승인된 문제는 검토자(reviewedBy: human 또는 ai:reviewer)가 필요합니다',
      });
    }
    if (ex.review.reviewedBy !== undefined && ex.review.reviewedBy === ex.review.draftedBy) {
      ctx.addIssue({
        code: 'custom',
        path: ['review', 'reviewedBy'],
        message: '초안 작성자가 스스로 검토할 수 없습니다(reviewedBy는 draftedBy와 달라야 합니다)',
      });
    }
  });
export type ExerciseSource = z.infer<typeof exerciseSourceSchema>;

/** Markdown fields must not contain raw HTML (inline code spans are fine). */
export function containsRawHtml(markdown: string): boolean {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return /<\/?[a-zA-Z][\w-]*(\s[^>]*)?>/.test(withoutCode);
}
