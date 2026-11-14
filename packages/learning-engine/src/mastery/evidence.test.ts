import { describe, expect, it } from 'vitest';
import { defaultEngineConfig as config } from '../config.ts';
import { resolveVariantGroupKey } from '../exercise.ts';
import { attempt, exercise, Learner, T0 } from '../test/fixtures.ts';
import type { AttemptBreakdown } from './apply.ts';
import { computeEvidence, observationOf } from './evidence.ts';
import { updateScore } from './update.ts';
import type { EvidenceFact } from '../types.ts';
import { DAY_MS } from '../util/time.ts';

const primary = { conceptId: 'c.main', weight: 1, isPrimary: true } as const;

function weightOf(
  at: Parameters<typeof attempt>[0],
  ex = exercise(),
  history: EvidenceFact[] = [],
) {
  return computeEvidence(config, {
    attempt: attempt(at),
    exercise: ex,
    tag: primary,
    history,
    now: T0,
  });
}

function fact(overrides: Partial<EvidenceFact>): EvidenceFact {
  return {
    attemptId: 'old',
    at: T0 - DAY_MS,
    exerciseId: 'tpl@1',
    exerciseType: 'predict_output',
    difficulty: 2,
    variantGroupKey: 'tpl',
    isPrimary: true,
    correct: true,
    credit: 1,
    unassisted: true,
    setKind: 'lesson',
    weight: 1,
    ...overrides,
  };
}

describe('observationOf', () => {
  it('maps outcomes to o', () => {
    expect(observationOf({ outcome: 'correct', score: 0.2 })).toBe(1);
    expect(observationOf({ outcome: 'partial', score: 0.6 })).toBe(0.6);
    expect(observationOf({ outcome: 'partial', score: 1.4 })).toBe(1);
    expect(observationOf({ outcome: 'incorrect', score: 1 })).toBe(0);
    expect(observationOf({ outcome: 'error', score: 1 })).toBe(0);
  });
});

describe('resolveVariantGroupKey', () => {
  it('prefers variant_group, then template ID, then exercise ID', () => {
    expect(resolveVariantGroupKey({ id: 'a.b', variantGroup: 'g', templateId: 't' })).toBe('g');
    expect(resolveVariantGroupKey({ id: 'a.t.x@a91f2c', templateId: 'a.t.x' })).toBe('a.t.x');
    expect(resolveVariantGroupKey({ id: 'a.t.x@a91f2c' })).toBe('a.t.x');
    expect(resolveVariantGroupKey({ id: 'a.b', variantGroup: null })).toBe('a.b');
  });
});

describe('computeEvidence factor tables', () => {
  it('applies type categories and the true_false override', () => {
    expect(
      weightOf({}, exercise({ category: 'recognition', type: 'mcq_single' })).factors.type.value,
    ).toBe(0.7);
    expect(
      weightOf(
        {},
        exercise({ category: 'recognition', type: 'true_false', typeWeightOverride: 0.5 }),
      ).factors.type.value,
    ).toBe(0.5);
    expect(weightOf({}, exercise({ category: 'production' })).factors.type.value).toBe(1.3);
  });

  it('applies L1–L5 difficulty weights', () => {
    const values = ([1, 2, 3, 4, 5] as const).map(
      (difficulty) => weightOf({}, exercise({ difficulty })).factors.difficulty.value,
    );
    expect(values).toEqual([0.6, 0.8, 1.0, 1.2, 1.4]);
  });

  it('uses different try weights for correct and incorrect answers', () => {
    const tries = [1, 2, 3, 7].map((attemptInItem) => [
      weightOf({ attemptInItem }).factors.try.value,
      weightOf({ attemptInItem, outcome: 'incorrect', score: 0 }).factors.try.value,
    ]);
    expect(tries).toEqual([
      [1, 1],
      [0.7, 0.6],
      [0.5, 0.4],
      [0.5, 0.4],
    ]);
  });

  it('weakens correct answers after hints, solution and tutor', () => {
    expect(
      ([0, 1, 2, 3] as const).map((h) => weightOf({ hintLevelMax: h }).factors.hint.value),
    ).toEqual([1, 0.8, 0.55, 0.3]);
    expect(weightOf({ solutionViewed: true, hintLevelMax: 3 }).factors.hint.value).toBe(0.1);
    expect(weightOf({ hintLevelMax: 1, tutorAssisted: true }).factors.hint.value).toBeCloseTo(0.64);
    const wrong = { outcome: 'incorrect', score: 0 } as const;
    expect(weightOf({ ...wrong, hintLevelMax: 3 }).factors.hint.value).toBe(1);
    expect(weightOf({ ...wrong, solutionViewed: true }).factors.hint.value).toBe(0.5);
    expect(weightOf({ ...wrong, tutorAssisted: true }).factors.hint.value).toBe(1);
  });

  it('applies confidence weights per branch, neutral when not asked', () => {
    const wrong = { outcome: 'incorrect', score: 0 } as const;
    const rows = (['sure', 'unsure', 'guess', null] as const).map((confidence) => [
      weightOf({ confidence }).factors.confidence.value,
      weightOf({ ...wrong, confidence }).factors.confidence.value,
    ]);
    expect(rows).toEqual([
      [1, 1.2],
      [0.85, 1],
      [0.5, 0.7],
      [0.9, 1],
    ]);
  });

  it('applies W_time to slow correct production answers only', () => {
    const prod = exercise({ category: 'production', estimatedSeconds: 100 });
    expect(weightOf({ activeMs: 300_000 }, prod).factors.time.value).toBe(1);
    expect(weightOf({ activeMs: 300_001 }, prod).factors.time.value).toBe(0.85);
    expect(
      weightOf({ activeMs: 300_001, outcome: 'incorrect', score: 0 }, prod).factors.time.value,
    ).toBe(1);
    expect(
      weightOf({ activeMs: 999_999 }, exercise({ estimatedSeconds: 100 })).factors.time.value,
    ).toBe(1);
  });

  it('applies W_ctx 1.2 to correct assessment answers only', () => {
    expect(weightOf({ setKind: 'assessment' }).factors.context.value).toBe(1.2);
    expect(
      weightOf({ setKind: 'assessment', outcome: 'incorrect', score: 0 }).factors.context.value,
    ).toBe(1);
    expect(weightOf({ setKind: 'review' }).factors.context.value).toBe(1);
    expect(weightOf({ setKind: null }).factors.context.value).toBe(1);
  });

  it('halves wrong answers on secondary concepts unless a misconception points there', () => {
    const tag = { conceptId: 'c.side', weight: 0.4, isPrimary: false } as const;
    const ex = exercise({ concepts: [primary, tag] });
    const wrong = attempt({ outcome: 'incorrect', score: 0 });
    const plain = computeEvidence(config, {
      attempt: wrong,
      exercise: ex,
      tag,
      history: [],
      now: T0,
    });
    expect(plain.weight).toBeCloseTo(0.4 * 0.8 * 1.2 * 0.5);
    const pointed = computeEvidence(config, {
      attempt: { ...wrong, misconceptionConceptIds: ['c.side'] },
      exercise: ex,
      tag,
      history: [],
      now: T0,
    });
    expect(pointed.weight).toBeCloseTo(0.4 * 0.8 * 1.2);
  });
});

