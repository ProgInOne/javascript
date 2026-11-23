import { describe, expect, it } from 'vitest';

import { ExerciseKitError } from '@proginone/exercise-core';
import { buildRunPlan, gradeSubmission, verifySpec } from '../core/registry.ts';
import { makeRun, returned } from '../testing/run.ts';
import {
  assembleParsons,
  parsons,
  parsonsPublicId,
  parsonsReferenceAnswer,
  parsonsSpecSchema,
  type ParsonsAnswer,
} from './parsons.ts';

const spec = parsonsSpecSchema.parse({
  lines: [
    { id: 'l1', code: 'function sum(arr) {' },
    { id: 'l2', code: 'let total = 0;', indent: 1 },
    { id: 'l3', code: 'for (const n of arr) {', indent: 1 },
    { id: 'l4', code: 'total += n;', indent: 2 },
    { id: 'l5', code: '}', indent: 1 },
    { id: 'l6', code: 'return total;', indent: 1 },
    { id: 'l7', code: '}' },
  ],
  distractors: [{ id: 'd1', code: 'total = n;', misconception: 'js.mc.accumulator-overwrite' }],
});

const pid = parsonsPublicId;
const order = (...items: [string, number][]): ParsonsAnswer => ({
  order: items.map(([id, indent]) => ({ id: pid(id), indent })),
});
const correctOrder: [string, number][] = [
  ['l1', 0],
  ['l2', 1],
  ['l3', 1],
  ['l4', 2],
  ['l5', 1],
  ['l6', 1],
  ['l7', 0],
];
const grade = (answer: ParsonsAnswer, s = spec) => parsons.grade({ spec: s, answer });

describe('parsons (order grading)', () => {
  it('accepts the correct order and indents', () => {
    expect(grade(order(...correctOrder))).toMatchObject({
      correct: true,
      outcome: 'correct',
      score: 1,
      misconceptionIds: [],
      graderVersion: 'parsons@1',
    });
    expect(grade(parsonsReferenceAnswer(spec)).correct).toBe(true);
  });

  it('treats blocks with the same code as interchangeable', () => {
    const swapped = correctOrder.map(([id, indent]): [string, number] => [
      id === 'l5' ? 'l7' : id === 'l7' ? 'l5' : id,
      indent,
    ]);
    expect(grade(order(...swapped)).correct).toBe(true);
  });

  it('gives LCS partial credit and marks lines in place without telling positions', () => {
    const answer = order(
      ['l1', 0],
      ['l3', 1],
      ['l2', 1],
      ['l4', 2],
      ['l5', 1],
      ['l6', 1],
      ['l7', 0],
    );
    const result = grade(answer);
    expect(result.correct).toBe(false);
    expect(result.score).toBeCloseTo(6 / 7);
    const inPlace = result.feedback.filter((f) => f.code === 'PARSONS_IN_PLACE');
    expect(inPlace).toHaveLength(6);
    expect(inPlace.every((f) => f.target?.startsWith('block:b'))).toBe(true);
    expect(result.feedback.map((f) => f.code)).toContain('PARSONS_ORDER');
    expect(result.feedback.map((f) => f.code)).not.toContain('PARSONS_MISSING');
  });

  it('half-credits wrong indents when indent is graded', () => {
    const flat = correctOrder.map(([id]): [string, number] => [id, 0]);
    const result = grade(order(...flat));
    expect(result.correct).toBe(false);
    // l1 and l7 are at indent 0 already: 2 × 1 + 5 × 0.5.
    expect(result.score).toBeCloseTo(4.5 / 7);
    expect(result.feedback.map((f) => f.code)).toContain('PARSONS_INDENT');
    expect(result.feedback.filter((f) => f.code === 'PARSONS_INDENT_WRONG')).toHaveLength(5);
    expect(grade(order(...flat), { ...spec, gradeIndent: false }).correct).toBe(true);
  });

  it('penalizes distractors and missing lines and reports the distractor misconception', () => {
    const withDistractor = order(...correctOrder.slice(0, 3), ['d1', 2], ...correctOrder.slice(4));
    const result = grade(withDistractor);
    expect(result.correct).toBe(false);
    expect(result.score).toBeCloseTo(6 / 7);
    expect(result.misconceptionIds).toEqual(['js.mc.accumulator-overwrite']);
    const codes = result.feedback.map((f) => f.code);
    expect(codes).toContain('PARSONS_DISTRACTOR');
    expect(codes).toContain('PARSONS_MISSING');

    const extra = grade(order(...correctOrder, ['d1', 0]));
    expect(extra.correct).toBe(false);
    expect(extra.score).toBeCloseTo(7 / 8);

    expect(grade({ order: [] })).toMatchObject({ correct: false, score: 0 });
  });

  it('accepts alternatives', () => {
    const alt = parsonsSpecSchema.parse({
      lines: [
        { id: 'a', code: 'let x = 1;' },
        { id: 'b', code: 'let y = 2;' },
        { id: 'c', code: 'console.log(x + y);' },
      ],
      alternatives: [['b', 'a', 'c']],
    });
    expect(grade(order(['b', 0], ['a', 0], ['c', 0]), alt).correct).toBe(true);
    expect(grade(order(['a', 0], ['b', 0], ['c', 0]), alt).correct).toBe(true);
    expect(grade(order(['c', 0], ['a', 0], ['b', 0]), alt).correct).toBe(false);
  });

  it('ignores unknown and hostile block IDs (never correct)', () => {
    const answer = order(...correctOrder);
    answer.order.push({ id: '__proto__', indent: 0 });
    const result = grade(answer);
    expect(result.correct).toBe(false);
    expect(result.feedback[0]?.code).toBe('PARSONS_UNKNOWN_BLOCK');
    expect(grade({ order: [{ id: 'l1', indent: 0 }] }).score).toBe(0);
  });
});

