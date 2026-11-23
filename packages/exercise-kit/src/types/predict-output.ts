import {
  consoleEntriesToLines,
  formatValue,
  serializedValueSchema,
  type ObservationOf,
  type RunPlan,
  type RunResult,
} from '@proginone/run-contract';
import { z } from 'zod';

import { parseLiteral } from '../common/literal.ts';
import { compareOutput, outputLineEquals, prepareLine } from '../common/output.ts';
import {
  buildResult,
  codeTextSchema,
  ExerciseKitError,
  leakSet,
  localIdSchema,
  misconceptionIdSchema,
  normalizeOutputLines,
  uniqueIds,
} from '@proginone/exercise-core';
import { valuesEqual } from '../common/values.ts';
import type { ExerciseTypeDef, FeedbackItem, VerifyIssue } from '../core/types.ts';

/** docs/design/content-and-exercises.md#predict_output-실행-결과-예측 */
const VERSION = 1;

export const PREDICT_ANSWER_MAX_LENGTH = 10_000;
const identifierSchema = z.string().regex(/^[A-Za-z_$][\w$]{0,99}$/);

/**
 * Execution-derived answer key. Computed by `content-cli check --run` (recorded in
 * `content/.generated/predict-expected.json`) and filled in by check/build, never by authors.
 */
export const predictExpectedSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('console'), lines: z.array(z.string().max(10_000)).max(1_000) }),
  z.object({ kind: z.literal('value'), value: serializedValueSchema }),
  z.object({ kind: z.literal('error'), thrown: z.boolean(), name: z.string().max(100).optional() }),
  z.object({ kind: z.literal('choice'), choiceId: localIdSchema }),
]);
export type PredictExpected = z.infer<typeof predictExpectedSchema>;

export const predictOutputSpecSchema = z
  .object({
    lang: z.enum(['js', 'web']).default('js'),
    code: codeTextSchema.min(1),
    answerKind: z.enum(['console', 'value', 'error', 'choice']),
    /**
     * `value`: name of the global whose final value is asked. Deviation from the doc's free
     * "expression": only an identifier, read with the `readGlobal` step (no eval in the sandbox).
     */
    expression: identifierSchema.nullish(),
    /** `choice`: output candidates; the correct one is determined by execution. */
    choices: z
      .array(z.object({ id: localIdSchema, text: z.string().max(4_000) }))
      .min(2)
      .max(6)
      .nullish(),
    /** Answer key filled by the build from a real run. */
    expected: predictExpectedSchema.nullish(),
    /** Specific wrong answer → misconception (answer key). */
    misconceptionByAnswer: z.record(z.string().max(2_000), misconceptionIdSchema).optional(),
  })
  .superRefine((spec, ctx) => {
    if (spec.answerKind === 'value' && !spec.expression) {
      ctx.addIssue({
        code: 'custom',
        message: 'answerKind value needs expression',
        path: ['expression'],
      });
    }
    if (spec.answerKind === 'choice') {
      if (!spec.choices) {
        ctx.addIssue({
          code: 'custom',
          message: 'answerKind choice needs choices',
          path: ['choices'],
        });
      } else {
        uniqueIds(
          spec.choices.map((c) => c.id),
          ctx,
          ['choices'],
          'choice',
        );
      }
    }
    if (spec.expected && spec.expected.kind !== spec.answerKind) {
      ctx.addIssue({
        code: 'custom',
        message: 'expected.kind must equal answerKind',
        path: ['expected'],
      });
    }
    const expected = spec.expected;
    if (expected?.kind === 'choice' && !spec.choices?.some((c) => c.id === expected.choiceId)) {
      ctx.addIssue({
        code: 'custom',
        message: 'expected.choiceId must be a choice id',
        path: ['expected'],
      });
    }
  });
export type PredictOutputSpec = z.infer<typeof predictOutputSpecSchema>;

