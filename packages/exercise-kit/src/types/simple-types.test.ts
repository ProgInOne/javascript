import { describe, expect, it } from 'vitest';

import { ExerciseKitError } from '../core/errors.ts';
import { fillBlank, fillBlankSpecSchema } from './fill-blank.ts';
import { mcqSingle, mcqSingleSpecSchema } from './mcq-single.ts';
import {
  buildPredictExpectationPlan,
  derivePredictExpected,
  predictOutput,
  predictOutputSpecSchema,
  type PredictOutputAnswer,
} from './predict-output.ts';

describe('mcq_single', () => {
  const spec = mcqSingleSpecSchema.parse({
    options: [
      {
        id: 'a',
        text: '`8`',
        misconception: 'js.mc.log-is-return',
        rationale: '출력과 반환을 혼동',
      },
      { id: 'b', text: '`undefined`' },
      { id: 'c', text: '`null`', misconception: 'js.mc.no-return-is-null' },
      { id: 'd', text: '오류가 발생한다' },
    ],
    correct: 'b',
  });

  it('grades the correct option', () => {
    const result = mcqSingle.grade({ spec, answer: { optionId: 'b' } });
    expect(result).toMatchObject({
      correct: true,
      outcome: 'correct',
      score: 1,
      misconceptionIds: [],
    });
    expect(result.graderVersion).toBe('mcq_single@1');
  });

  it('reports the misconception and rationale of a wrong option', () => {
    const result = mcqSingle.grade({ spec, answer: { optionId: 'a' } });
    expect(result).toMatchObject({
      correct: false,
      outcome: 'incorrect',
      score: 0,
      misconceptionIds: ['js.mc.log-is-return'],
    });
    expect(result.feedback[0]).toMatchObject({
      code: 'MCQ_WRONG_OPTION',
      message: '출력과 반환을 혼동',
    });
  });

  it.each(['zzz', '', '__proto__', 'constructor'])(
    'treats unknown option %j as wrong',
    (optionId) => {
      const result = mcqSingle.grade({ spec, answer: { optionId } });
      expect(result).toMatchObject({ correct: false, misconceptionIds: [] });
      expect(result.feedback[0]?.code).toBe('MCQ_UNKNOWN_OPTION');
    },
  );

  it('shuffles public options deterministically by seed only when shuffle is on', () => {
    const a = mcqSingle.redact(spec, { shuffleSeed: 'attempt-1' });
    expect(mcqSingle.redact(spec, { shuffleSeed: 'attempt-1' })).toEqual(a);
    expect(a.options.map((o) => o.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    const seeds = Array.from({ length: 20 }, (_, i) =>
      mcqSingle
        .redact(spec, { shuffleSeed: `s${i}` })
        .options.map((o) => o.id)
        .join(''),
    );
    expect(new Set(seeds).size).toBeGreaterThan(1);
    expect(
      mcqSingle.redact({ ...spec, shuffle: false }, { shuffleSeed: 'x' }).options.map((o) => o.id),
    ).toEqual(['a', 'b', 'c', 'd']);
  });

  it('rejects invalid specs and flags undiagnostic options', () => {
    expect(mcqSingleSpecSchema.safeParse({ ...spec, correct: 'x' }).success).toBe(false);
    expect(
      mcqSingleSpecSchema.safeParse({ ...spec, options: spec.options.slice(0, 2) }).success,
    ).toBe(false);
    expect(
      mcqSingleSpecSchema.safeParse({ ...spec, options: [...spec.options, spec.options[0]] })
        .success,
    ).toBe(false);
    const bad = { ...spec, options: [...spec.options.slice(0, 3), { id: 'd', text: '모두 정답' }] };
    expect(mcqSingle.verify(bad).map((i) => i.code)).toContain('MCQ_BANNED_OPTION');
    expect(mcqSingle.verify(spec)).toEqual([]);
  });
});

describe('fill_blank (text mode)', () => {
  const spec = fillBlankSpecSchema.parse({
    mode: 'text',
    template: 'function add(a, b) {\n  {{blank:b1}} a + b;\n}\nconst s = {{blank:b2}};',
    blanks: [
      { id: 'b1', accept: ['return'], misconceptionMap: { 'console.log': 'js.mc.log-is-return' } },
      { id: 'b2', accept: ["'hi'"], caseSensitive: false },
    ],
  });
  const grade = (blanks: Record<string, string>) => fillBlank.grade({ spec, answer: { blanks } });

  it('accepts exact answers', () => {
    expect(grade({ b1: 'return', b2: "'hi'" })).toMatchObject({ correct: true, score: 1 });
  });

  it.each([
    ['surrounding whitespace', '  return  '],
    ['full-width letters', 'ｒｅｔｕｒｎ'],
  ])('normalizes %s', (_, b1) => {
    expect(grade({ b1, b2: "'hi'" }).correct).toBe(true);
  });

  it('treats quote kinds as equivalent for string-literal answers and honors caseSensitive', () => {
    expect(grade({ b1: 'return', b2: '"HI"' }).correct).toBe(true);
    expect(grade({ b1: 'return', b2: '`hi`' }).correct).toBe(true);
    expect(grade({ b1: 'return', b2: '“hi”' }).correct).toBe(true);
    expect(grade({ b1: 'Return', b2: "'hi'" }).correct).toBe(false);
  });

  it('gives partial score per blank and maps known wrong answers to misconceptions', () => {
    const result = grade({ b1: ' console.log ', b2: "'hi'" });
    expect(result).toMatchObject({
      correct: false,
      outcome: 'partial',
      score: 0.5,
      misconceptionIds: ['js.mc.log-is-return'],
    });
    expect(result.feedback.find((f) => f.target === 'b1')?.code).toBe('BLANK_WRONG');
  });

  it('treats missing, empty and hostile keys as wrong without throwing', () => {
    const hostile = JSON.parse('{"__proto__": "return", "constructor": "x"}') as Record<
      string,
      string
    >;
    expect(grade(hostile)).toMatchObject({ correct: false, score: 0, outcome: 'incorrect' });
    expect(grade({ b1: '', b2: '   ' }).feedback.map((f) => f.code)).toEqual([
      'BLANK_EMPTY',
      'BLANK_EMPTY',
    ]);
    expect(grade({ b1: 'return', b2: "'hi'", extra: 'ignored' }).correct).toBe(true);
  });

  it('matches acceptRegex against the whole normalized answer', () => {
    const regexSpec = fillBlankSpecSchema.parse({
      template: '{{blank:x}}',
      blanks: [{ id: 'x', accept: [], acceptRegex: '(let|const) +n' }],
    });
    const g = (x: string) => fillBlank.grade({ spec: regexSpec, answer: { blanks: { x } } });
    expect(g('const   n').correct).toBe(true);
    expect(g('var n').correct).toBe(false);
    expect(g('const n = 1').correct).toBe(false);
  });

  it('rejects inconsistent templates and dangerous regexes', () => {
    const base = { template: '{{blank:x}}', blanks: [{ id: 'x', accept: ['a'] }] };
    expect(fillBlankSpecSchema.safeParse(base).success).toBe(true);
    expect(fillBlankSpecSchema.safeParse({ ...base, template: 'no blanks' }).success).toBe(false);
    expect(
      fillBlankSpecSchema.safeParse({ ...base, template: '{{blank:x}} {{blank:x}}' }).success,
    ).toBe(false);
    expect(
      fillBlankSpecSchema.safeParse({ ...base, template: '{{blank:x}}{{blank:y}}' }).success,
    ).toBe(false);
    expect(
      fillBlankSpecSchema.safeParse({ ...base, blanks: [{ id: 'x', accept: [] }] }).success,
    ).toBe(false);
    expect(
      fillBlankSpecSchema.safeParse({ ...base, blanks: [{ id: 'x', acceptRegex: '(a+)+$' }] })
        .success,
    ).toBe(false);
    expect(
      fillBlankSpecSchema.safeParse({ ...base, blanks: [{ id: 'x', acceptRegex: '(' }] }).success,
    ).toBe(false);
  });

  it('flags misconception answers that are also accepted', () => {
    const bad = fillBlankSpecSchema.parse({
      template: '{{blank:x}}',
      blanks: [
        { id: 'x', accept: ['return'], misconceptionMap: { ' return ': 'js.mc.log-is-return' } },
      ],
    });
    expect(fillBlank.verify(bad).map((i) => i.code)).toEqual(['BLANK_MISCONCEPTION_IS_ACCEPTED']);
  });
});

describe('predict_output', () => {
  const consoleSpec = predictOutputSpecSchema.parse({
    code: 'const a = [1, 2, 3];\nconst b = a;\nb.push(4);\nconsole.log(a.length);\nconsole.log([1, "a"]);',
    answerKind: 'console',
    expected: { kind: 'console', lines: ['4', '[1, "a"]'] },
    misconceptionByAnswer: { '3\n[1, "a"]': 'js.mc.assignment-copies-object' },
  });
  const grade = (answer: PredictOutputAnswer, spec = consoleSpec) =>
    predictOutput.grade({ spec, answer });

  it('accepts structurally equal output with any quotes and spacing', () => {
    expect(grade({ console: "4\n[1,'a']" }).correct).toBe(true);
    expect(grade({ console: '4  \r\n[ 1, "a" ]\r\n\r\n' }).correct).toBe(true);
  });

  it('scores line by line and maps known wrong output to misconceptions', () => {
    expect(grade({ console: "3\n[1, 'a']" })).toMatchObject({
      correct: false,
      outcome: 'partial',
      score: 0.5,
      misconceptionIds: ['js.mc.assignment-copies-object'],
    });
    const extra = grade({ console: '4\n[1, "a"]\nmore' });
    expect(extra).toMatchObject({ correct: false });
    expect(extra.score).toBeCloseTo(2 / 3);
    expect(extra.feedback.map((f) => f.code)).toContain('PREDICT_LINE_COUNT');
    expect(grade({ console: '' })).toMatchObject({
      correct: false,
      score: 0,
      outcome: 'incorrect',
    });
  });

  it('never leaks the expected output in feedback', () => {
    const result = grade({ console: '1\n2' });
    expect(JSON.stringify(result.feedback)).not.toContain('[1, \\"a\\"]');
    expect(JSON.stringify(result.feedback)).not.toMatch(/\b4\b/);
  });

  it('accepts empty output when nothing is printed', () => {
    const silent = predictOutputSpecSchema.parse({
      code: 'let x = 1;',
      answerKind: 'console',
      expected: { kind: 'console', lines: [] },
    });
    expect(grade({ console: '\n\n' }, silent)).toMatchObject({ correct: true, score: 1 });
  });

  it('compares value answers as literals, keeping "5" and 5 distinct', () => {
    const spec = predictOutputSpecSchema.parse({
      code: 'const result = "2" + 3;',
      answerKind: 'value',
      expression: 'result',
      expected: { kind: 'value', value: { t: 'string', v: '23' } },
      misconceptionByAnswer: { '5': 'js.mc.plus-always-adds' },
    });
    expect(grade({ value: "'23'" }, spec).correct).toBe(true);
    expect(grade({ value: '23' }, spec)).toMatchObject({ correct: false, misconceptionIds: [] });
    expect(grade({ value: '5' }, spec).misconceptionIds).toEqual(['js.mc.plus-always-adds']);
    expect(grade({ value: 'alert(1)' }, spec).feedback[0]?.code).toBe('PREDICT_NOT_LITERAL');
  });

  it('compares only thrown-ness and error name for error answers', () => {
    const spec = predictOutputSpecSchema.parse({
      code: 'null.x',
      answerKind: 'error',
      expected: { kind: 'error', thrown: true, name: 'TypeError' },
    });
    expect(grade({ error: { thrown: true, name: ' TypeError ' } }, spec).correct).toBe(true);
    expect(grade({ error: { thrown: true, name: 'ReferenceError' } }, spec)).toMatchObject({
      correct: false,
      score: 0.5,
      outcome: 'partial',
    });
    expect(grade({ error: { thrown: false } }, spec)).toMatchObject({ correct: false, score: 0 });
  });

  it('grades choice answers against the execution-derived choice', () => {
    const spec = predictOutputSpecSchema.parse({
      code: 'console.log(1)',
      answerKind: 'choice',
      choices: [
        { id: 'a', text: '1' },
        { id: 'b', text: '2' },
      ],
      expected: { kind: 'choice', choiceId: 'a' },
    });
    expect(grade({ choiceId: 'a' }, spec).correct).toBe(true);
    expect(grade({ choiceId: 'b' }, spec).correct).toBe(false);
  });

  it('throws typed errors for a missing key or a mismatched answer kind', () => {
    const noKey = predictOutputSpecSchema.parse({ code: 'x', answerKind: 'console' });
    expect(() => grade({ console: '1' }, noKey)).toThrow(ExerciseKitError);
    expect(() => grade({ value: '1' })).toThrow(/answer kind/);
  });

  it('validates spec consistency and flags undiagnostic misconception keys', () => {
    expect(predictOutputSpecSchema.safeParse({ code: 'x', answerKind: 'value' }).success).toBe(
      false,
    );
    expect(
      predictOutputSpecSchema.safeParse({
        code: 'x',
        answerKind: 'console',
        expected: { kind: 'value', value: { t: 'null' } },
      }).success,
    ).toBe(false);
    const bad = predictOutputSpecSchema.parse({
      ...consoleSpec,
      misconceptionByAnswer: { "4\n[1,'a']": 'js.mc.assignment-copies-object' },
    });
    expect(predictOutput.verify(bad).map((i) => i.code)).toEqual([
      'PREDICT_MISCONCEPTION_EQUALS_ANSWER',
    ]);
  });

  it('builds an observation plan and derives the answer key from a run', () => {
    const spec = predictOutputSpecSchema.parse({
      code: 'let result = 2; console.log("a", [1])',
      answerKind: 'value',
      expression: 'result',
    });
    const plan = buildPredictExpectationPlan(spec);
    expect(plan).toMatchObject({
      mode: 'js-console',
      entry: 'main.js',
      checks: { expose: ['result'] },
    });
    expect(plan.checks.steps.map((s) => s.op)).toEqual([
      'waitSettled',
      'consoleOutput',
      'readGlobal',
    ]);
    const run = {
      v: 1 as const,
      type: 'result' as const,
      runId: 'r',
      status: 'completed' as const,
      durationMs: 1,
      console: [],
      consoleTruncated: false,
      droppedConsoleEntries: 0,
      errors: [],
      observations: [
        {
          op: 'consoleOutput' as const,
          id: 'output',
          status: 'ok' as const,
          truncated: false,
          entries: [
            {
              seq: 0,
              level: 'log' as const,
              at: 0,
              args: [
                { t: 'string' as const, v: 'a' },
                { t: 'array' as const, items: [{ t: 'number' as const, v: 1 }], length: 1 },
              ],
            },
          ],
        },
        {
          op: 'readGlobal' as const,
          id: 'value',
          status: 'ok' as const,
          outcome: 'ok' as const,
          value: { t: 'number' as const, v: 2 },
        },
      ],
      pendingAtEnd: { timers: 0, intervals: 0 },
    };
    expect(derivePredictExpected(spec, run)).toEqual({
      kind: 'value',
      value: { t: 'number', v: 2 },
    });
    expect(derivePredictExpected({ ...spec, answerKind: 'console' }, run)).toEqual({
      kind: 'console',
      lines: ['a [1]'],
    });
    expect(
      derivePredictExpected(
        {
          ...spec,
          answerKind: 'choice',
          choices: [
            { id: 'x', text: 'a [1]' },
            { id: 'y', text: 'a 1' },
          ],
        },
        run,
      ),
    ).toEqual({ kind: 'choice', choiceId: 'x' });
    expect(derivePredictExpected({ ...spec, answerKind: 'error' }, run)).toEqual({
      kind: 'error',
      thrown: false,
    });
    const failing = {
      ...run,
      status: 'error' as const,
      errors: [{ phase: 'runtime' as const, name: 'TypeError', message: 'x' }],
    };
    expect(derivePredictExpected({ ...spec, answerKind: 'error' }, failing)).toEqual({
      kind: 'error',
      thrown: true,
      name: 'TypeError',
    });
    expect(() => derivePredictExpected(spec, failing)).toThrow(ExerciseKitError);
    expect(() => derivePredictExpected(spec, { ...run, status: 'timeout' })).toThrow(
      /did not finish/,
    );
  });
});
