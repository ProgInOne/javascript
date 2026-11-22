import {
  consoleEntriesToLines,
  type ObservationOf,
  type RunPlan,
  type RunResult,
} from '@proginone/run-contract';
import { z } from 'zod';

import { compareOutput } from '../common/output.ts';
import { leakSet } from '../common/normalize.ts';
import { createRng, seedFromString } from '../common/prng.ts';
import { codeTextSchema, displayTextSchema, localIdSchema, uniqueIds } from '../common/schemas.ts';
import { misconceptionIdSchema } from '../core/ids.ts';
import { buildResult } from '../core/result.ts';
import type { ExerciseTypeDef, FeedbackItem, VerifyIssue } from '../core/types.ts';

/** docs/design/content-and-exercises.md#find_bug_line-오류-줄-찾기 */
const VERSION = 1;

/** Score when the line is right but the required cause is wrong or missing. */
export const FIND_BUG_LINE_ONLY_SCORE = 0.5;
export const FIND_BUG_MAX_LINES = 200;

const lineNumberSchema = z.int().min(1).max(FIND_BUG_MAX_LINES);

/**
 * Machine-checkable form of the symptom (answer-free, but server only): what the buggy code
 * prints, or the error it throws. `check --run` runs `code` and `fixedCode` and compares.
 */
export const symptomCheckSchema = z.union([
  z.strictObject({ console: z.array(z.string().max(2_000)).max(100) }),
  z.strictObject({ error: z.string().regex(/^[A-Za-z_$][\w$]{0,99}$/) }),
]);
export type SymptomCheck = z.infer<typeof symptomCheckSchema>;

const causeSchema = z.object({
  id: localIdSchema,
  text: displayTextSchema,
  /** Answer key: exactly one cause is correct. */
  correct: z.boolean().default(false),
  /** Misconception suggested by choosing this cause (answer key). */
  misconception: misconceptionIdSchema.optional(),
});

export const findBugLineSpecSchema = z
  .object({
    /** The buggy program (JavaScript, shown read-only with line numbers). */
    code: codeTextSchema.min(1),
    /** Answer key: the line(s) causing the symptom (1-based). */
    bugLines: z.array(lineNumberSchema).min(1).max(10),
    /** Answer key: other lines also accepted as the cause (e.g. the line the fix could go on). */
    acceptLines: z.array(lineNumberSchema).max(10).default([]),
    /** Shown to the learner: what goes wrong, without saying where. */
    symptom: displayTextSchema,
    /** What the buggy code observably does (verification, server only). */
    symptomCheck: symptomCheckSchema,
    /** A corrected program (answer key): must run without the symptom. */
    fixedCode: codeTextSchema.min(1),
    /** Optional second step: why that line is wrong. */
    causeOptions: z.array(causeSchema).min(2).max(5).optional(),
    shuffle: z.boolean().default(true),
  })
  .superRefine((spec, ctx) => {
    const count = spec.code.split('\n').length;
    for (const key of ['bugLines', 'acceptLines'] as const) {
      spec[key].forEach((line, index) => {
        if (line > count) {
          ctx.addIssue({
            code: 'custom',
            message: `line ${line} is past the end of the code (${count} lines)`,
            path: [key, index],
          });
        }
      });
    }
    if (spec.causeOptions) {
      uniqueIds(
        spec.causeOptions.map((c) => c.id),
        ctx,
        ['causeOptions'],
        'cause',
      );
      if (spec.causeOptions.filter((c) => c.correct).length !== 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'exactly one cause must be correct',
          path: ['causeOptions'],
        });
      }
    }
  });
export type FindBugLineSpec = z.infer<typeof findBugLineSpecSchema>;

export const findBugLinePublicSpecSchema = z.object({
  code: z.string(),
  symptom: z.string(),
  causeOptions: z.array(z.object({ id: localIdSchema, text: displayTextSchema })).optional(),
});
export type FindBugLinePublicSpec = z.infer<typeof findBugLinePublicSpecSchema>;

export const findBugLineAnswerSchema = z.object({
  line: z.int().min(1).max(10_000),
  causeId: z.string().max(64).optional(),
});
export type FindBugLineAnswer = z.infer<typeof findBugLineAnswerSchema>;

const lineCount = (code: string) => code.split('\n').length;

export const findBugLine: ExerciseTypeDef<
  FindBugLineSpec,
  FindBugLinePublicSpec,
  FindBugLineAnswer