describe('W_rep (variant group repetition)', () => {
  const ex = exercise({ id: 'tpl@9', variantGroupKey: 'tpl' });

  it('decays 1.0 → 0.5 → 0.25 by k inside 14 days', () => {
    expect(weightOf({}, ex, []).factors.repetition.value).toBe(1);
    expect(weightOf({}, ex, [fact({})]).factors.repetition.value).toBe(0.5);
    expect(weightOf({}, ex, [fact({}), fact({ attemptId: 'o2' })]).factors.repetition.value).toBe(
      0.25,
    );
    expect(
      weightOf({}, ex, [fact({}), fact({ attemptId: 'o2' }), fact({ attemptId: 'o3' })]).factors
        .repetition.value,
    ).toBe(0.25);
  });

  it('ignores other groups, wrong answers and the window edge (exactly 14 days)', () => {
    expect(weightOf({}, ex, [fact({ variantGroupKey: 'other' })]).factors.repetition.value).toBe(1);
    expect(weightOf({}, ex, [fact({ correct: false })]).factors.repetition.value).toBe(1);
    expect(weightOf({}, ex, [fact({ at: T0 - 14 * DAY_MS })]).factors.repetition.value).toBe(1);
    expect(weightOf({}, ex, [fact({ at: T0 - 14 * DAY_MS + 1 })]).factors.repetition.value).toBe(
      0.5,
    );
  });

  it('does not apply to wrong answers', () => {
    expect(
      weightOf({ outcome: 'incorrect', score: 0 }, ex, [fact({}), fact({ attemptId: 'x' })]).factors
        .repetition.value,
    ).toBe(1);
  });
});

describe('updateScore', () => {
  it('caps the step at STEP_MAX and stays in 0–100', () => {
    expect(updateScore(config, 50, 1, 10)).toEqual({ step: 0.5, score: 75 });
    expect(updateScore(config, 0, 1, 4).score).toBe(50);
    expect(updateScore(config, 100, 0, 1).score).toBe(75);
  });
});

describe('worked example in learning-engine.md (js.fn.arrow-this)', () => {
  it('reproduces the six-attempt table', () => {
    const learner = new Learner('c.main');
    const side = exercise({
      difficulty: 2,
      concepts: [
        { conceptId: 'c.other', weight: 1, isPrimary: true },
        { conceptId: 'c.main', weight: 0.4, isPrimary: false },
      ],
    });
    const l3 = exercise({ difficulty: 3 });
    const steps: [ReturnType<typeof exercise>, Parameters<typeof attempt>[0], number, number][] = [
      [exercise({ difficulty: 1, type: 'mcq_single', category: 'recognition' }), {}, 0.42, 10.5],
      [exercise({ difficulty: 2 }), { confidence: 'unsure' }, 0.68, 25.7],
      [l3, { outcome: 'incorrect', score: 0 }, 1.2, 18.0],
      [l3, { attemptInItem: 2, hintLevelMax: 1, confidence: 'unsure' }, 0.476, 27.8],
      [exercise({ difficulty: 3, type: 'fix_bug', category: 'production' }), {}, 1.3, 51.3],
      [side, {}, 0.32, 55.2],
    ];
    for (const [ex, at, weight, score] of steps) {
      const effects = learner.answer(ex, at);
      const record = effects.evidence.find((e) => e.conceptId === 'c.main' && e.kind === 'attempt');
      const breakdown = record?.breakdown as AttemptBreakdown;
      expect(breakdown.weight).toBeCloseTo(weight, 6);
      // The doc rounds every intermediate score to one decimal.
      expect(Math.abs(learner.state.mastery.score - score)).toBeLessThan(0.1);
    }
  });
});