export const predictOutputPublicSpecSchema = z.object({
  lang: z.enum(['js', 'web']),
  code: z.string(),
  answerKind: z.enum(['console', 'value', 'error', 'choice']),
  expression: z.string().optional(),
  choices: z.array(z.object({ id: localIdSchema, text: z.string() })).optional(),
});
export type PredictOutputPublicSpec = z.infer<typeof predictOutputPublicSpecSchema>;

export const predictOutputAnswerSchema = z.union([
  z.object({ console: z.string().max(PREDICT_ANSWER_MAX_LENGTH) }),
  z.object({ value: z.string().max(PREDICT_ANSWER_MAX_LENGTH) }),
  z.object({ error: z.object({ thrown: z.boolean(), name: z.string().max(100).optional() }) }),
  z.object({ choiceId: z.string().max(64) }),
]);
export type PredictOutputAnswer = z.infer<typeof predictOutputAnswerSchema>;

function answerKindOf(answer: PredictOutputAnswer): PredictOutputSpec['answerKind'] {
  if ('console' in answer) return 'console';
  if ('value' in answer) return 'value';
  if ('error' in answer) return 'error';
  return 'choice';
}

/** Error-kind answers as one comparable string: the error name, or `none`. */
function errorKey(thrown: boolean, name: string | undefined): string {
  return thrown ? (name?.trim() ?? '') : 'none';
}

function gradeAgainst(
  spec: PredictOutputSpec,
  expected: PredictExpected,
  answer: PredictOutputAnswer,
): { correct: boolean; score: number; feedback: FeedbackItem[]; misconceptions: string[] } {
  const feedback: FeedbackItem[] = [];
  const misconceptions: string[] = [];
  const byAnswer = Object.entries(spec.misconceptionByAnswer ?? {});

  if (expected.kind === 'console' && 'console' in answer) {
    const cmp = compareOutput(expected.lines, answer.console);
    cmp.matches.forEach((ok, index) => {
      if (!ok && index < cmp.actual.length) {
        feedback.push({
          level: 'error',
          code: 'PREDICT_LINE_WRONG',
          message: `${index + 1}번째 줄이 실제 출력과 다릅니다.`,
          target: String(index + 1),
        });
      }
    });
    if (cmp.expected.length !== cmp.actual.length) {
      feedback.push({
        level: 'error',
        code: 'PREDICT_LINE_COUNT',
        message:
          cmp.actual.length < cmp.expected.length
            ? '출력 줄이 더 있습니다.'
            : '실제 출력보다 줄이 많습니다.',
      });
    }
    for (const [key, misconception] of byAnswer) {
      const keyLines = normalizeOutputLines(key);
      if (
        keyLines.length === cmp.actual.length &&
        keyLines.every((line, i) => outputLineEquals(line, cmp.actual[i] ?? ''))
      ) {
        misconceptions.push(misconception);
      }
    }
    const score = cmp.total === 0 ? 1 : cmp.matched / cmp.total;
    return { correct: cmp.equal, score, feedback, misconceptions };
  }

  if (expected.kind === 'value' && 'value' in answer) {
    const actual = parseLiteral(prepareLine(answer.value));
    if (actual === null) {
      feedback.push({
        level: 'error',
        code: 'PREDICT_NOT_LITERAL',
        message: '값을 JavaScript 리터럴로 적어 주세요. 예: 5, "5", [1, 2], { a: 1 }',
      });
      return { correct: false, score: 0, feedback, misconceptions };
    }
    const correct = valuesEqual(expected.value, actual);
    if (!correct) {
      for (const [key, misconception] of byAnswer) {
        const keyValue = parseLiteral(prepareLine(key));
        if (keyValue !== null && valuesEqual(keyValue, actual)) misconceptions.push(misconception);
      }
    }
    return { correct, score: correct ? 1 : 0, feedback, misconceptions };
  }

  if (expected.kind === 'error' && 'error' in answer) {
    const thrownMatches = expected.thrown === answer.error.thrown;
    const nameMatches =
      !expected.thrown ||
      expected.name === undefined ||
      expected.name === answer.error.name?.trim();
    const correct = thrownMatches && nameMatches;
    if (thrownMatches && !nameMatches) {
      feedback.push({
        level: 'error',
        code: 'PREDICT_ERROR_NAME',
        message: '오류가 발생한다는 예측은 맞았지만 오류 종류가 다릅니다.',
      });
    }
    if (!correct) {
      const key = errorKey(answer.error.thrown, answer.error.name);
      for (const [k, misconception] of byAnswer)
        if (k.trim() === key) misconceptions.push(misconception);
    }
    return { correct, score: correct ? 1 : thrownMatches ? 0.5 : 0, feedback, misconceptions };
  }

  if (expected.kind === 'choice' && 'choiceId' in answer) {
    const correct = expected.choiceId === answer.choiceId;
    if (!correct) {
      for (const [k, misconception] of byAnswer)
        if (k === answer.choiceId) misconceptions.push(misconception);
    }
    return { correct, score: correct ? 1 : 0, feedback, misconceptions };
  }

  throw new ExerciseKitError(
    'INVALID_ANSWER',
    `answer kind does not match answerKind ${spec.answerKind}`,
  );
}

