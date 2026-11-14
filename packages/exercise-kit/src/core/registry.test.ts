import { describe, expect, it } from 'vitest';

import {
  ANSWER_KEY_FIELDS,
  EXTRA_RAW_SPECS,
  RAW_SPECS,
  SENTINEL,
  collectKeys,
} from '../testing/fixtures.ts';
import { ExerciseKitError } from './errors.ts';
import {
  checkSpec,
  getExerciseType,
  leakFingerprints,
  gradeSubmission,
  implementedExerciseTypes,
  parseSpec,
  redactSpec,
  specMisconceptions,
  verifySpec,
} from './registry.ts';
import { EXERCISE_TYPE_IDS } from './types.ts';

function expectKitError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ExerciseKitError);
    expect((error as ExerciseKitError).code).toBe(code);
    return;
  }
  throw new Error(`expected ExerciseKitError ${code}`);
}

describe('registry', () => {
  it('registers known type IDs with category metadata', () => {
    for (const id of implementedExerciseTypes()) {
      expect(EXERCISE_TYPE_IDS).toContain(id);
      expect(RAW_SPECS[id], `fixture for ${id}`).toBeDefined();
    }
    expect(getExerciseType('mcq_single')?.category).toBe('recognition');
    expect(getExerciseType('mcq_multi')?.category).toBe('recognition');
    expect(getExerciseType('true_false')).toMatchObject({
      category: 'recognition',
      weightOverride: 0.5,
    });
    expect(getExerciseType('fill_blank')?.category).toBe('recall');
    expect(getExerciseType('predict_output')?.category).toBe('recall');
    for (const id of ['implement_function', 'fix_bug', 'web_task']) {
      expect(getExerciseType(id)?.category).toBe('production');
      expect(getExerciseType(id)?.supportsRunPlan).toBe(true);
    }
    expect(implementedExerciseTypes()).toHaveLength(9);
    expect(getExerciseType('parsons')).toMatchObject({ category: 'recall', supportsRunPlan: true });
    expect(getExerciseType('nope')).toBeUndefined();
  });

  it('throws UNKNOWN_TYPE for unregistered types', () => {
    expectKitError(() => parseSpec('matching', {}), 'UNKNOWN_TYPE');
    expectKitError(() => gradeSubmission({ typeId: 'x', spec: {}, answer: {} }), 'UNKNOWN_TYPE');
  });

  it('validates spec, answer and run result at the boundary', () => {
    expectKitError(() => parseSpec('mcq_single', { options: [] }), 'INVALID_SPEC');
    expectKitError(
      () =>
        gradeSubmission({
          typeId: 'mcq_single',
          spec: RAW_SPECS['mcq_single'],
          answer: { optionId: 7 },
        }),
      'INVALID_ANSWER',
    );
    expectKitError(
      () =>
        gradeSubmission({
          typeId: 'mcq_single',
          spec: RAW_SPECS['mcq_single'],
          answer: { optionId: 'b' },
          run: { status: 'completed' },
        }),
      'INVALID_RUN_RESULT',
    );
    expectKitError(
      () =>
        gradeSubmission({
          typeId: 'fill_blank',
          spec: RAW_SPECS['fill_blank'],
          answer: JSON.parse('{"blanks": {"__proto__": {"b1": "return"}}}'),
        }),
      'INVALID_ANSWER',
    );
    expectKitError(() => parseSpec('mcq_single', JSON.parse('{"__proto__": {}}')), 'INVALID_SPEC');
    let deep: unknown = 'x';
    for (let i = 0; i < 5_000; i++) deep = { blanks: deep };
    expectKitError(
      () => gradeSubmission({ typeId: 'fill_blank', spec: RAW_SPECS['fill_blank'], answer: deep }),
      'INVALID_ANSWER',
    );
    expectKitError(
      () =>
        gradeSubmission({
          typeId: 'fill_blank',
          spec: RAW_SPECS['fill_blank'],
          answer: { blanks: { b1: 'x'.repeat(501) } },
        }),
      'INVALID_ANSWER',
    );
  });

  it('grades through the registry', () => {
    expect(
      gradeSubmission({
        typeId: 'mcq_single',
        spec: RAW_SPECS['mcq_single'],
        answer: { optionId: 'b' },
      }),
    ).toMatchObject({ correct: true, engineApplicable: true });
    expect(
      gradeSubmission({
        typeId: 'predict_output',
        spec: RAW_SPECS['predict_output'],
        answer: { choiceId: 'b' },
      }).misconceptionIds,
    ).toEqual(['js.mc.secret-b']);
  });

  it('runs static verification through the registry', () => {
    expect(verifySpec('mcq_single', RAW_SPECS['mcq_single'])).toEqual([]);
  });

  it('checkSpec reports schema errors, verification errors and warnings as strings', () => {
    expect(checkSpec('mcq_single', RAW_SPECS['mcq_single'])).toEqual({
      ok: true,
      warnings: [],
      misconceptions: ['js.mc.secret-a', 'js.mc.secret-c'],
    });
    const schemaError = checkSpec('mcq_single', { options: [], correct: 'a' });
    expect(schemaError.ok).toBe(false);
    if (!schemaError.ok) expect(schemaError.errors[0]).toMatch(/^options/);
    const banned = checkSpec('mcq_single', {
      options: [
        { id: 'a', text: '1' },
        { id: 'b', text: '2' },
        { id: 'c', text: '모두 정답' },
      ],
      correct: 'a',
    });
    expect(banned.ok).toBe(false);
    const warning = checkSpec('predict_output', { code: 'console.log(1)', answerKind: 'console' });
    expect(warning).toMatchObject({
      ok: true,
      warnings: [expect.stringContaining('PREDICT_EXPECTED_MISSING')],
    });
    expect(checkSpec('nope', {})).toEqual({
      ok: false,
      errors: ['exercise type nope is not implemented'],
    });
  });

  it('collects every misconception ID a spec refers to', () => {
    expect(specMisconceptions('mcq_multi', RAW_SPECS['mcq_multi'])).toEqual([
      'js.mc.secret-missed',
      'js.mc.secret-b',
      'js.mc.secret-d',
    ]);
    expect(specMisconceptions('true_false', RAW_SPECS['true_false'])).toEqual([
      'js.mc.secret-wrong',
      'js.mc.secret-r2',
    ]);
    expect(specMisconceptions('fill_blank', RAW_SPECS['fill_blank'])).toEqual(['js.mc.secret-log']);
    expect(specMisconceptions('fix_bug', RAW_SPECS['fix_bug'])).toEqual([
      'js.mc.secret-v',
      'js.mc.secret-h',
      'js.mc.secret-bug',
    ]);
  });

  it('extracts normalized answer-leak fingerprints', () => {
    expect(leakFingerprints('mcq_single', RAW_SPECS['mcq_single'])).toEqual([
      '`undefined`',
      'undefined',
    ]);
    expect(leakFingerprints('fill_blank', RAW_SPECS['fill_blank'])).toEqual(['secret']);
    expect(leakFingerprints('predict_output', RAW_SPECS['predict_output'])).toEqual(['1']);
    expect(
      leakFingerprints('predict_output', {
        code: 'x',
        answerKind: 'console',
        expected: { kind: 'console', lines: ['a  b', '[1, "x"]'] },
      }),
    ).toEqual(['a b [1, "x"]', 'a b', '[1, "x"]']);
  });
});

