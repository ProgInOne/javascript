import { z } from 'zod';

import { leakSet } from '../common/normalize.ts';
import { createRng, seedFromString } from '../common/prng.ts';
import { displayTextSchema, localIdSchema, uniqueIds } from '../common/schemas.ts';
import { misconceptionIdSchema } from '../core/ids.ts';
import { buildResult } from '../core/result.ts';
import type { ExerciseTypeDef, FeedbackItem, VerifyIssue } from '../core/types.ts';
import { BANNED_OPTION_TEXT } from './mcq-single.ts';

/** docs/design/content-and-exercises.md#mcq_multi-복수-선택 */
const VERSION = 1;

export const MCQ_MULTI_MAX_OPTIONS = 6;

const optionSchema = z.object({
  id: localIdSchema,
  text: displayTextSchema,
  /** Misconception suggested by choosing this (wrong) option (answer key). */
  misconception: misconceptionIdSchema.optional(),
  /** Misconception suggested by NOT choosing this (correct) option (answer key). */
  missedMisconception: misconceptionIdSchema.optional(),
  /** Feedback shown when this wrong option is chosen (answer key). */
  rationale: z.string().max(2_000).optional(),
});

export const mcqMultiSpecSchema = z
  .object({
    options: z.array(optionSchema).min(3).max(MCQ_MULTI_MAX_OPTIONS),
    /** Answer key: one or more option IDs. */
    correct: z.array(localIdSchema).min(1),
    /** Fewest options the learner must pick before submitting (public: shown as a hint). */
    minSelect: z.int().min(1).default(1),
    shuffle: z.boolean().default(true),
    /** Options are code (rendered monospace). */
    codeOptions: z.boolean().default(false),
  })
  .superRefine((spec, ctx) => {
    const ids = spec.options.map((o) => o.id);
    uniqueIds(ids, ctx, ['options'], 'option');
    uniqueIds(spec.correct, ctx, ['correct'], 'correct');
    spec.correct.forEach((id, index) => {
      if (!ids.includes(id)) {
        ctx.addIssue({
          code: 'custom',
          message: `correct must list option ids: ${id}`,
          path: ['correct', index],
        });
      }
    });
    if (spec.minSelect > spec.correct.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'minSelect cannot exceed the number of correct options',
        path: ['minSelect'],
      });
    }
  });
export type McqMultiSpec = z.infer<typeof mcqMultiSpecSchema>;

export const mcqMultiPublicSpecSchema = z.object({
  options: z.array(z.object({ id: localIdSchema, text: displayTextSchema })),
  minSelect: z.int().min(1),
  codeOptions: z.boolean(),
});
export type McqMultiPublicSpec = z.infer<typeof mcqMultiPublicSpecSchema>;

export const mcqMultiAnswerSchema = z.object({
  optionIds: z.array(z.string().max(64)).max(MCQ_MULTI_MAX_OPTIONS * 2),
});
export type McqMultiAnswer = z.infer<typeof mcqMultiAnswerSchema>;

