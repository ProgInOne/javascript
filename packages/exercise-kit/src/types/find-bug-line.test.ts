import { describe, expect, it } from 'vitest';

import { logEntries, makeRun } from '../testing/run.ts';
import {
  buildFindBugRunPlan,
  findBugLine,
  findBugLineSpecSchema,
  observeSymptom,
} from './find-bug-line.ts';

const CODE = [
  'const prices = [100, 200, 300];',
  'let total;',
  'for (const p of prices) {',
  '  total += p;',
  '}',
  'console.log(total);',
].join('\n');

const spec = findBugLineSpecSchema.parse({
  code: CODE,
  bugLines: [2],
  acceptLines: [4],
  symptom: '출력이 `NaN`입니다.',
  symptomCheck: { console: ['NaN'] },
  fixedCode: CODE.replace('let total;', 'let total = 0;'),
  causeOptions: [
    { id: 'c1', text: 'total이 초기화되지 않아 undefined + 100이 계산된다', correct: true },
    { id: 'c2', text: 'for...of는 배열에 쓸 수 없다', misconception: 'js.mc.for-of-objects-only' },
  ],
});
const lineOnly = findBugLineSpecSchema.parse({ ...spec, causeOptions: undefined });

describe('find_bug_line grading', () => {
  it('needs the line (bugLines or acceptLines) and, with options, the cause', () => {
    const g = (line: number, causeId?: string) =>
      findBugLine.grade({ spec, answer: causeId === undefined ? { line } : { line, causeId } });
    expect(g(2, 'c1')).toMatchObject({
      correct: true,
      score: 1,
      graderVersion: 'find_bug_line@1',
    });
    expect(g(4, 'c1').correct).toBe(true);
    expect(g(2, 'c2')).toMatchObject({
      correct: false,
      outcome: 'partial',
      score: 0.5,
      misconceptionIds: ['js.mc.for-of-objects-only'],
    });
    expect(g(2).feedback[0]?.code).toBe('FIND_BUG_NO_CAUSE');
    expect(g(6, 'c1')).toMatchObject({ correct: false, score: 0 });
    expect(g(6, 'c1').feedback).toEqual([
      {
        level: 'error',
        code: 'FIND_BUG_WRONG_LINE',
        message: '이 줄은 증상의 원인이 아닙니다.',
        target: '6',
      },
    ]);
    expect(g(99, 'c1').feedback[0]?.code).toBe('FIND_BUG_LINE_OUT_OF_RANGE');
    expect(g(2, '__proto__').score).toBe(0.5);
  });

  it('grades the line alone when there are no cause options', () => {
    expect(findBugLine.grade({ spec: lineOnly, answer: { line: 2 } }).correct).toBe(true);
    expect(findBugLine.grade({ spec: lineOnly, answer: { line: 1 } })).toMatchObject({
      correct: false,
      outcome: 'incorrect',
      misconceptionIds: [],
    });
  });
});

describe('find_bug_line spec', () => {
  it('redacts everything but the code, symptom and cause texts', () => {
    const pub = findBugLine.redact(spec, { shuffleSeed: 'x' });
    expect(Object.keys(pub).sort()).toEqual(['causeOptions', 'code', 'symptom']);
    expect(pub.causeOptions?.map((c) => Object.keys(c).sort())).toEqual([
      ['id', 'text'],
      ['id', 'text'],
    ]);
    expect(findBugLine.redact(lineOnly)).toEqual({ code: CODE, symptom: spec.symptom });
  });

  it('validates line numbers, causes and the fix', () => {
    const bad = (patch: object) => findBugLineSpecSchema.safeParse({ ...spec, ...patch }).success;
    expect(bad({})).toBe(true);
    expect(bad({ bugLines: [7] })).toBe(false);
    expect(bad({ acceptLines: [0] })).toBe(false);
    expect(bad({ bugLines: [] })).toBe(false);
    expect(bad({ symptomCheck: { console: ['NaN'], error: 'TypeError' } })).toBe(false);
    expect(bad({ causeOptions: spec.causeOptions?.map((c) => ({ ...c, correct: false })) })).toBe(
      false,
    );

    expect(findBugLine.verify(spec)).toEqual([]);
    expect(findBugLine.verify({ ...spec, bugLines: [5, 2] }).map((i) => i.code)).toEqual([]);
    const blank = findBugLineSpecSchema.parse({ ...spec, code: `${CODE}\n\nx;`, bugLines: [7] });
    expect(findBugLine.verify(blank).map((i) => i.code)).toContain('FIND_BUG_BLANK_LINE');
    expect(findBugLine.verify({ ...spec, fixedCode: CODE }).map((i) => i.code)).toContain(
      'FIND_BUG_FIX_UNCHANGED',
    );
    expect(
      findBugLine.verify({ ...spec, bugLines: [1], acceptLines: [] }).map((i) => i.code),
    ).toEqual(['FIND_BUG_FIX_OUTSIDE_LINES']);
  });

  it('fingerprints the fix and the correct cause, not the public code', () => {
    expect(findBugLine.leakFingerprints(spec)).toEqual([
      'total이 초기화되지 않아 undefined + 100이 계산된다',
      'let total = 0;',
    ]);
  });
});

describe('find_bug_line symptom observation', () => {
  it('plans a console run of the given code', () => {
    const plan = buildFindBugRunPlan(CODE);
    expect(plan).toMatchObject({ mode: 'js-console', purpose: 'verification' });
    expect(plan.files[0]?.content).toBe(CODE);
    expect(plan.checks.steps.map((s) => s.op)).toEqual(['waitSettled', 'consoleOutput']);
  });

  const consoleRun = (...lines: string[]) =>
    makeRun([
      { op: 'consoleOutput', id: 'output', entries: logEntries(...lines), truncated: false },
    ]);
  const errorRun = (name: string) =>
    makeRun([], {
      status: 'error',
      errors: [{ phase: 'runtime', name, message: 'boom' }],
    });

  it('matches console symptoms line by line', () => {
    expect(observeSymptom({ console: ['NaN'] }, consoleRun('NaN'))).toEqual({
      shown: true,
      clean: true,
      summary: '출력 NaN',
    });
    expect(observeSymptom({ console: ['NaN'] }, consoleRun('600')).shown).toBe(false);
    expect(observeSymptom({ console: ['NaN'] }, errorRun('TypeError'))).toMatchObject({
      shown: false,
      clean: false,
      summary: '출력 없음, 오류 TypeError: boom',
    });
  });

  it('matches error symptoms by name', () => {
    expect(observeSymptom({ error: 'TypeError' }, errorRun('TypeError')).shown).toBe(true);
    expect(observeSymptom({ error: 'TypeError' }, errorRun('ReferenceError')).shown).toBe(false);
    expect(observeSymptom({ error: 'TypeError' }, consoleRun('ok'))).toMatchObject({
      shown: false,
      clean: true,
    });
  });
});