export const predictOutput: ExerciseTypeDef<
  PredictOutputSpec,
  PredictOutputPublicSpec,
  PredictOutputAnswer
> = {
  id: 'predict_output',
  version: VERSION,
  category: 'recall',
  specSchema: predictOutputSpecSchema,
  publicSpecSchema: predictOutputPublicSpecSchema,
  answerSchema: predictOutputAnswerSchema,
  // The answer key comes from a build-time run, so grading itself never needs the sandbox.
  requiresRun: () => false,

  redact(spec) {
    const out: PredictOutputPublicSpec = {
      lang: spec.lang,
      code: spec.code,
      answerKind: spec.answerKind,
    };
    if (spec.expression) out.expression = spec.expression;
    if (spec.choices) out.choices = spec.choices.map(({ id, text }) => ({ id, text }));
    return out;
  },

  grade({ spec, answer }) {
    if (!spec.expected) {
      throw new ExerciseKitError(
        'EXPECTED_MISSING',
        'predict_output spec has no execution-derived expected value',
      );
    }
    if (answerKindOf(answer) !== spec.answerKind) {
      throw new ExerciseKitError(
        'INVALID_ANSWER',
        `answer kind does not match answerKind ${spec.answerKind}`,
      );
    }
    const { correct, score, feedback, misconceptions } = gradeAgainst(spec, spec.expected, answer);
    if (correct)
      feedback.unshift({
        level: 'success',
        code: 'PREDICT_CORRECT',
        message: '예측이 맞았습니다.',
      });
    return buildResult({
      typeId: 'predict_output',
      version: VERSION,
      correct,
      score,
      feedback,
      misconceptionIds: misconceptions,
    });
  },

  leakFingerprints(spec) {
    const expected = spec.expected;
    if (!expected) return [];
    switch (expected.kind) {
      case 'console':
        return leakSet([expected.lines.join('\n'), ...expected.lines]);
      case 'value':
        return leakSet([formatValue(expected.value)]);
      case 'error':
        return leakSet([expected.name]);
      case 'choice':
        return leakSet([spec.choices?.find((c) => c.id === expected.choiceId)?.text]);
    }
  },

  verify(spec) {
    const issues: VerifyIssue[] = [];
    if (!spec.expected) {
      issues.push({
        severity: 'warning',
        code: 'PREDICT_EXPECTED_MISSING',
        message: '기대값이 없습니다. content-cli check --run이 실행해서 계산해야 합니다.',
        path: 'expected',
      });
      return issues;
    }
    for (const key of Object.keys(spec.misconceptionByAnswer ?? {})) {
      const answer = answerFromKey(spec.answerKind, key);
      if (answer && gradeAgainst(spec, spec.expected, answer).correct) {
        issues.push({
          severity: 'error',
          code: 'PREDICT_MISCONCEPTION_EQUALS_ANSWER',
          message: `오개념 답 "${key}"이(가) 실제 정답과 같습니다(진단력 상실).`,
          path: 'misconceptionByAnswer',
        });
      }
    }
    return issues;
  },
};

