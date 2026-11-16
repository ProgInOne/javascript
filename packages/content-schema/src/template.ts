import { z } from 'zod';
import { REVIEWERS } from './exercise.ts';
import { conceptId, misconceptionId, templateId } from './slug.ts';

/** Usages a template may have: variants are served in practice, review and relearning sets. */
export const TEMPLATE_USAGES = ['practice', 'remedial'] as const;

/** Default number of build-time sample seeds per template (content-and-exercises.md#정답의-실행-계산). */
export const DEFAULT_TEMPLATE_SAMPLE_SIZE = 50;
/** Hard limits for `variantPolicy.sampleSize` (each sample runs several times in `check --run`). */
export const TEMPLATE_SAMPLE_SIZE_RANGE = { min: 5, max: 100 } as const;
/** Fewer distinct verified variants than this and the template is not worth its review cost. */
export const MIN_TEMPLATE_POOL = 5;

/**
 * Common fields of a parametric template YAML
 * (docs/design/content-and-exercises.md#템플릿-파일-형식). `params`, `constraints`, `render` and
 * `spec` are validated by the exercise-kit template engine (instantiating sample seeds), not here.
 * Text fields may use `{{ expr }}` (template expression language).
 */
export const templateSourceSchema = z
  .strictObject({
    id: templateId,
    type: z.string().regex(/^[a-z][a-z0-9_]*$/),
    difficulty: z.number().int().min(1).max(5),
    concepts: z.array(z.strictObject({ id: conceptId, weight: z.number().gt(0).max(1) })).min(1),
    tags: z.array(z.string().min(1)).default([]),
    estimatedSeconds: z.number().int().min(5).max(3600),
    usage: z.enum(TEMPLATE_USAGES).default('practice'),
    /** Variant group key; default: the template ID (all variants count as one group). */
    variantGroup: z.string().min(1).nullable().default(null),
    params: z.record(z.string(), z.unknown()),
    constraints: z.array(z.string().min(1)).default([]),
    /** `prompt` and optional `code` shown above the exercise. */
    render: z.strictObject({ prompt: z.string().min(1), code: z.string().min(1).optional() }),
    spec: z.record(z.string(), z.unknown()),
    hints: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)], {
      message: '힌트는 정확히 3개여야 합니다',
    }),
    explanation: z.string().min(1),
    misconceptions: z.array(misconceptionId).default([]),
    variantPolicy: z
      .strictObject({
        /** Build-time sample seeds (the verified pool the server serves from). */
        sampleSize: z
          .number()
          .int()
          .min(TEMPLATE_SAMPLE_SIZE_RANGE.min)
          .max(TEMPLATE_SAMPLE_SIZE_RANGE.max)
          .default(DEFAULT_TEMPLATE_SAMPLE_SIZE),
        /** Upper bound of meaningfully different variants (informational, counting). */
        maxVariants: z.number().int().min(1).max(1_000_000).optional(),
        /** A new variant's answer must differ from the last N variants the learner saw. */
        minDistinctFromRecent: z.number().int().min(0).max(20).default(3),
      })
      .prefault({}),
    origin: z.literal('template').default('template'),
    review: z.strictObject({
      status: z.enum(['draft', 'approved']),
      draftedBy: z.string().regex(/^(human|ai:[a-z0-9-]+)$/),
      reviewedBy: z.enum(REVIEWERS).optional(),
    }),
  })
  .superRefine((tpl, ctx) => {
    const primary = tpl.concepts.filter((c) => c.weight === 1);
    if (primary.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['concepts'],
        message: '주 개념(weight: 1)이 정확히 1개여야 합니다',
      });
    }
    if (tpl.review.status === 'approved' && tpl.review.reviewedBy === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['review', 'reviewedBy'],
        message: '승인된 템플릿은 검토자(reviewedBy: human 또는 ai:reviewer)가 필요합니다',
      });
    }
    if (tpl.review.reviewedBy !== undefined && tpl.review.reviewedBy === tpl.review.draftedBy) {
      ctx.addIssue({
        code: 'custom',
        path: ['review', 'reviewedBy'],
        message: '초안 작성자가 스스로 검토할 수 없습니다(reviewedBy는 draftedBy와 달라야 합니다)',
      });
    }
  });
export type TemplateSource = z.infer<typeof templateSourceSchema>;
