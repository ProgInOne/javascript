/**
 * Scenarios from learning-engine.md#테스트 for the mastery model (v0.1 scope).
 * FSRS-side scenarios (9, 10, 12, 22) live in memory/*.test.ts; set composition (14–17, 23) in
 * practice/*.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { ratingForAttempt } from '../memory/rating.ts';
import { attempt, deps, exercise, Learner, reviewedMemory, SEOUL, T0 } from '../test/fixtures.ts';
import type { ReviewFact } from '../types.ts';
import { DAY_MS } from '../util/time.ts';
import type { AttemptBreakdown, AttemptEffects, StageGateBreakdown } from './apply.ts';
import { reevaluateStage } from './apply.ts';
import { effectiveMastery } from './effective.ts';

function breakdownOf(effects: AttemptEffects, conceptId = 'c.main'): AttemptBreakdown {
  const record = effects.evidence.find((e) => e.conceptId === conceptId && e.kind === 'attempt');
  if (record === undefined) throw new Error('no evidence');
  return record.breakdown as AttemptBreakdown;
}

function lastEffects(learner: Learner): AttemptEffects {
  const effects = learner.effects.at(-1);
  if (effects === undefined) throw new Error('no attempt yet');
  return effects;
}

/** Scenario 1 state: five L2 first-try correct answers, distinct exercises. */
function fiveL2(learner = new Learner()): Learner {
  for (let i = 0; i < 5; i++) learner.answer(exercise({ difficulty: 2 }));
  return learner;
}

/** A proficient learner with a high score (≈ 90). */
function proficientLearner(): Learner {
  const learner = fiveL2();
  learner.answer(exercise({ difficulty: 3, type: 'fix_bug', category: 'production' }));
  for (let i = 0; i < 3; i++) learner.answer(exercise({ difficulty: 3 }));
  expect(learner.state.mastery.stage).toBe('proficient');
  return learner;
}

describe('scenario 1: five L2 first-try correct answers', () => {
  it('reaches the EWMA value, practicing, but not proficient (no L3, one type)', () => {
    const learner = fiveL2();
    expect(learner.state.mastery.score).toBeCloseTo(100 * (1 - (1 - 0.2) ** 5), 6);
    expect(learner.state.mastery.stage).toBe('practicing');
    const last = breakdownOf(lastEffects(learner));
    expect(last.gates.proficient?.missing.map((m) => m.gate)).toEqual([
      'effective',
      'distinct_types',
      'level3_correct',
    ]);
  });

  it('moves one stage per attempt (introduced, then practicing)', () => {
    const learner = new Learner();
    learner.answer(exercise());
    expect(learner.state.mastery.stage).toBe('introduced');
    learner.answer(exercise());
    expect(learner.state.mastery.stage).toBe('practicing');
  });
});

describe('scenario 2: then an L3 production answer and another type', () => {
  it('enters proficient and records the gate', () => {
    const learner = fiveL2();
    const effects = learner.answer(
      exercise({ difficulty: 3, type: 'fix_bug', category: 'production' }),
    );
    learner.answer(exercise({ difficulty: 2, type: 'mcq_single', category: 'recognition' }));
    expect(learner.state.mastery.stage).toBe('proficient');
    expect(learner.state.mastery.distinctTypesCorrect).toEqual([
      'predict_output',
      'fix_bug',
      'mcq_single',
    ]);
    const gate = effects.evidence.find((e) => e.kind === 'stage_gate');
    expect(gate?.stageBefore).toBe('practicing');
    expect(gate?.stageAfter).toBe('proficient');
    const breakdown = gate?.breakdown as StageGateBreakdown;
    expect(breakdown.reason).toBe('promoted');
    expect(breakdown.gates?.proficient).toEqual({ met: true, missing: [] });
  });
});

describe('scenario 3: three correct guesses', () => {
  it('weighs 0.5 of a sure answer and rates hard', () => {
    const guessed = new Learner();
    const sure = new Learner();
    for (let i = 0; i < 3; i++) {
      const ex = exercise();
      const g = breakdownOf(guessed.answer(ex, { confidence: 'guess' }));
      const s = breakdownOf(sure.answer(ex, { confidence: 'sure' }));
      expect(g.weight / s.weight).toBeCloseTo(0.5, 10);
      expect(guessed.effects.at(-1)?.pendingRatings[0]?.rating).toBe('hard');
    }
    expect(guessed.state.mastery.score).toBeLessThan(sure.state.mastery.score);
  });
});

describe('scenario 4: correct after hint level 3', () => {
  it('has hint weight 0.3 and rating again', () => {
    const effects = new Learner().answer(exercise(), { hintLevelMax: 3 });
    expect(breakdownOf(effects).factors.hint.value).toBe(0.3);
    expect(effects.pendingRatings[0]?.rating).toBe('again');
  });
});

