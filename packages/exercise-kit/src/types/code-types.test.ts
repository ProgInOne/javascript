import { describe, expect, it } from 'vitest';

import { editDistanceExceeds, tokenize } from '../common/edit-distance.ts';
import { ExerciseKitError } from '../core/errors.ts';
import { buildRunPlan, gradeSubmission, verifySpec } from '../core/registry.ts';
import { logEntries, makeRun, returned, sv } from '../testing/run.ts';
import { codeAnswerSchema } from './code-common.ts';
import { fillBlank, fillBlankSpecSchema, fillTemplate } from './fill-blank.ts';
import { fixBug, fixBugSpecSchema, REWRITE_PENALTY } from './fix-bug.ts';
import { implementFunction, implementFunctionSpecSchema } from './implement-function.ts';
import { webTask, webTaskSpecSchema } from './web-task.ts';

const implSpec = implementFunctionSpecSchema.parse({
  starter: {
    files: [
      { path: 'main.js', content: 'function sumOfEvens(numbers) {\n  // 여기에 작성하세요\n}\n' },
      { path: 'util.js', content: '' },
    ],
  },
  entry: 'sumOfEvens',
  solution: {
    files: [
      {
        path: 'main.js',
        content:
          'function sumOfEvens(numbers) {\n  return numbers.filter((n) => n % 2 === 0).reduce((a, n) => a + n, 0);\n}\n',
      },
    ],
  },
  checks: [
    {
      kind: 'call',
      id: 'basic',
      args: [[1, 2, 3, 4]],
      expect: { equals: 6 },
      requirement: '짝수 합',
    },
    { kind: 'call', id: 'empty', args: [[]], expect: { equals: 0 }, requirement: '빈 배열 처리' },
    {
      kind: 'call',
      id: 'negatives',
      visible: false,
      description: '음수 짝수도 더해야 합니다.',
      args: [[-2, -3, 4]],
      expect: { equals: 2 },
      requirement: '음수 처리',
    },
    {
      kind: 'call',
      id: 'no-mutation',
      visible: false,
      description: '입력 배열을 바꾸면 안 됩니다.',
      args: [[2, 4]],
      expect: { argsUnchanged: true },
      misconceptionIfFail: 'js.mc.array-methods-dont-mutate',
    },
  ],
  limits: { timeoutMs: 3000 },
});

const answer = {
  files: [
    { path: 'util.js', content: '' },
    { path: 'main.js', content: 'function sumOfEvens(n) { return 6; }' },
  ],
};

const allPass = () =>
  makeRun([
    returned('basic#0', 6),
    returned('empty#0', 0),
    returned('negatives#0', 2),
    returned('no-mutation#0', 6, {
      argsAfter: [
        {
          t: 'array',
          length: 2,
          items: [
            { t: 'number', v: 2 },
            { t: 'number', v: 4 },
          ],
        },
      ],
    }),
  ]);

