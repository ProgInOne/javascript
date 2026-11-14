import { z } from 'zod';

import { leakSet } from '../common/normalize.ts';
import { createRng, seedFromString } from '../common/prng.ts';
import { displayTextSchema, localIdSchema, uniqueIds } from '../common/schemas.ts';
import { misconceptionIdSchema } from '../core/ids.ts';
import { buildResult } from '../core/result.ts';
import type { ExerciseTypeDef, FeedbackItem, VerifyIssue } from '../core/types.ts';

/** docs/design/content-and-exercises.md#mcq_single-단일-선택 */
const VERSION = 1;

const optionSchema = z.object({
  id: localIdSchema,
  text: displayTextSchema,
  /** Misconception suggested by choosing this option (answer key). */
  misconception: misconceptionIdSchema.optional(),
  /** Feedback shown when this wrong option is chosen (answer key). */
  rationale: z.string().max(2_000).optional(),
});

export const mcqSingleSpecSchema = z
  .object({
    options: z.array(optionSchema).min(3).max(5),
    /** Answer key. */
    correct: localIdSchema,
    shuffle: z.boolean().default(true),
    codeOptions: z.boolean().default(false),
  })
  .superRefine((spec, ctx) => {
    uniqueIds(
      spec.options.map((o) => o.id),
      ctx,
      ['options'],
      'option',
    );
    if (!spec.options.some((o) => o.id === spec.correct)) {
      ctx.addIssue({ code: 'custom', message: 'correct must be an option id', path: ['correct'] });
    }
  });
export type McqSingleSpec = z.infer<typeof mcqSingleSpecSchema>;

export const mcqSinglePublicSpecSchema = z.object({
  options: z.array(z.object({ id: localIdSchema, text: displayTextSchema })),
  codeOptions: z.boolean(),
});
export type McqSinglePublicSpec = z.infer<typeof mcqSinglePublicSpecSchema>;

export const mcqSingleAnswerSchema = z.object({ optionId: z.string().max(64) });
export type McqSingleAnswer = z.infer<typeof mcqSingleAnswerSchema>;

/** Option texts that make a question undiagnostic (doc: forbidden). */
export const BANNED_OPTION_TEXT =
  /^(모두 정답|정답 없음|위의 모든 것|all of the above|none of the above)/i;

export const mcqSingle: ExerciseTypeDef<McqSingleSpec, McqSinglePublicSpec, McqSingleAnswer> = {
  id: 'mcq_single',
  version: VERSION,
  category: 'recognition',
  specSchema: mcqSingleSpecSchema,
  publicSpecSchema: mcqSinglePublicSpecSchema,
  answerSchema: mcqSingleAnswerSchema,
  requiresRun: () => false,

  redact(spec, options = {}) {
    const publicOptions = spec.options.map(({ id, text }) => ({ id, text }));
    const ordered =
      spec.shuffle && options.shuffleSeed !== undefined
        ? createRng(seedFromString(options.shuffleSeed)).shuffle(publicOptions)
        : publicOptions;
    return { options: ordered, codeOptions: spec.codeOptions };
  },

  grade({ spec, answer }) {
    const chosen = spec.options.find((o) => o.id === answer.optionId);
    const correct = chosen?.id === spec.correct;
    const feedback: FeedbackItem[] = [];
    if (!chosen) {
      feedback.push({
        level: 'error',
        code: 'MCQ_UNKNOWN_OPTION',
        message: '선택지 목록에 없는 답입니다.',
      });
    } else if (correct) {
      feedback.push({ level: 'success', code: 'MCQ_CORRECT', message: '정답입니다.' });
    } else {
      feedback.push({
        level: 'error',
        code: 'MCQ_WRONG_OPTION',
        message: chosen.rationale ?? '오답입니다.',
        target: chosen.id,
      });
    }
    return buildResult({
      typeId: 'mcq_single',
      version: VERSION,
      correct,
      score: correct ? 1 : 0,
      feedback,
      misconceptionIds: correct ? [] : [chosen?.misconception],
    });
  },

  leakFingerprints(spec) {
    const text = spec.options.find((o) => o.id === spec.correct)?.text ?? '';
    return leakSet([text, text.replace(/`/g, '')]);
  },

  verify(spec) {
    const issues: VerifyIssue[] = [];
    spec.options.forEach((option, index) => {
      if (BANNED_OPTION_TEXT.test(option.text.trim())) {
        issues.push({
          severity: 'error',
          code: 'MCQ_BANNED_OPTION',
          message: '"모두 정답"·"정답 없음" 선택지는 쓰지 않습니다.',
          path: `options.${index}.text`,
        });
      }
      if (option.id === spec.correct && option.misconception) {
        issues.push({
          severity: 'error',
          code: 'MCQ_CORRECT_HAS_MISCONCEPTION',
          message: '정답 선택지에 오개념을 연결할 수 없습니다.',
          path: `options.${index}.misconception`,
        });
      }
    });
    const texts = spec.options.map((o) => o.text.trim());
    if (new Set(texts).size !== texts.length) {
      issues.push({
        severity: 'error',
        code: 'MCQ_DUPLICATE_TEXT',
        message: '같은 내용의 선택지가 있습니다.',
      });
    }
    return issues;
  },
};