describe('scenario 5: correct after viewing the solution', () => {
  it('has hint weight 0.1 and rating again', () => {
    const effects = new Learner().answer(exercise(), { solutionViewed: true });
    expect(breakdownOf(effects).factors.hint.value).toBe(0.1);
    expect(effects.pendingRatings[0]?.rating).toBe('again');
  });
});

describe('scenario 11: 60 days without review', () => {
  it('lowers effective, keeps the stage and flags needsReview', () => {
    const learner = proficientLearner();
    const score = learner.state.mastery.score;
    learner.withMemory(reviewedMemory('c.main', T0, 1));
    const later = T0 + 60 * DAY_MS;
    const eff = effectiveMastery(deps, score, learner.state.memory, later);
    expect(eff.effective).toBeLessThan(60);
    expect(eff.decay).toBeGreaterThanOrEqual(0.6);
    expect(eff.needsReview).toBe(true);
    // Time alone never demotes, and neither does a correct answer.
    expect(reevaluateStage(deps, learner.state, later, SEOUL).update).toBeNull();
    learner.answer(exercise({ difficulty: 3 }), { submittedAt: later });
    expect(learner.state.mastery.stage).toBe('proficient');
    // A wrong answer that leaves effective below 60 demotes one step.
    learner.answer(exercise({ difficulty: 3 }), {
      submittedAt: later,
      outcome: 'incorrect',
      score: 0,
    });
    expect(learner.state.mastery.stage).toBe('practicing');
  });

  it('decay matches the doc table', () => {
    const at = (r: number) =>
      effectiveMastery(
        { ...deps, fsrs: { ...deps.fsrs, retrievability: () => r } },
        100,
        reviewedMemory('c', T0, 1),
        T0,
      ).decay;
    expect(at(0.95)).toBe(1);
    expect(at(0.72)).toBeCloseTo(0.92, 10);
    expect(at(0.45)).toBeCloseTo(0.8, 10);
    expect(at(0)).toBe(0.6);
  });
});

describe('scenario 13: many correct answers tagged only as a secondary concept', () => {
  it('raises the secondary score without meeting the proficient gate', () => {
    const learner = new Learner('c.side');
    for (let i = 0; i < 25; i++) {
      learner.answer(
        exercise({
          difficulty: i % 2 === 0 ? 3 : 4,
          type: i % 3 === 0 ? 'fix_bug' : 'predict_output',
          category: i % 3 === 0 ? 'production' : 'recall',
          concepts: [
            { conceptId: 'c.main', weight: 1, isPrimary: true },
            { conceptId: 'c.side', weight: 0.5, isPrimary: false },
          ],
        }),
      );
    }
    const m = learner.state.mastery;
    expect(m.score).toBeGreaterThan(70);
    expect(m.stage).toBe('practicing');
    expect(
      learner.effects.every((e) => e.pendingRatings.every((p) => p.conceptId === 'c.main')),
    ).toBe(true);
    const gates = breakdownOf(lastEffects(learner), 'c.side').gates.proficient;
    expect(gates?.missing.map((x) => x.gate)).toEqual([
      'distinct_types',
      'distinct_variant_groups',
      'level3_correct',
    ]);
  });
});

describe('scenario 13a: same template, five correct answers in a day', () => {
  it('applies W_rep 1, 0.5, 0.25, 0.25, 0.25 and counts one variant group', () => {
    const learner = new Learner();
    const reps = [0, 1, 2, 3, 4].map((i) => {
      const ex = exercise({ id: `tpl@${i}`, variantGroupKey: 'tpl', difficulty: 3 });
      return breakdownOf(learner.answer(ex, { submittedAt: T0 + i * 60_000 })).factors.repetition
        .value;
    });
    expect(reps).toEqual([1, 0.5, 0.25, 0.25, 0.25]);
    expect(learner.state.mastery.stage).not.toBe('proficient');
    const missing = breakdownOf(lastEffects(learner)).gates.proficient?.missing;
    expect(missing).toContainEqual({ gate: 'distinct_variant_groups', required: 3, actual: 1 });
  });
});

describe('scenario 13b: same template, 15 days apart', () => {
  it('gives the second correct answer W_rep 1.0', () => {
    const learner = new Learner();
    learner.answer(exercise({ id: 'tpl@1', variantGroupKey: 'tpl' }));
    const second = learner.answer(exercise({ id: 'tpl@2', variantGroupKey: 'tpl' }), {
      submittedAt: T0 + 15 * DAY_MS,
    });
    expect(breakdownOf(second).factors.repetition).toEqual({ value: 1, why: 'k=0' });
  });
});