describe('implement_function', () => {
  it('builds a js-console plan in starter file order with only inputs', () => {
    const plan = implementFunction.buildRunPlan?.(implSpec, answer, { purpose: 'grading' });
    expect(plan).toMatchObject({
      mode: 'js-console',
      entry: 'main.js',
      timers: 'real',
      limits: { maxDurationMs: 10_000, checkTimeoutMs: 3000 },
      checks: { expose: ['sumOfEvens'] },
    });
    expect(plan?.files.map((f) => f.path)).toEqual(['main.js', 'util.js']);
    expect(plan?.checks.steps.filter((s) => s.op === 'callFunction')).toHaveLength(4);
    const interactive = implementFunction.buildRunPlan?.(implSpec, answer, {
      purpose: 'interactive',
    });
    expect(
      interactive?.checks.steps.filter((s) => s.op === 'callFunction').map((s) => s.id),
    ).toEqual(['basic#0', 'empty#0']);
    expect(interactive?.limits?.maxDurationMs).toBe(3_000);
  });

  it('grades all-pass as correct and hidden failures as partial without leaking expectations', () => {
    expect(implementFunction.grade({ spec: implSpec, answer, run: allPass() })).toMatchObject({
      correct: true,
      outcome: 'correct',
      score: 1,
    });
    const run = allPass();
    run.observations[2] = {
      op: 'callFunction',
      id: 'negatives#0',
      status: 'ok',
      outcome: 'returned',
      value: { t: 'number', v: 4 },
    };
    const result = implementFunction.grade({ spec: implSpec, answer, run });
    expect(result).toMatchObject({
      correct: false,
      outcome: 'partial',
      score: 0.75,
      failedRequirements: ['음수 처리'],
    });
    expect(result.checkResults?.find((c) => c.id === 'negatives')?.detail).toBeUndefined();
    expect(result.feedback.map((f) => f.message).join(' ')).toContain('음수 짝수도 더해야 합니다.');
  });

  it('reports a missing function and mutation misconceptions', () => {
    const missing = makeRun(
      ['basic', 'empty', 'negatives', 'no-mutation'].map((id) => ({
        op: 'callFunction',
        id: `${id}#0`,
        outcome: 'missing',
      })),
    );
    const result = implementFunction.grade({ spec: implSpec, answer, run: missing });
    expect(result).toMatchObject({ correct: false, score: 0, outcome: 'incorrect' });
    expect(result.feedback.some((f) => f.message.includes('`sumOfEvens`'))).toBe(true);
    const mutated = allPass();
    mutated.observations[3] = {
      ...returned('no-mutation#0', 6, { argsAfter: [{ t: 'array', length: 0, items: [] }] }),
      status: 'ok',
    } as (typeof mutated.observations)[number];
    expect(
      implementFunction.grade({ spec: implSpec, answer, run: mutated }).misconceptionIds,
    ).toEqual(['js.mc.array-methods-dont-mutate']);
  });

  it('maps run failures to outcome error and sandbox failures to engineApplicable false', () => {
    const syntax = makeRun([], {
      status: 'error',
      errors: [
        {
          phase: 'syntax',
          name: 'SyntaxError',
          message: 'Unexpected token',
          position: { file: 'main.js', line: 2 },
        },
      ],
    });
    const result = implementFunction.grade({ spec: implSpec, answer, run: syntax });
    expect(result).toMatchObject({
      correct: false,
      outcome: 'error',
      score: 0,
      engineApplicable: true,
    });
    expect(result.feedback[0]).toMatchObject({
      code: 'RUN_SYNTAX_ERROR',
      message: '문법 오류: Unexpected token (main.js 2번째 줄)',
    });
    expect(
      implementFunction.grade({
        spec: implSpec,
        answer,
        run: makeRun([], { status: 'loop_limit' }),
      }).outcome,
    ).toBe('error');
    const crashed = implementFunction.grade({
      spec: implSpec,
      answer,
      run: { ...allPass(), status: 'crashed' },
    });
    expect(crashed).toMatchObject({ correct: false, outcome: 'error', engineApplicable: false });
  });

  it('requires a run and validates answers at the boundary', () => {
    expect(() => gradeSubmission({ typeId: 'implement_function', spec: implSpec, answer })).toThrow(
      ExerciseKitError,
    );
    for (const files of [
      [],
      [{ path: '../x.js', content: '' }],
      [{ path: 'a/../b.js', content: '' }],
      [
        { path: 'a.js', content: '' },
        { path: 'a.js', content: '' },
      ],
      [{ path: 'a.js', content: 'x'.repeat(200_001) }],
      Array.from({ length: 21 }, (_, i) => ({ path: `f${i}.js`, content: '' })),
    ]) {
      expect(
        codeAnswerSchema.safeParse({ files }).success,
        JSON.stringify(files).slice(0, 40),
      ).toBe(false);
    }
    expect(() =>
      buildRunPlan({
        typeId: 'implement_function',
        spec: implSpec,
        answer: { files: [{ path: 'evil.html', content: '' }] },
        purpose: 'grading',
      }),
    ).toThrow(/file type/);
  });

  it('verifies decisive checks', () => {
    expect(implementFunction.verify(implSpec)).toEqual([]);
    const onlyStatic = {
      ...implSpec,
      checks: implementFunctionSpecSchema.shape.checks.parse([
        { kind: 'static', id: 's', rule: 'forbid-identifier', value: 'var' },
      ]),
    };
    expect(implementFunction.verify(onlyStatic).map((i) => i.code)).toEqual([
      'CHECKS_NOT_DECISIVE',
    ]);
    const domCheck = implementFunctionSpecSchema.shape.checks.parse([
      { kind: 'dom', id: 'd', selector: 'p', expect: { exists: true } },
    ]);
    expect(
      implementFunction.verify({ ...implSpec, checks: domCheck }).map((i) => i.code),
    ).toContain('CHECK_NEEDS_DOM');
  });

  it('extracts key solution lines as leak fingerprints', () => {
    expect(implementFunction.leakFingerprints(implSpec)).toEqual([
      'return numbers.filter((n) => n % 2 === 0).reduce((a, n) => a + n, 0);',
    ]);
  });
});

