import { z } from 'zod';

import { leakSet, normalizeBlankText, unquoteLiteral } from '../common/normalize.ts';
import { codeTextSchema, localIdSchema, uniqueIds } from '../common/schemas.ts';
import { misconceptionIdSchema } from '../core/ids.ts';
import { buildResult } from '../core/result.ts';
import type { ExerciseTypeDef, FeedbackItem, VerifyIssue } from '../core/types.ts';

/** docs/design/content-and-exercises.md#fill_blank-빈칸-채우기 */
const VERSION = 1;

export const BLANK_ANSWER_MAX_LENGTH = 500;
const PLACEHOLDER = /\{\{blank:([a-z0-9][a-z0-9_-]{0,47})\}\}/g;
/** Rejects the classic catastrophic-backtracking shape `(…+…)+` in author regexes. */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)[+*{]/;

const blankSchema = z.object({
  id: localIdSchema,
  /** Accepted answers (answer key). */
  accept: z.array(z.string().max(BLANK_ANSWER_MAX_LENGTH)).max(50).default([]),
  /** Optional regex matched against the whole normalized answer (answer key). */
  acceptRegex: z
    .string()
    .max(200)
    .nullish()
    .refine(
      (src) => src === null || src === undefined || isSafeRegex(src),
      'acceptRegex must compile and avoid nested quantifiers',
    ),
  caseSensitive: z.boolean().default(true),
  /** Input width hint in characters. */
  width: z.int().min(1).max(80).optional(),
  /** Specific wrong answer → misconception (answer key). */
  misconceptionMap: z
    .record(z.string().max(BLANK_ANSWER_MAX_LENGTH), misconceptionIdSchema)
    .optional(),
});
export type FillBlankBlank = z.infer<typeof blankSchema>;

export const fillBlankSpecSchema = z
  .object({
    mode: z.literal('text').default('text'),
    template: codeTextSchema.min(1),
    blanks: z.array(blankSchema).min(1).max(50),
  })
  .superRefine((spec, ctx) => {
    uniqueIds(
      spec.blanks.map((b) => b.id),
      ctx,
      ['blanks'],
      'blank',
    );
    const placeholders = [...spec.template.matchAll(PLACEHOLDER)].map((m) => m[1] ?? '');
    const ids = new Set(spec.blanks.map((b) => b.id));
    for (const id of placeholders) {
      if (!ids.has(id))
        ctx.addIssue({
          code: 'custom',
          message: `no blank for {{blank:${id}}}`,
          path: ['template'],
        });
    }
    for (const id of ids) {
      const count = placeholders.filter((p) => p === id).length;
      if (count !== 1) {
        ctx.addIssue({
          code: 'custom',
          message: `blank ${id} must appear exactly once`,
          path: ['template'],
        });
      }
    }
    spec.blanks.forEach((blank, index) => {
      if (blank.accept.length === 0 && (blank.acceptRegex ?? null) === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'text blank needs accept or acceptRegex',
          path: ['blanks', index],
        });
      }
    });
  });
export type FillBlankSpec = z.infer<typeof fillBlankSpecSchema>;

export const fillBlankPublicSpecSchema = z.object({
  mode: z.literal('text'),
  template: z.string(),
  blanks: z.array(z.object({ id: localIdSchema, width: z.int().optional() })),
});
export type FillBlankPublicSpec = z.infer<typeof fillBlankPublicSpecSchema>;

export const fillBlankAnswerSchema = z.object({
  blanks: z
    .record(z.string().max(64), z.string().max(BLANK_ANSWER_MAX_LENGTH))
    .refine((record) => Object.keys(record).length <= 50, 'too many blanks'),
});
export type FillBlankAnswer = z.infer<typeof fillBlankAnswerSchema>;

function isSafeRegex(source: string): boolean {
  if (NESTED_QUANTIFIER.test(source)) return false;
  try {
    new RegExp(source, 'u');
    return true;
  } catch {
    return false;
  }
}