describe('scenario 13c: L3 first-try correct in a unit assessment', () => {
  it('applies W_ctx 1.2 and records independent application evidence', () => {
    const learner = proficientLearner();
    const effects = learner.answer(exercise({ difficulty: 3 }), {
      setKind: 'assessment',
      confidence: null,
    });
    const breakdown = breakdownOf(effects);
    expect(breakdown.factors.context).toEqual({ value: 1.2, why: 'assessment' });
    expect(breakdown.fact).toMatchObject({
      setKind: 'assessment',
      unassisted: true,
      correct: true,
    });
    expect(breakdown.gates.mastered?.missing.map((m) => m.gate)).not.toContain(
      'independent_application',
    );
  });
});

const day = (n: number) => T0 + n * DAY_MS;
const good = (n: number, groups: string[]): ReviewFact => ({
  reviewedAt: day(n),
  rating: 'good',
  variantGroupKeys: groups,
});

describe('scenario 13d: proficient with only one good review 7 days later', () => {
  it('does not reach mastered and reports the memory condition', () => {
    const learner = proficientLearner()
      .withReviews([good(0, ['g-a']), good(7, ['g-b'])])
      .withMemory(reviewedMemory('c.main', day(7), 10));
    const effects = learner.answer(exercise({ difficulty: 3 }), {
      setKind: 'assessment',
      submittedAt: day(7),
    });
    expect(learner.state.mastery.stage).toBe('proficient');
    expect(breakdownOf(effects).gates.mastered?.missing).toEqual([
      { gate: 'spaced_reviews', required: 2, actual: 1 },
    ]);
  });
});

describe('scenario 13e: two spaced good reviews (different groups) and an assessment answer', () => {
  it('enters mastered', () => {
    const learner = proficientLearner()
      .withReviews([good(0, ['g-a']), good(7, ['g-a']), good(21, ['g-b'])])
      .withMemory(reviewedMemory('c.main', day(21), 20));
    const effects = learner.answer(exercise({ difficulty: 3 }), {
      setKind: 'assessment',
      submittedAt: day(21),
    });
    expect(learner.state.mastery.stage).toBe('mastered');
    const gate = effects.evidence.find((e) => e.kind === 'stage_gate');
    expect((gate?.breakdown as StageGateBreakdown).gates?.mastered.met).toBe(true);
  });

  it('does not enter mastered when both spaced reviews come from the same variant group', () => {
    const learner = proficientLearner()
      .withReviews([good(0, ['g-a']), good(7, ['g-a']), good(14, ['g-a'])])
      .withMemory(reviewedMemory('c.main', day(14), 20));
    learner.answer(exercise({ difficulty: 3 }), { setKind: 'assessment', submittedAt: day(14) });
    expect(learner.state.mastery.stage).toBe('proficient');
  });

  it('can also be reached by re-evaluation after the review that completes the gate', () => {
    const learner = proficientLearner();
    learner.answer(exercise({ difficulty: 4 }));
    learner
      .withReviews([good(0, ['g-a']), good(7, ['g-a']), good(21, ['g-b'])])
      .withMemory(reviewedMemory('c.main', day(21), 20));
    const { update, evidence } = reevaluateStage(deps, learner.state, day(21), SEOUL);
    expect(update?.after.stage).toBe('mastered');
    expect(evidence?.kind).toBe('stage_gate');
  });
});

describe('consecutive failures and counters', () => {
  it('counts primary failures and resets on an unassisted correct answer', () => {
    const learner = new Learner();
    learner.answer(exercise(), { outcome: 'incorrect', score: 0 });
    learner.answer(exercise(), { outcome: 'error', score: 0 });
    expect(learner.state.mastery.consecutiveFailures).toBe(2);
    learner.answer(exercise(), { hintLevelMax: 1 });
    expect(learner.state.mastery.consecutiveFailures).toBe(2);
    learner.answer(exercise({ difficulty: 4 }));
    expect(learner.state.mastery.consecutiveFailures).toBe(0);
    expect(learner.state.mastery.maxDifficultyCorrect).toBe(4);
  });
});

describe('ratingForAttempt', () => {
  it('follows the table order', () => {
    const ex = exercise({ difficulty: 3, estimatedSeconds: 60 });
    expect(ratingForAttempt(attempt({ outcome: 'partial', score: 0.4 }), ex)).toBe('again');
    expect(ratingForAttempt(attempt({ outcome: 'partial', score: 0.8 }), ex)).toBe('hard');
    expect(ratingForAttempt(attempt({ attemptInItem: 2 }), ex)).toBe('hard');
    expect(ratingForAttempt(attempt({ tutorAssisted: true }), ex)).toBe('hard');
    expect(ratingForAttempt(attempt({ activeMs: 60_000 }), ex)).toBe('easy');
    expect(ratingForAttempt(attempt({ activeMs: 60_001 }), ex)).toBe('good');
    expect(ratingForAttempt(attempt({ confidence: 'unsure' }), ex)).toBe('good');
    expect(ratingForAttempt(attempt({}), exercise({ difficulty: 2 }))).toBe('good');
  });
});