describe('implement_function without entry (program exercise, D-028)', () => {
  const programSpec = implementFunctionSpecSchema.parse({
    starter: { files: [{ path: 'main.js', content: '// nickname 변수를 선언하세요\n' }] },
    solution: {
      files: [{ path: 'main.js', content: "let nickname = '코코';\nconsole.log(nickname);\n" }],
    },
    checks: [
      { kind: 'console', id: 'out', expect: { lines: ['코코'] } },
      {
        kind: 'program',
        id: 'state',
        expect: { globals: { nickname: { equals: '코코' } }, noError: true },
      },
    ],
  });
  const programAnswer = { files: [{ path: 'main.js', content: "let nickname = '코코';" }] };

  it('parses without entry and redacts without an entry field', () => {
    expect(programSpec.entry).toBeUndefined();
    const pub = implementFunction.redact(programSpec, {});
    expect(pub).not.toHaveProperty('entry');
    expect(JSON.stringify(pub)).not.toContain('let nickname');
  });

  it('builds a plan that only observes the whole program', () => {
    const plan = implementFunction.buildRunPlan?.(programSpec, programAnswer, {
      purpose: 'grading',
    });
    expect(plan?.checks.steps.some((s) => s.op === 'callFunction')).toBe(false);
    expect(plan?.checks.steps.map((s) => s.op)).toEqual(
      expect.arrayContaining(['consoleOutput', 'readGlobal']),
    );
  });

  it('grades console and program checks', () => {
    const run = makeRun(
      [
        { op: 'consoleOutput', id: 'out#0', entries: logEntries('코코') },
        { op: 'readGlobal', id: 'state#0', outcome: 'ok', value: sv('코코') },
      ],
      { console: [] },
    );
    expect(
      implementFunction.grade({ spec: programSpec, answer: programAnswer, run }),
    ).toMatchObject({ correct: true, score: 1 });
    const missing = makeRun([
      { op: 'consoleOutput', id: 'out#0', entries: [] },
      { op: 'readGlobal', id: 'state#0', outcome: 'missing' },
    ]);
    expect(
      implementFunction.grade({ spec: programSpec, answer: programAnswer, run: missing }).correct,
    ).toBe(false);
  });

  it('verifies: call checks without entry are a spec error', () => {
    expect(implementFunction.verify(programSpec)).toEqual([]);
    const withCall = implementFunctionSpecSchema.parse({
      ...programSpec,
      checks: [{ kind: 'call', id: 'c', args: [], expect: { equals: 1 } }],
    });
    expect(implementFunction.verify(withCall).map((i) => i.code)).toContain('CHECK_NEEDS_ENTRY');
    expect(verifySpec('implement_function', withCall).some((i) => i.severity === 'error')).toBe(
      true,
    );
  });

  it('extracts leak fingerprints from the program solution', () => {
    expect(implementFunction.leakFingerprints(programSpec)).toEqual(
      expect.arrayContaining(['console.log(nickname);']),
    );
  });
});