describe('parsons (redaction and validation)', () => {
  it('publishes shuffled blocks with opaque IDs, never in the correct order', () => {
    const pub = parsons.redact(spec, { shuffleSeed: 'item-1' });
    expect(parsons.redact(spec, { shuffleSeed: 'item-1' })).toEqual(pub);
    expect(pub.blocks).toHaveLength(8);
    expect(pub.blocks.every((b) => /^b[0-9a-z]{8}$/.test(b.id))).toBe(true);
    expect(JSON.stringify(pub)).not.toMatch(/"(l\d|d1)"/);
    expect(pub).not.toHaveProperty('checks');
    for (let i = 0; i < 50; i++) {
      const blocks = parsons.redact(spec, { shuffleSeed: `s${i}` }).blocks;
      expect(blocks.slice(0, 7).map((b) => b.code)).not.toEqual(spec.lines.map((l) => l.code));
    }
    const two = parsonsSpecSchema.parse({
      lines: [
        { id: 'a', code: 'first();' },
        { id: 'b', code: 'second();' },
      ],
    });
    for (let i = 0; i < 20; i++) {
      expect(parsons.redact(two, { shuffleSeed: `t${i}` }).blocks.map((b) => b.code)).toEqual([
        'second();',
        'first();',
      ]);
    }
    expect(parsons.redact(two).blocks.map((b) => b.code)).toEqual(['second();', 'first();']);
  });

  it('rejects invalid specs', () => {
    const base = { lines: spec.lines, distractors: spec.distractors };
    const bad = (patch: object) => parsonsSpecSchema.safeParse({ ...base, ...patch }).success;
    expect(bad({})).toBe(true);
    expect(bad({ lines: spec.lines.slice(0, 1) })).toBe(false);
    expect(bad({ distractors: [{ id: 'l1', code: 'x;' }] })).toBe(false);
    expect(bad({ lines: [...spec.lines, { id: 'l8', code: 'a\nb' }] })).toBe(false);
    expect(bad({ lines: [...spec.lines, { id: 'l8', code: '   ' }] })).toBe(false);
    expect(bad({ alternatives: [['l1', 'l2']] })).toBe(false);
    expect(bad({ distractors: [{ id: 'd1', code: 'x;', replaces: 'zz' }] })).toBe(false);
  });

  it('flags distractors that look like a line', () => {
    expect(parsons.verify(spec)).toEqual([]);
    const dup = { ...spec, distractors: [{ id: 'd1', code: 'return total;' }] };
    expect(parsons.verify(dup).map((i) => i.code)).toEqual(['PARSONS_DISTRACTOR_IS_LINE']);
  });

  it('fingerprints the order, not single public blocks', () => {
    const fps = parsons.leakFingerprints(spec);
    expect(fps[0]).toBe(
      'function sum(arr) { let total = 0; for (const n of arr) { total += n; } return total; }',
    );
    expect(fps).toContain('let total = 0; for (const n of arr) {');
    expect(fps).not.toContain('total += n;');
  });
});

