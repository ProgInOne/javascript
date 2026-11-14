import { z } from 'zod';

import { leakSet } from '../common/normalize.ts';
import { createRng, seedFromString } from '../common/prng.ts';
import { displayTextSchema, localIdSchema, uniqueIds } from '../common/schemas.ts';
import { misconceptionIdSchema } from '../core/ids.ts';
import { buildResult } from '../core/result.ts';
import type { ExerciseTypeDef, FeedbackItem, VerifyIssue } from '../core/types.ts';

/** docs/design/content-and-exercises.md#true_false-참거짓 */
const VERSION = 1;

/** Score when the true/false verdict is right but the required reason is wrong or missing. */
export const TRUE_FALSE_VERDICT_ONLY_SCORE = 0.5;

/**
 * Mastery evidence weight (learning-engine.md W_type): a 50% guess rate makes true/false the
 * weakest signal, below the recognition default of 0.7.
 */
export const TRUE_FALSE_WEIGHT = 0.5;

const reasonSchema = z.object({
  id: localIdSchema,
  text: displayTextSchema,
  /** Answer key: exactly one reason is correct. */
  correct: z.boolean().default(false),
  /** Misconception suggested by choosing this reason (answer key). */
  misconception: misconceptionIdSchema.optional(),
});

export const trueFalseSpecSchema = z
  .object({
    statement: displayTextSchema,
    /** Answer key. */
    answer: z.boolean(),
    /** Misconception suggested by the wrong verdict (answer key). */
    misconceptionIfWrong: misconceptionIdSchema.optional(),
    /** Ask for a reason too (anti-guessing; recommended from L2). */
    requireReason: z.boolean().default(false),
    reasons: z.array(reasonSchema).min(2).max(5).optional(),
    shuffle: z.boolean().default(true),
  })
  .superRefine((spec, ctx) => {
    if (spec.reasons) {
      uniqueIds(
        spec.reasons.map((r) => r.id),
        ctx,
        ['reasons'],
        'reason',
      );
      if (spec.reasons.filter((r) => r.correct).length !== 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'exactly one reason must be correct',
          path: ['reasons'],
        });
      }
    }
    if (spec.requireReason && !spec.reasons) {
      ctx.addIssue({
        code: 'custom',
        message: 'requireReason needs reasons',
        path: ['reasons'],
      });
    }
  });
export type TrueFalseSpec = z.infer<typeof trueFalseSpecSchema>;

export const trueFalsePublicSpecSchema = z.object({
  statement: displayTextSchema,
  /** Present only when a reason must be chosen. */
  reasons: z.array(z.object({ id: localIdSchema, text: displayTextSchema })).optional(),
});
export type TrueFalsePublicSpec = z.infer<typeof trueFalsePublicSpecSchema>;

export const trueFalseAnswerSchema = z.object({
  value: z.boolean(),
  reasonId: z.string().max(64).optional(),
});
export type TrueFalseAnswer = z.infer<typeof trueFalseAnswerSchema>;

export const trueFalse: ExerciseTypeDef<TrueFalseSpec, TrueFalsePublicSpec, TrueFalseAnswer> = {
  id: 'true_false',
  version: VERSION,
  category: 'recognition',
  weightOverride: TRUE_FALSE_WEIGHT,
  specSchema: trueFalseSpecSchema,
  publicSpecSchema: trueFalsePublicSpecSchema,
  answerSchema: trueFalseAnswerSchema,
  requiresRun: () => false,

  redact(spec, options = {}) {
    const out: TrueFalsePublicSpec = { statement: spec.statement };
    if (spec.requireReason && spec.reasons) {
      const reasons = spec.reasons.map(({ id, text }) => ({ id, text }));
      out.reasons =
        spec.shuffle && options.shuffleSeed !== undefined
          ? createRng(seedFromString(options.shuffleSeed)).shuffle(reasons)
          : reasons;
    }
    return out;
  },

  grade({ spec, answer }) {
    const verdictRight = answer.value === spec.answer;
    const feedback: FeedbackItem[] = [];
    const misconceptions: (string | undefined)[] = [];
    let reasonRight = true;
    if (spec.requireReason && spec.reasons) {
      const reason =
        answer.reasonId === undefined
          ? undefined
          : spec.reasons.find((r) => r.id === answer.reasonId);
      reasonRight = reason?.correct === true;
      if (!reasonRight) misconceptions.push(reason?.misconception);
      if (verdictRight && !reasonRight) {
        feedback.push({
          level: 'error',
          code: reason ? 'TRUE_FALSE_WRONG_REASON' : 'TRUE_FALSE_NO_REASON',
          message: reason
            ? '참/거짓은 맞았지만 이유가 맞지 않습니다.'
            : '참/거짓은 맞았지만 이유를 고르지 않았습니다.',
        });
      }
    }
    if (!verdictRight) {
      misconceptions.unshift(spec.misconceptionIfWrong);
      feedback.push({
        level: 'error',
        code: 'TRUE_FALSE_WRONG',
        // The verdict is not revealed: a retry would otherwise be free.
        message: '참/거짓 판단이 맞지 않습니다.',
      });
    }
    const correct = verdictRight && reasonRight;
    if (correct)
      feedback.push({ level: 'success', code: 'TRUE_FALSE_CORRECT', message: '정답입니다.' });
    return buildResult({
      typeId: 'true_false',
      version: VERSION,
      correct,
      score: correct ? 1 : verdictRight ? TRUE_FALSE_VERDICT_ONLY_SCORE : 0,
      feedback,
      misconceptionIds: correct ? [] : misconceptions,
    });
  },

  leakFingerprints(spec) {
    // The verdict itself (참/거짓) is too short to fingerprint; the correct reason is the key.
    const reason = spec.reasons?.find((r) => r.correct)?.text;
    return reason ? leakSet([reason, reason.replace(/`/g, '')]) : [];
  },

  verify(spec) {
    const issues: VerifyIssue[] = [];
    if (spec.reasons && !spec.requireReason) {
      issues.push({
        severity: 'warning',
        code: 'TRUE_FALSE_UNUSED_REASONS',
        message: 'requireReason이 false라 reasons는 학습자에게 보이지 않습니다.',
        path: 'reasons',
      });
    }
    spec.reasons?.forEach((reason, index) => {
      if (reason.correct && reason.misconception) {
        issues.push({
          severity: 'error',
          code: 'TRUE_FALSE_CORRECT_REASON_HAS_MISCONCEPTION',
          message: '정답 이유에 오개념을 연결할 수 없습니다.',
          path: `reasons.${index}.misconception`,
        });
      }
    });
    const texts = (spec.reasons ?? []).map((r) => r.text.trim());
    if (new Set(texts).size !== texts.length) {
      issues.push({
        severity: 'error',
        code: 'TRUE_FALSE_DUPLICATE_REASON',
        message: '같은 내용의 이유가 있습니다.',
        path: 'reasons',
      });
    }
    return issues;
  },
};
