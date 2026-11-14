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
    ...overrides,
  };
}

const rule = lessonPassRule(config, 'core');

describe('evaluatePassRule', () => {
  it('passes a clean set', () => {
    const items = [item(), item({ type: 'fix_bug', difficulty: 3 }), item()];
    const result = evaluatePassRule(config, rule, { items, introducedScores: { a: 60, b: 50 } });
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
    const result = evaluatePassRule(config, rule, { items, introducedScores: { a: 80 } });
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
    const ok = evaluatePassRule(config, rule, { items, introducedScores: { a: 50 } });
    expect(ok.checks.minCorrect).toEqual({ met: true, required: 0.7, actual: 0.7 });
    expect(ok.checks.minDistinctTypes).toEqual({ met: true, required: 2, actual: 2 });
    expect(ok.checks.minLevel3Correct).toEqual({ met: true, required: 1, actual: 1 });
    expect(ok.passed).toBe(true);

    const low = evaluatePassRule(config, rule, { items, introducedScores: { a: 49.9, b: 70 } });
    expect(low.checks.minConceptScore).toEqual({
      met: false,
      required: 50,
      actual: 49.9,
      below: ['a'],
    });
    const pending = evaluatePassRule(config, rule, {
      items: [...items, item({ status: 'pending', finalAttempt: null })],
      introducedScores: { a: 90 },
    });
    expect(pending.checks.allAnswered).toBe(false);
    expect(pending.passed).toBe(false);
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
