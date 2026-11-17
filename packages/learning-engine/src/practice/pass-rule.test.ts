import { describe, expect, it } from 'vitest';
import { defaultEngineConfig as config } from '../config.ts';
import { createRng, tieBreakKeys } from '../util/rng.ts';
import type { PassRuleItem } from './pass-rule.ts';
import { evaluatePassRule, lessonPassRule } from './pass-rule.ts';

function item(overrides: Partial<PassRuleItem> = {}): PassRuleItem {
  return {
    status: 'answered',
    type: 'predict_output',
    difficulty: 2,
    finalAttempt: {
      o: 1,
      hintLevelMax: 0,
      solutionViewed: false,
      tutorAssisted: false,
      attemptInItem: 1,
    },
    firstAttemptCorrect: true,
    primaryConceptIds: ['a'],
    ...overrides,
  };
}

const rule = lessonPassRule(config, 'core');

describe('evaluatePassRule', () => {
  it('passes a clean set', () => {
    const items = [item(), item({ type: 'fix_bug', difficulty: 3 }), item()];
    const result = evaluatePassRule(config, rule, { items, introducedConceptIds: ['a'] });
    expect(result.passed).toBe(true);
    expect(result.checks.minCorrect.actual).toBe(1);
  });

  it('credits o × W_hint × W_try and counts skipped items as 0', () => {
    const items = [
      item({
        finalAttempt: {
          o: 1,
          hintLevelMax: 1,
          solutionViewed: false,
          tutorAssisted: false,
          attemptInItem: 2,
        },
      }),
      item({ status: 'skipped', finalAttempt: null, firstAttemptCorrect: false }),
      item({ type: 'fix_bug', difficulty: 3 }),
      item({
        finalAttempt: {
          o: 0.6,
          hintLevelMax: 0,
          solutionViewed: true,
          tutorAssisted: false,
          attemptInItem: 1,
        },
      }),
    ];
    const result = evaluatePassRule(config, rule, { items, introducedConceptIds: ['a'] });
    expect(result.checks.minCorrect.actual).toBeCloseTo((0.8 * 0.7 + 0 + 1 + 0.6 * 0.1) / 4, 10);
    expect(result.checks.minCorrect.met).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('checks every rule at its exact threshold', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      item({
        type: i < 5 ? 'predict_output' : 'mcq_single',
        difficulty: i === 0 ? 3 : 2,
        finalAttempt:
          i < 7
            ? {
                o: 1,
                hintLevelMax: 0,
                solutionViewed: false,
                tutorAssisted: false,
                attemptInItem: 1,
              }
            : {
                o: 0,
                hintLevelMax: 0,
                solutionViewed: false,
                tutorAssisted: false,
                attemptInItem: 1,
              },
      }),
    );
    const ok = evaluatePassRule(config, rule, { items, introducedConceptIds: ['a'] });
    expect(ok.checks.minCorrect).toEqual({ met: true, required: 0.7, actual: 0.7 });
    expect(ok.checks.minDistinctTypes).toEqual({ met: true, required: 2, actual: 2 });
    expect(ok.checks.minLevel3Correct).toEqual({ met: true, required: 1, actual: 1 });
    expect(ok.passed).toBe(true);

    expect(ok.checks.minConceptCredit).toMatchObject({ met: true, required: 0.6, actual: 0.7 });
    const pending = evaluatePassRule(config, rule, {
      items: [...items, item({ status: 'pending', finalAttempt: null })],
      introducedConceptIds: ['a'],
    });
    expect(pending.checks.allAnswered).toBe(false);
    expect(pending.passed).toBe(false);
  });

  describe('concept credit within the set (D-081)', () => {
    const right = (conceptId: string, overrides: Partial<PassRuleItem> = {}) =>
      item({ primaryConceptIds: [conceptId], ...overrides });
    const wrong = (conceptId: string, overrides: Partial<PassRuleItem> = {}) =>
      item({
        primaryConceptIds: [conceptId],
        finalAttempt: {
          o: 0,
          hintLevelMax: 0,
          solutionViewed: false,
          tutorAssisted: false,
          attemptInItem: 1,
        },
        firstAttemptCorrect: false,
        ...overrides,
      });
    const CONCEPTS = ['attributes', 'dom-tree', 'elements', 'nesting', 'skeleton'];

    it('passes 11 of 13 when every concept did well enough in the set (the reported case)', () => {
      const items = [
        right('attributes', { type: 'mcq_single' }),
        right('attributes', { type: 'fill_blank' }),
        wrong('attributes'),
        right('dom-tree', { difficulty: 3 }),
        right('dom-tree'),
        right('elements'),
        right('elements', { type: 'web_task' }),
        right('elements'),
        right('nesting'),
        wrong('nesting'),
        right('nesting'),
        right('skeleton'),
        right('skeleton'),
      ];
      const result = evaluatePassRule(config, rule, { items, introducedConceptIds: CONCEPTS });
      expect(result.checks.minConceptCredit.below).toEqual([]);
      expect(result.checks.minConceptCredit.actual).toBeCloseTo(2 / 3, 10);
      expect(
        result.checks.minConceptCredit.concepts.map((c) => [c.conceptId, c.correct, c.total]),
      ).toEqual([
        ['attributes', 2, 3],
        ['dom-tree', 2, 2],
        ['elements', 3, 3],
        ['nesting', 2, 3],
        ['skeleton', 2, 2],
      ]);
      expect(result.passed).toBe(true);
    });

    it('fails a concept answered 0 of 2 even when the set as a whole did well', () => {
      const items = [
        ...Array.from({ length: 8 }, (_, i) =>
          right('elements', { type: i % 2 ? 'mcq_single' : 'fill_blank', difficulty: 3 }),
        ),
        wrong('nesting'),
        wrong('nesting'),
      ];
      const result = evaluatePassRule(config, rule, {
        items,
        introducedConceptIds: ['elements', 'nesting'],
      });
      expect(result.checks.minCorrect.met).toBe(true);
      expect(result.checks.minConceptCredit).toMatchObject({
        met: false,
        required: 0.6,
        actual: 0,
        below: ['nesting'],
      });
      expect(result.checks.minConceptCredit.concepts[1]).toEqual({
        conceptId: 'nesting',
        credit: 0,
        correct: 0,
        total: 2,
        met: false,
      });
      expect(result.passed).toBe(false);
    });

    it('needs the credit, not only one correct item: hints and retries lower it', () => {
      const hinted = right('a', {
        finalAttempt: {
          o: 1,
          hintLevelMax: 3,
          solutionViewed: false,
          tutorAssisted: false,
          attemptInItem: 3,
        },
        firstAttemptCorrect: false,
      });
      const result = evaluatePassRule(config, rule, {
        items: [hinted, wrong('a'), right('b', { type: 'fix_bug', difficulty: 3 })],
        introducedConceptIds: ['a', 'b'],
      });
      expect(result.checks.minConceptCredit.below).toEqual(['a']);
      expect(result.checks.minConceptCredit.concepts[0]?.correct).toBe(1);
    });

    it('leaves out an introduced concept without items in the set', () => {
      const items = [right('a'), right('a', { type: 'fix_bug', difficulty: 3 })];
      const result = evaluatePassRule(config, rule, {
        items,
        introducedConceptIds: ['a', 'missing'],
      });
      expect(result.checks.minConceptCredit.concepts.map((c) => c.conceptId)).toEqual(['a']);
      expect(result.checks.minConceptCredit.below).toEqual([]);
      expect(result.passed).toBe(true);
      const none = evaluatePassRule(config, rule, {
        items: items.map((i) => ({ ...i, primaryConceptIds: [] })),
        introducedConceptIds: ['a'],
      });
      expect(none.checks.minConceptCredit).toEqual({
        met: true,
        required: 0.6,
        actual: 1,
        below: [],
        concepts: [],
      });
    });

    it('counts a skipped item as 0 for its concept', () => {
      const result = evaluatePassRule(config, rule, {
        items: [
          right('a'),
          right('a', { status: 'skipped', finalAttempt: null, firstAttemptCorrect: false }),
          right('b', { type: 'fix_bug', difficulty: 3 }),
        ],
        introducedConceptIds: ['a', 'b'],
      });
      expect(result.checks.minConceptCredit.concepts[0]).toMatchObject({
        credit: 0.5,
        correct: 1,
        total: 2,
        met: false,
      });
    });
  });

  it('needs an L3 first-try correct answer only in core lessons by default', () => {
    expect(lessonPassRule(config, 'core').minLevel3Correct).toBe(1);
    expect(lessonPassRule(config, 'standard').minLevel3Correct).toBe(0);
    expect(lessonPassRule(config, 'core', { minLevel3Correct: 2 }).minLevel3Correct).toBe(2);
  });
});

describe('seeded RNG', () => {
  it('is deterministic per seed and in [0, 1)', () => {
    const a = createRng('set-01');
    const b = createRng('set-01');
    const c = createRng('set-02');
    const xs = Array.from({ length: 100 }, () => a());
    expect(Array.from({ length: 100 }, () => b())).toEqual(xs);
    expect(Array.from({ length: 100 }, () => c())).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('gives order-independent tie-break keys', () => {
    expect(tieBreakKeys('s', ['b', 'a', 'c'])).toEqual(tieBreakKeys('s', ['c', 'b', 'a']));
  });
});