describe('fix_bug', () => {
  const buggy =
    'function average(xs) {\n  let total = 0;\n  for (const x of xs) {\n    total += x;\n    return total / xs.length;\n  }\n}\n';
  const fixed =
    'function average(xs) {\n  let total = 0;\n  for (const x of xs) {\n    total += x;\n  }\n  return total / xs.length;\n}\n';
  const spec = fixBugSpecSchema.parse({
    buggy: { files: [{ path: 'main.js', content: buggy }] },
    entry: 'average',
    solution: { files: [{ path: 'main.js', content: fixed }] },
    checks: [
      { kind: 'call', id: 'avg', args: [[1, 2, 3]], expect: { equals: 2 } },
      { kind: 'call', id: 'one', args: [[4]], expect: { equals: 4 }, weight: 1 },
    ],
    bugDescription: '평균이 첫 값만 반영됩니다.',
    maxEditDistance: 10,
    bugMisconception: 'js.mc.return-inside-loop',
  });
  const run = (avg: number) => makeRun([returned('avg#0', avg), returned('one#0', 4)]);

  it('grades like implement_function and reports the bug misconception when still wrong', () => {
    expect(
      fixBug.grade({ spec, answer: { files: [{ path: 'main.js', content: fixed }] }, run: run(2) }),
    ).toMatchObject({ correct: true, score: 1, misconceptionIds: [] });
    expect(
      fixBug.grade({
        spec,
        answer: { files: [{ path: 'main.js', content: buggy }] },
        run: run(0.333),
      }),
    ).toMatchObject({
      correct: false,
      score: 0.5,
      misconceptionIds: ['js.mc.return-inside-loop'],
    });
  });

  it('multiplies the score by 0.8 for a rewrite but keeps the verdict', () => {
    const rewrite =
      'const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;';
    const result = fixBug.grade({
      spec,
      answer: { files: [{ path: 'main.js', content: rewrite }] },
      run: run(2),
    });
    expect(result).toMatchObject({ correct: true, score: REWRITE_PENALTY });
    expect(result.feedback.map((f) => f.code)).toContain('FIX_BUG_REWRITE');
  });

  it('flags a solution that exceeds its own edit budget', () => {
    expect(fixBug.verify(spec)).toEqual([]);
    expect(fixBug.verify({ ...spec, maxEditDistance: 1 }).map((i) => i.code)).toEqual([
      'FIX_BUG_SOLUTION_OVER_BUDGET',
    ]);
    expect(fixBug.redact(spec)).not.toHaveProperty('bugMisconception');
  });
});

describe('token edit distance', () => {
  it('ignores comments and whitespace', () => {
    expect(tokenize('a  =  1; // hi\n/* x */ b')).toEqual(['a', '=', '1', ';', 'b']);
    expect(tokenize('s = "a b"')).toEqual(['s', '=', '"a b"']);
  });

  it('decides whether the distance exceeds a limit', () => {
    const a = tokenize('return total / xs.length;');
    expect(editDistanceExceeds(a, a, 0)).toBe(false);
    expect(editDistanceExceeds(a, tokenize('return sum / xs.length;'), 1)).toBe(false);
    expect(editDistanceExceeds(a, tokenize('return sum / ys.length;'), 1)).toBe(true);
    expect(editDistanceExceeds(['a'], ['a', 'b', 'c'], 1)).toBe(true);
    expect(editDistanceExceeds([], ['x'], 1)).toBe(false);
  });
});