function answerFromKey(
  kind: PredictOutputSpec['answerKind'],
  key: string,
): PredictOutputAnswer | null {
  switch (kind) {
    case 'console':
      return { console: key };
    case 'value':
      return { value: key };
    case 'choice':
      return { choiceId: key };
    case 'error':
      return key.trim() === 'none'
        ? { error: { thrown: false } }
        : { error: { thrown: true, name: key.trim() } };
  }
}

// ── Build-time expectation (used by content-cli) ─────────────────────────────

/** Run plan that observes what the answer key needs (console, the asked global, errors). */
export function buildPredictExpectationPlan(spec: PredictOutputSpec): RunPlan {
  const isWeb = spec.lang === 'web';
  const steps: RunPlan['checks']['steps'] = [
    { op: 'waitSettled', id: 'settle', maxMs: 3_000 },
    { op: 'consoleOutput', id: 'output' },
  ];
  const expose: string[] = [];
  if (spec.answerKind === 'value' && spec.expression) {
    steps.push({ op: 'readGlobal', id: 'value', name: spec.expression });
    expose.push(spec.expression);
  }
  return {
    v: 1,
    mode: isWeb ? 'dom' : 'js-console',
    purpose: 'verification',
    files: [
      isWeb
        ? { path: 'index.html', language: 'html', content: spec.code }
        : { path: 'main.js', language: 'js', content: spec.code },
    ],
    entry: isWeb ? 'index.html' : 'main.js',
    timers: 'real',
    checks: { v: 1, expose, steps },
  };
}

/**
 * Derives the answer key from a verification run of {@link buildPredictExpectationPlan}.
 * Throws when the run cannot produce a trustworthy key (sandbox failure, syntax error,
 * unexpected runtime error, ambiguous choice).
 */
export function derivePredictExpected(spec: PredictOutputSpec, run: RunResult): PredictExpected {
  if (
    run.status === 'crashed' ||
    run.status === 'aborted' ||
    run.status === 'timeout' ||
    run.status === 'loop_limit'
  ) {
    throw new ExerciseKitError('INVALID_RUN_RESULT', `run did not finish (${run.status})`);
  }
  if (run.errors.some((e) => e.phase === 'syntax' || e.phase === 'harness')) {
    throw new ExerciseKitError('INVALID_RUN_RESULT', 'code has a syntax or harness error');
  }
  const runtimeError = run.errors.find(
    (e) => e.phase === 'runtime' || e.phase === 'unhandled_rejection',
  );
  if (spec.answerKind === 'error') {
    return runtimeError
      ? { kind: 'error', thrown: true, name: runtimeError.name }
      : { kind: 'error', thrown: false };
  }
  if (runtimeError) {
    throw new ExerciseKitError(
      'INVALID_RUN_RESULT',
      `unexpected ${runtimeError.name}: ${runtimeError.message}`,
    );
  }
  const output = run.observations.find(
    (o): o is ObservationOf<'consoleOutput'> => o.op === 'consoleOutput',
  );
  const lines = consoleEntriesToLines(output?.entries ?? run.console);

  switch (spec.answerKind) {
    case 'console':
      return { kind: 'console', lines };
    case 'value': {
      const read = run.observations.find(
        (o): o is ObservationOf<'readGlobal'> => o.op === 'readGlobal',
      );
      if (read?.outcome !== 'ok' || !read.value) {
        throw new ExerciseKitError(
          'INVALID_RUN_RESULT',
          `global ${spec.expression ?? ''} was not observed`,
        );
      }
      return { kind: 'value', value: read.value };
    }
    case 'choice': {
      const matching = (spec.choices ?? []).filter(
        (choice) => compareOutput(choice.text, lines.join('\n')).equal,
      );
      if (matching.length !== 1 || !matching[0]) {
        throw new ExerciseKitError(
          'INVALID_RUN_RESULT',
          `${matching.length} choices match the real output`,
        );
      }
      return { kind: 'choice', choiceId: matching[0].id };
    }
  }
}