> = {
  id: 'find_bug_line',
  version: VERSION,
  category: 'recall',
  specSchema: findBugLineSpecSchema,
  publicSpecSchema: findBugLinePublicSpecSchema,
  answerSchema: findBugLineAnswerSchema,
  requiresRun: () => false,

  redact(spec, options = {}) {
    const out: FindBugLinePublicSpec = { code: spec.code, symptom: spec.symptom };
    if (spec.causeOptions) {
      const causes = spec.causeOptions.map(({ id, text }) => ({ id, text }));
      out.causeOptions =
        spec.shuffle && options.shuffleSeed !== undefined
          ? createRng(seedFromString(options.shuffleSeed)).shuffle(causes)
          : causes;
    }
    return out;
  },

  grade({ spec, answer }) {
    const feedback: FeedbackItem[] = [];
    const misconceptions: (string | undefined)[] = [];
    const target = String(answer.line);
    const inRange = answer.line <= lineCount(spec.code);
    const lineRight = spec.bugLines.includes(answer.line) || spec.acceptLines.includes(answer.line);
    let causeRight = true;
    if (spec.causeOptions) {
      const cause =
        answer.causeId === undefined
          ? undefined
          : spec.causeOptions.find((c) => c.id === answer.causeId);
      causeRight = cause?.correct === true;
      if (!causeRight) misconceptions.push(cause?.misconception);
      if (lineRight && !causeRight) {
        feedback.push({
          level: 'error',
          code: cause ? 'FIND_BUG_WRONG_CAUSE' : 'FIND_BUG_NO_CAUSE',
          message: cause
            ? '줄은 맞았지만 원인 설명이 맞지 않습니다.'
            : '줄은 맞았지만 원인을 고르지 않았습니다.',
        });
      }
    }
    if (!inRange) {
      feedback.push({
        level: 'error',
        code: 'FIND_BUG_LINE_OUT_OF_RANGE',
        message: '코드에 없는 줄입니다.',
      });
    } else if (!lineRight) {
      feedback.push({
        level: 'error',
        code: 'FIND_BUG_WRONG_LINE',
        message: '이 줄은 증상의 원인이 아닙니다.',
        target,
      });
    }
    const correct = lineRight && causeRight;
    if (correct) {
      feedback.push({ level: 'success', code: 'FIND_BUG_CORRECT', message: '정답입니다.', target });
    }
    return buildResult({
      typeId: 'find_bug_line',
      version: VERSION,
      correct,
      score: correct ? 1 : lineRight ? FIND_BUG_LINE_ONLY_SCORE : 0,
      feedback,
      misconceptionIds: correct ? [] : misconceptions,
    });
  },

  leakFingerprints(spec) {
    // The bug line itself is public code; the fix and the correct cause are the answer.
    const codeLines = new Set(leakSet(spec.code.split('\n')));
    const fixLines = leakSet(spec.fixedCode.split('\n')).filter(
      (line) => line.length >= 8 && !codeLines.has(line),
    );
    const cause = spec.causeOptions?.find((c) => c.correct)?.text;
    return leakSet([...(cause ? [cause, cause.replace(/`/g, '')] : []), ...fixLines]);
  },

  verify(spec) {
    const issues: VerifyIssue[] = [];
    const lines = spec.code.split('\n');
    spec.bugLines.forEach((line, index) => {
      if ((lines[line - 1] ?? '').trim() === '') {
        issues.push({
          severity: 'error',
          code: 'FIND_BUG_BLANK_LINE',
          message: `${line}번 줄은 빈 줄입니다.`,
          path: `bugLines.${index}`,
        });
      }
    });
    if (spec.fixedCode.trim() === spec.code.trim()) {
      issues.push({
        severity: 'error',
        code: 'FIND_BUG_FIX_UNCHANGED',
        message: 'fixedCode가 버그 코드와 같습니다.',
        path: 'fixedCode',
      });
    }
    const fixed = spec.fixedCode.split('\n');
    if (fixed.length === lines.length) {
      const allowed = new Set([...spec.bugLines, ...spec.acceptLines]);
      const changed = lines.flatMap((line, i) =>
        line.trim() !== (fixed[i] ?? '').trim() ? [i + 1] : [],
      );
      const outside = changed.filter((n) => !allowed.has(n));
      if (outside.length > 0) {
        issues.push({
          severity: 'warning',
          code: 'FIND_BUG_FIX_OUTSIDE_LINES',
          message: `fixedCode가 bugLines·acceptLines 밖의 줄(${outside.join(', ')})을 고칩니다. 원인 줄 지정을 확인하세요.`,
          path: 'bugLines',
        });
      }
    }
    spec.causeOptions?.forEach((cause, index) => {
      if (cause.correct && cause.misconception) {
        issues.push({
          severity: 'error',
          code: 'FIND_BUG_CORRECT_CAUSE_HAS_MISCONCEPTION',
          message: '정답 원인에 오개념을 연결할 수 없습니다.',
          path: `causeOptions.${index}.misconception`,
        });
      }
    });
    return issues;
  },
};

// ── Build-time symptom verification (used by content-cli) ────────────────────

/** Run plan that observes a program's console output and errors (buggy or fixed code). */
export function buildFindBugRunPlan(code: string): RunPlan {
  return {
    v: 1,
    mode: 'js-console',
    purpose: 'verification',
    files: [{ path: 'main.js', language: 'js', content: code }],
    entry: 'main.js',
    timers: 'real',
    checks: {
      v: 1,
      expose: [],
      steps: [
        { op: 'waitSettled', id: 'settle', maxMs: 3_000 },
        { op: 'consoleOutput', id: 'output' },
      ],
    },
  };
}

export interface SymptomObservation {
  /** The run shows exactly the authored symptom. */
  shown: boolean;
  /** The program printed or threw nothing unexpected (no errors at all). */
  clean: boolean;
  /** What the run did, for author messages (Korean). */
  summary: string;
}

/** Compares a run of {@link buildFindBugRunPlan} with the authored symptom. */
export function observeSymptom(check: SymptomCheck, run: RunResult): SymptomObservation {
  const output = run.observations.find(
    (o): o is ObservationOf<'consoleOutput'> => o.op === 'consoleOutput',
  );
  const lines = consoleEntriesToLines(output?.entries ?? run.console);
  const errors = run.errors.filter((e) => e.phase !== 'harness');
  const clean = errors.length === 0 && run.status === 'completed';
  const printed = lines.length === 0 ? '출력 없음' : `출력 ${lines.join(' ⏎ ')}`;
  const thrown = errors.map((e) => `${e.name}: ${e.message}`).join(' / ');
  const summary = thrown === '' ? printed : `${printed}, 오류 ${thrown}`;
  const shown =
    'console' in check
      ? errors.length === 0 && compareOutput(check.console, lines.join('\n')).equal
      : errors.some((e) => e.name === check.error);
  return { shown, clean, summary };
}