describe('web_task (basic)', () => {
  const spec = webTaskSpecSchema.parse({
    focus: 'dom',
    starter: {
      files: [
        {
          path: 'index.html',
          content: '<input id="todo"><button id="add">추가</button><ul id="list"></ul>',
        },
      ],
    },
    solution: {
      files: [
        {
          path: 'index.html',
          content: '<script>document.querySelector("#add").addEventListener("click", add)</script>',
        },
      ],
    },
    viewports: [1280],
    checks: [
      {
        kind: 'dom',
        id: 'has-input',
        selector: '#todo',
        expect: { exists: true },
        requirement: '입력창',
      },
      {
        kind: 'event',
        id: 'add-item',
        steps: [
          { action: 'type', selector: '#todo', value: '우유 사기' },
          { action: 'click', selector: '#add' },
        ],
        expect: [{ selector: '#list li', count: 1, text: { equals: '우유 사기' } }],
      },
    ],
    milestones: [
      { id: 'm1', title: '할 일 입력창 만들기', checks: ['has-input'] },
      { id: 'm2', title: '추가 버튼으로 목록에 항목 넣기', checks: ['add-item'] },
    ],
  });
  const html = { files: [{ path: 'index.html', content: '<input id="todo">' }] };

  it('builds a dom plan with viewport and accepts only index.html', () => {
    const plan = webTask.buildRunPlan?.(spec, html, { purpose: 'grading' });
    expect(plan).toMatchObject({
      mode: 'dom',
      entry: 'index.html',
      viewport: { width: 1280, height: 800 },
    });
    expect(() =>
      webTask.buildRunPlan?.(
        spec,
        { files: [{ path: 'app.js', content: '' }] },
        { purpose: 'grading' },
      ),
    ).toThrow(ExerciseKitError);
    expect(() =>
      webTask.buildRunPlan?.(
        spec,
        { files: [...html.files, { path: 'style.css', content: '' }] },
        { purpose: 'grading' },
      ),
    ).toThrow(/exactly one/);
  });

  it('grades milestones separately', () => {
    const run = makeRun([
      { op: 'domQuery', id: 'has-input#q', count: 1, items: [{}] },
      { op: 'dispatch', id: 'add-item#s0', ok: true },
      { op: 'dispatch', id: 'add-item#s1', ok: true },
      { op: 'domQuery', id: 'add-item#e0', count: 0, items: [] },
    ]);
    const result = webTask.grade({ spec, answer: html, run });
    expect(result).toMatchObject({ correct: false, outcome: 'partial', score: 0.5 });
    expect(result.milestones?.map((m) => m.passed)).toEqual([true, false]);
  });

  it('rejects multi-file specs, unknown milestone checks and call checks', () => {
    const raw = webTaskSpecSchema.parse(spec);
    expect(
      webTaskSpecSchema.safeParse({
        ...raw,
        starter: { files: [{ path: 'main.html', content: '' }] },
      }).success,
    ).toBe(false);
    expect(
      webTaskSpecSchema.safeParse({
        ...raw,
        milestones: [{ id: 'm', title: 't', checks: ['nope'] }],
      }).success,
    ).toBe(false);
    expect(
      webTaskSpecSchema.safeParse({
        ...raw,
        checks: [{ kind: 'call', id: 'c', expect: { equals: 1 } }],
      }).success,
    ).toBe(false);
    expect(verifySpec('web_task', raw)).toEqual([]);
  });

  it('keeps the debugging flag as content metadata and never sends it to the client', () => {
    const raw = webTaskSpecSchema.parse({ ...spec, debugging: true });
    expect(raw.debugging).toBe(true);
    expect(webTaskSpecSchema.safeParse({ ...spec, debugging: 'yes' }).success).toBe(false);
    expect(webTask.redact(raw)).not.toHaveProperty('debugging');
  });
});

describe('fill_blank (code mode)', () => {
  const spec = fillBlankSpecSchema.parse({
    mode: 'code',
    template: 'function add(a, b) {\n  return {{blank:b1}};\n}',
    entry: 'add',
    blanks: [{ id: 'b1', accept: ['a + b'], misconceptionMap: { 'a - b': 'js.mc.minus' } }],
    checks: [{ kind: 'call', id: 'sum', args: [1, 2], expect: { equals: 3 } }],
  });

  it('fills the template once (no re-expansion) and runs it', () => {
    expect(fillTemplate('x {{blank:b1}} y', { blanks: { b1: '{{blank:b1}}' } })).toBe(
      'x {{blank:b1}} y',
    );
    const plan = fillBlank.buildRunPlan?.(
      spec,
      { blanks: { b1: 'b + a' } },
      { purpose: 'grading' },
    );
    expect(plan?.files).toEqual([
      { path: 'main.js', language: 'js', content: 'function add(a, b) {\n  return b + a;\n}' },
    ]);
    expect(fillBlank.requiresRun(spec)).toBe(true);
  });

  it('accepts equivalent answers by execution and maps known wrong answers', () => {
    expect(
      fillBlank.grade({
        spec,
        answer: { blanks: { b1: 'b + a' } },
        run: makeRun([returned('sum#0', 3)]),
      }).correct,
    ).toBe(true);
    expect(
      fillBlank.grade({
        spec,
        answer: { blanks: { b1: 'a - b' } },
        run: makeRun([returned('sum#0', -1)]),
      }),
    ).toMatchObject({
      correct: false,
      misconceptionIds: ['js.mc.minus'],
    });
    expect(() => fillBlank.grade({ spec, answer: { blanks: { b1: 'a + b' } } })).toThrow(/run/);
  });

  it('requires checks in code mode only', () => {
    expect(fillBlankSpecSchema.safeParse({ ...spec, checks: undefined }).success).toBe(false);
    expect(fillBlankSpecSchema.safeParse({ ...spec, mode: 'text' }).success).toBe(false);
  });
});