describe('parsons (run grading)', () => {
  const runSpec = {
    lines: [
      { id: 'l1', code: 'function sum(arr) {' },
      { id: 'l2', code: 'let total = 0;', indent: 1 },
      { id: 'l3', code: 'for (const n of arr) total += n;', indent: 1 },
      { id: 'l4', code: 'return total;', indent: 1 },
      { id: 'l5', code: '}' },
    ],
    distractors: [{ id: 'd1', code: 'return 0;', misconception: 'js.mc.early-return' }],
    gradeIndent: false,
    entry: 'sum',
    checks: [
      { kind: 'call', id: 'basic', args: [[1, 2]], expect: { equals: 3 } },
      {
        kind: 'call',
        id: 'hidden',
        visible: false,
        description: '빈 배열',
        args: [[]],
        expect: { equals: 0 },
      },
    ],
  };
  const answer = {
    order: ['l1', 'l2', 'l3', 'l4', 'l5'].map((id) => ({ id: pid(id), indent: 0 })),
  };

  it('assembles the answer with indentation into the run plan', () => {
    const parsed = parsonsSpecSchema.parse(runSpec);
    expect(assembleParsons(parsed, parsonsReferenceAnswer(parsed))).toBe(
      'function sum(arr) {\n  let total = 0;\n  for (const n of arr) total += n;\n  return total;\n}',
    );
    const plan = buildRunPlan({ typeId: 'parsons', spec: runSpec, answer, purpose: 'grading' });
    expect(plan.mode).toBe('js-console');
    expect(plan.files[0]?.content).toContain('let total = 0;\nfor');
    expect(plan.checks.steps.map((s) => s.id)).toEqual(['settle', 'basic#0', 'hidden#0']);
    const interactive = buildRunPlan({
      typeId: 'parsons',
      spec: runSpec,
      answer,
      purpose: 'interactive',
    });
    expect(interactive.checks.steps.map((s) => s.id)).toEqual(['settle', 'basic#0']);
  });

  it('needs a run and grades by checks (any working order is correct)', () => {
    expect(() => gradeSubmission({ typeId: 'parsons', spec: runSpec, answer })).toThrow(
      ExerciseKitError,
    );
    const pass = makeRun([
      { op: 'waitSettled', id: 'settle', settled: true },
      returned('basic#0', 3),
      returned('hidden#0', 0),
    ]);
    expect(gradeSubmission({ typeId: 'parsons', spec: runSpec, answer, run: pass })).toMatchObject({
      correct: true,
      score: 1,
    });
    const withDistractor = {
      order: [...answer.order.slice(0, 3), { id: pid('d1'), indent: 1 }, ...answer.order.slice(3)],
    };
    const fail = makeRun([
      { op: 'waitSettled', id: 'settle', settled: true },
      returned('basic#0', 0),
      returned('hidden#0', 0),
    ]);
    const result = gradeSubmission({
      typeId: 'parsons',
      spec: runSpec,
      answer: withDistractor,
      run: fail,
    });
    expect(result.correct).toBe(false);
    expect(result.misconceptionIds).toContain('js.mc.early-return');
    expect(result.checkResults?.map((c) => c.passed)).toEqual([false, true]);
  });

  it('verifies checks and warns about settings that checks make moot', () => {
    expect(verifySpec('parsons', runSpec)).toEqual([]);
    const codes = verifySpec('parsons', {
      ...runSpec,
      gradeIndent: true,
      alternatives: [['l1', 'l2', 'l3', 'l4', 'l5']],
    }).map((i) => i.code);
    expect(codes).toEqual([
      'PARSONS_ALTERNATIVES_WITH_CHECKS',
      'PARSONS_INDENT_NOT_GRADED_WITH_CHECKS',
    ]);
    expect(verifySpec('parsons', { ...runSpec, entry: undefined }).map((i) => i.code)).toContain(
      'CHECK_NEEDS_ENTRY',
    );
  });
});
