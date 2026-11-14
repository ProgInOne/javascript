import { describe, expect, it } from 'vitest';

import { mcqMulti, mcqMultiSpecSchema } from './mcq-multi.ts';
import { trueFalse, trueFalseSpecSchema } from './true-false.ts';

describe('mcq_multi', () => {
  const spec = mcqMultiSpecSchema.parse({
    options: [
      { id: 'a', text: '`let`', missedMisconception: 'js.mc.let-is-old' },
      {
        id: 'b',
        text: '`var`',
        misconception: 'js.mc.var-is-block',
        rationale: 'var는 블록 범위가 아닙니다.',
      },
      { id: 'c', text: '`const`' },
      { id: 'd', text: '`int`', misconception: 'js.mc.typed-declaration' },
    ],
    correct: ['a', 'c'],
  });
  const grade = (optionIds: string[]) => mcqMulti.grade({ spec, answer: { optionIds } });

  it('is correct only for the exact correct set, in any order', () => {
    expect(grade(['c', 'a'])).toMatchObject({
      correct: true,
      outcome: 'correct',
      score: 1,
      misconceptionIds: [],
    });
    expect(grade(['a', 'c']).graderVersion).toBe('mcq_multi@1');
    expect(grade(['a', 'a', 'c']).correct).toBe(true);
  });

  it('scores (right − wrong) / correct count, never below zero', () => {
    expect(grade(['a'])).toMatchObject({ correct: false, outcome: 'partial', score: 0.5 });
    expect(grade(['a', 'c', 'b'])).toMatchObject({ correct: false, score: 0.5 });
    expect(grade(['a', 'b'])).toMatchObject({ score: 0, outcome: 'incorrect' });
    expect(grade(['b', 'd'])).toMatchObject({ score: 0 });
    expect(grade([])).toMatchObject({ score: 0, correct: false });
  });

  it('reports misconceptions of wrong picks and of missed correct options', () => {
    const result = grade(['b']);
    expect(result.misconceptionIds).toEqual(['js.mc.let-is-old', 'js.mc.var-is-block']);
    expect(result.feedback.map((f) => f.code)).toEqual([
      'MCQ_MULTI_MISSED',
      'MCQ_MULTI_EXTRA',
      'MCQ_WRONG_OPTION',
    ]);
    expect(result.feedback[2]?.message).toBe('var는 블록 범위가 아닙니다.');
    // Feedback never says how many options are correct.
    expect(result.feedback.map((f) => f.message).join(' ')).not.toMatch(/\d/);
  });

  it('treats unknown and hostile option IDs as wrong without throwing', () => {
    for (const id of ['zzz', '__proto__', 'constructor']) {
      const result = grade(['a', 'c', id]);
      expect(result.correct).toBe(false);
      expect(result.feedback[0]?.code).toBe('MCQ_UNKNOWN_OPTION');
    }
  });

  it('shuffles by seed, keeps minSelect public and strips answer keys', () => {
    const a = mcqMulti.redact(spec, { shuffleSeed: 'item-1' });
    expect(mcqMulti.redact(spec, { shuffleSeed: 'item-1' })).toEqual(a);
    expect(a.options.map((o) => o.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(a.minSelect).toBe(1);
    expect(Object.keys(a.options[0] ?? {}).sort()).toEqual(['id', 'text']);
    expect(mcqMulti.redact({ ...spec, shuffle: false }).options.map((o) => o.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('validates the spec and flags undiagnostic designs', () => {
    expect(mcqMultiSpecSchema.safeParse({ ...spec, correct: [] }).success).toBe(false);
    expect(mcqMultiSpecSchema.safeParse({ ...spec, correct: ['a', 'x'] }).success).toBe(false);
    expect(mcqMultiSpecSchema.safeParse({ ...spec, correct: ['a', 'a'] }).success).toBe(false);
    expect(mcqMultiSpecSchema.safeParse({ ...spec, minSelect: 3 }).success).toBe(false);
    expect(mcqMulti.verify(spec)).toEqual([]);
    const allCorrect = { ...spec, correct: ['a', 'b', 'c', 'd'] };
    const codes = mcqMulti.verify(allCorrect).map((i) => i.code);
    expect(codes).toContain('MCQ_MULTI_ALL_CORRECT');
    expect(codes).toContain('MCQ_CORRECT_HAS_MISCONCEPTION');
    expect(mcqMulti.verify({ ...spec, correct: ['b'] }).map((i) => i.code)).toContain(
      'MCQ_WRONG_HAS_MISSED_MISCONCEPTION',
    );
  });

  it('fingerprints the correct option texts', () => {
    expect(mcqMulti.leakFingerprints(spec)).toEqual(['`let`', 'let', '`const`', 'const']);
  });
});

describe('true_false', () => {
  const plain = trueFalseSpecSchema.parse({
    statement: '`const`로 선언한 배열에는 `push`를 할 수 없다.',
    answer: false,
    misconceptionIfWrong: 'js.mc.const-is-immutable',
  });
  const reasoned = trueFalseSpecSchema.parse({
    ...plain,
    requireReason: true,
    reasons: [
      { id: 'r1', text: 'const는 재할당만 막는다', correct: true },
      { id: 'r2', text: 'const는 값 내부 변경도 막는다', misconception: 'js.mc.const-deep' },
    ],
  });

  it('declares the recognition category with the 0.5 weight override', () => {
    expect(trueFalse.category).toBe('recognition');
    expect(trueFalse.weightOverride).toBe(0.5);
  });

  it('grades the verdict and reports misconceptionIfWrong', () => {
    expect(trueFalse.grade({ spec: plain, answer: { value: false } })).toMatchObject({
      correct: true,
      score: 1,
      graderVersion: 'true_false@1',
    });
    expect(trueFalse.grade({ spec: plain, answer: { value: true } })).toMatchObject({
      correct: false,
      outcome: 'incorrect',
      score: 0,
      misconceptionIds: ['js.mc.const-is-immutable'],
    });
    // The verdict is not revealed by the feedback.
    expect(trueFalse.grade({ spec: plain, answer: { value: true } }).feedback).toEqual([
      { level: 'error', code: 'TRUE_FALSE_WRONG', message: '참/거짓 판단이 맞지 않습니다.' },
    ]);
  });

  it('requires the correct reason; a right verdict alone scores 0.5', () => {
    const g = (value: boolean, reasonId?: string) =>
      trueFalse.grade({
        spec: reasoned,
        answer: reasonId === undefined ? { value } : { value, reasonId },
      });
    expect(g(false, 'r1')).toMatchObject({ correct: true, score: 1 });
    expect(g(false, 'r2')).toMatchObject({
      correct: false,
      outcome: 'partial',
      score: 0.5,
      misconceptionIds: ['js.mc.const-deep'],
    });
    expect(g(false).feedback[0]?.code).toBe('TRUE_FALSE_NO_REASON');
    expect(g(false, '__proto__').score).toBe(0.5);
    expect(g(true, 'r2')).toMatchObject({
      score: 0,
      misconceptionIds: ['js.mc.const-is-immutable', 'js.mc.const-deep'],
    });
  });

  it('shows reasons only when required, shuffled by seed, without keys', () => {
    expect(trueFalse.redact(plain)).toEqual({ statement: plain.statement });
    const pub = trueFalse.redact(reasoned, { shuffleSeed: 's' });
    expect(pub.reasons?.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    expect(Object.keys(pub.reasons?.[0] ?? {}).sort()).toEqual(['id', 'text']);
  });

  it('validates reasons', () => {
    expect(trueFalseSpecSchema.safeParse({ ...plain, requireReason: true }).success).toBe(false);
    expect(
      trueFalseSpecSchema.safeParse({
        ...reasoned,
        reasons: reasoned.reasons?.map((r) => ({ ...r, correct: true })),
      }).success,
    ).toBe(false);
    expect(trueFalse.verify(reasoned)).toEqual([]);
    expect(trueFalse.verify({ ...reasoned, requireReason: false }).map((i) => i.code)).toEqual([
      'TRUE_FALSE_UNUSED_REASONS',
    ]);
  });

  it('fingerprints the correct reason only', () => {
    expect(trueFalse.leakFingerprints(plain)).toEqual([]);
    expect(trueFalse.leakFingerprints(reasoned)).toEqual(['const는 재할당만 막는다']);
  });
});