export const mcqMulti: ExerciseTypeDef<McqMultiSpec, McqMultiPublicSpec, McqMultiAnswer> = {
  id: 'mcq_multi',
  version: VERSION,
  category: 'recognition',
  specSchema: mcqMultiSpecSchema,
  publicSpecSchema: mcqMultiPublicSpecSchema,
  answerSchema: mcqMultiAnswerSchema,
  requiresRun: () => false,

  redact(spec, options = {}) {
    const publicOptions = spec.options.map(({ id, text }) => ({ id, text }));
    const ordered =
      spec.shuffle && options.shuffleSeed !== undefined
        ? createRng(seedFromString(options.shuffleSeed)).shuffle(publicOptions)
        : publicOptions;
    return { options: ordered, minSelect: spec.minSelect, codeOptions: spec.codeOptions };
  },

  grade({ spec, answer }) {
    const correctSet = new Set(spec.correct);
    // Own option IDs only, each counted once (the answer is untrusted JSON).
    const known = new Map(spec.options.map((o) => [o.id, o]));
    const chosen = new Set(answer.optionIds.filter((id) => known.has(id)));
    const unknown = answer.optionIds.some((id) => !known.has(id));

    let right = 0;
    let wrong = 0;
    const feedback: FeedbackItem[] = [];
    const misconceptions: (string | undefined)[] = [];
    for (const option of spec.options) {
      const picked = chosen.has(option.id);
      const isCorrect = correctSet.has(option.id);
      if (picked && isCorrect) right++;
      if (picked && !isCorrect) {
        wrong++;
        misconceptions.push(option.misconception);
        if (option.rationale) {
          feedback.push({ level: 'error', code: 'MCQ_WRONG_OPTION', message: option.rationale });
        }
      }
      if (!picked && isCorrect) misconceptions.push(option.missedMisconception);
    }
    const missed = spec.correct.length - right;
    const correct = !unknown && wrong === 0 && missed === 0;

    if (unknown) {
      feedback.unshift({
        level: 'error',
        code: 'MCQ_UNKNOWN_OPTION',
        message: '선택지 목록에 없는 답이 있습니다.',
      });
    }
    if (correct) {
      feedback.unshift({ level: 'success', code: 'MCQ_CORRECT', message: '정답입니다.' });
    } else {
      // The number of correct options is never revealed, only which way the answer is off.
      if (wrong > 0) {
        feedback.unshift({
          level: 'error',
          code: 'MCQ_MULTI_EXTRA',
          message: '정답이 아닌 선택지를 골랐습니다.',
        });
      }
      if (missed > 0) {
        feedback.unshift({
          level: 'error',
          code: 'MCQ_MULTI_MISSED',
          message: '빠뜨린 정답이 있습니다.',
        });
      }
    }
    return buildResult({
      typeId: 'mcq_multi',
      version: VERSION,
      correct,
      score: Math.max(0, (right - wrong) / spec.correct.length),
      feedback,
      misconceptionIds: correct ? [] : misconceptions,
    });
  },

  leakFingerprints(spec) {
    const texts = spec.options.filter((o) => spec.correct.includes(o.id)).map((o) => o.text);
    return leakSet(texts.flatMap((text) => [text, text.replace(/`/g, '')]));
  },

  verify(spec) {
    const issues: VerifyIssue[] = [];
    const correctSet = new Set(spec.correct);
    spec.options.forEach((option, index) => {
      if (BANNED_OPTION_TEXT.test(option.text.trim())) {
        issues.push({
          severity: 'error',
          code: 'MCQ_BANNED_OPTION',
          message: '"모두 정답"·"정답 없음" 선택지는 쓰지 않습니다.',
          path: `options.${index}.text`,
        });
      }
      if (correctSet.has(option.id) && option.misconception) {
        issues.push({
          severity: 'error',
          code: 'MCQ_CORRECT_HAS_MISCONCEPTION',
          message:
            '정답 선택지에는 misconception을 둘 수 없습니다. 놓쳤을 때의 오개념은 missedMisconception에 씁니다.',
          path: `options.${index}.misconception`,
        });
      }
      if (!correctSet.has(option.id) && option.missedMisconception) {
        issues.push({
          severity: 'error',
          code: 'MCQ_WRONG_HAS_MISSED_MISCONCEPTION',
          message: 'missedMisconception은 정답 선택지에만 둘 수 있습니다.',
          path: `options.${index}.missedMisconception`,
        });
      }
      if (correctSet.has(option.id) && option.rationale) {
        issues.push({
          severity: 'warning',
          code: 'MCQ_CORRECT_HAS_RATIONALE',
          message: 'rationale은 오답 선택지를 골랐을 때만 보입니다.',
          path: `options.${index}.rationale`,
        });
      }
    });
    if (correctSet.size === spec.options.length) {
      issues.push({
        severity: 'error',
        code: 'MCQ_MULTI_ALL_CORRECT',
        message:
          '모든 선택지가 정답이면 전부 고르기만 해도 맞힙니다. 오답 선택지를 하나 이상 두세요.',
        path: 'correct',
      });
    }
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