/** Reads one blank's answer; own properties only (the record comes from untrusted JSON). */
export function blankAnswer(answer: FillBlankAnswer, id: string): string {
  return Object.hasOwn(answer.blanks, id) ? (answer.blanks[id] ?? '') : '';
}

/** Text-mode comparison of one blank (normalization rules from the doc). */
export function blankMatches(blank: FillBlankBlank, raw: string): boolean {
  const answer = normalizeBlankText(raw, blank.caseSensitive);
  if (answer === '') return false;
  const answerInner = unquoteLiteral(answer);
  for (const accepted of blank.accept) {
    const expected = normalizeBlankText(accepted, blank.caseSensitive);
    if (expected === answer) return true;
    const expectedInner = unquoteLiteral(expected);
    if (expectedInner !== null && answerInner !== null && expectedInner === answerInner)
      return true;
  }
  if (blank.acceptRegex !== null && blank.acceptRegex !== undefined) {
    const flags = blank.caseSensitive ? 'u' : 'iu';
    return new RegExp(`^(?:${blank.acceptRegex})$`, flags).test(answer);
  }
  return false;
}

/** Misconception for a specific wrong answer, compared after the same normalization. */
export function blankMisconception(blank: FillBlankBlank, raw: string): string | undefined {
  if (!blank.misconceptionMap) return undefined;
  const answer = normalizeBlankText(raw, blank.caseSensitive);
  for (const [key, misconception] of Object.entries(blank.misconceptionMap)) {
    if (normalizeBlankText(key, blank.caseSensitive) === answer) return misconception;
  }
  return undefined;
}

export const fillBlank: ExerciseTypeDef<FillBlankSpec, FillBlankPublicSpec, FillBlankAnswer> = {
  id: 'fill_blank',
  version: VERSION,
  category: 'recall',
  specSchema: fillBlankSpecSchema,
  publicSpecSchema: fillBlankPublicSpecSchema,
  answerSchema: fillBlankAnswerSchema,
  requiresRun: () => false,

  redact(spec) {
    return {
      mode: spec.mode,
      template: spec.template,
      blanks: spec.blanks.map((b) =>
        b.width === undefined ? { id: b.id } : { id: b.id, width: b.width },
      ),
    };
  },

  grade({ spec, answer }) {
    const feedback: FeedbackItem[] = [];
    const misconceptions: (string | undefined)[] = [];
    let matched = 0;
    for (const blank of spec.blanks) {
      const raw = blankAnswer(answer, blank.id);
      if (blankMatches(blank, raw)) {
        matched++;
        feedback.push({
          level: 'success',
          code: 'BLANK_CORRECT',
          message: '맞았습니다.',
          target: blank.id,
        });
      } else {
        const empty = raw.trim() === '';
        feedback.push({
          level: 'error',
          code: empty ? 'BLANK_EMPTY' : 'BLANK_WRONG',
          message: empty ? '빈칸이 비어 있습니다.' : '이 빈칸의 답이 맞지 않습니다.',
          target: blank.id,
        });
        misconceptions.push(blankMisconception(blank, raw));
      }
    }
    return buildResult({
      typeId: 'fill_blank',
      version: VERSION,
      correct: matched === spec.blanks.length,
      score: matched / spec.blanks.length,
      feedback,
      misconceptionIds: misconceptions,
    });
  },

  leakFingerprints(spec) {
    return leakSet(spec.blanks.flatMap((b) => b.accept));
  },

  verify(spec) {
    const issues: VerifyIssue[] = [];
    for (const blank of spec.blanks) {
      for (const key of Object.keys(blank.misconceptionMap ?? {})) {
        if (blankMatches(blank, key)) {
          issues.push({
            severity: 'error',
            code: 'BLANK_MISCONCEPTION_IS_ACCEPTED',
            message: `오개념 답 "${key}"이(가) 정답으로도 인정됩니다.`,
            path: `blanks.${blank.id}.misconceptionMap`,
          });
        }
      }
    }
    return issues;
  },
};