describe('answer-key stripping', () => {
  const cases = implementedExerciseTypes().map((id) => [id] as const);
  const allSpecs: [string, unknown][] = [
    ...implementedExerciseTypes().map((id): [string, unknown] => [id, RAW_SPECS[id]]),
    ...EXTRA_RAW_SPECS,
  ];

  it.each(allSpecs)(
    '%s: no answer key, misconception or sentinel survives redaction',
    (typeId, raw) => {
      const options = [undefined, { shuffleSeed: 'a1' }];
      for (const option of options) {
        const publicSpec = redactSpec(typeId, raw, option);
        const keys = collectKeys(publicSpec);
        for (const field of ANSWER_KEY_FIELDS)
          expect(keys.has(field), `${typeId}.${field}`).toBe(false);
        expect(JSON.stringify(publicSpec).toLowerCase()).not.toContain(SENTINEL);
      }
    },
  );

  it.each(cases)('%s: public spec conforms to its published schema', (typeId) => {
    const def = getExerciseType(typeId);
    const publicSpec = redactSpec(typeId, RAW_SPECS[typeId]);
    expect(def?.publicSpecSchema.safeParse(publicSpec).success).toBe(true);
  });

  it.each(cases)(
    '%s: the raw fixture really contains the sentinel (guards the test itself)',
    (typeId) => {
      expect(JSON.stringify(RAW_SPECS[typeId]).toLowerCase()).toContain(SENTINEL);
    },
  );
});
