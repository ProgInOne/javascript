/** Property-based invariants from learning-engine.md#테스트. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { exercise, deps, Learner, reviewedMemory, T0 } from '../test/fixtures.ts';
import { DAY_MS } from '../util/time.ts';
import { effectiveMastery } from './effective.ts';
import { stageIndex } from './stage.ts';

const attemptArb = fc.record({
  outcome: fc.constantFrom('correct', 'partial', 'incorrect', 'error'),
  score: fc.double({ min: 0, max: 1, noNaN: true }),
  confidence: fc.constantFrom('sure', 'unsure', 'guess', null),
  hintLevelMax: fc.constantFrom(0, 1, 2, 3),
  solutionViewed: fc.boolean(),
  tutorAssisted: fc.boolean(),
  attemptInItem: fc.integer({ min: 1, max: 5 }),
  activeMs: fc.integer({ min: 0, max: 3_600_000 }),
  setKind: fc.constantFrom('lesson', 'review', 'assessment', null),
  dayOffset: fc.integer({ min: 0, max: 40 }),
  difficulty: fc.constantFrom(1, 2, 3, 4, 5),
  category: fc.constantFrom('recognition', 'recall', 'production'),
  group: fc.constantFrom('g1', 'g2', 'g3', 'g4'),
  primary: fc.boolean(),
});

describe('mastery invariants', () => {
  it('keeps 0 ≤ score ≤ 100, monotone per outcome, and at most one stage up per attempt', () => {
    fc.assert(
      fc.property(fc.array(attemptArb, { minLength: 1, maxLength: 40 }), (attempts) => {
        const learner = new Learner();
        let day = 0;
        for (const a of attempts) {
          const { dayOffset, difficulty, category, group, primary, ...facts } = a;
          day += dayOffset;
          const before = learner.state.mastery;
          learner.answer(
            exercise({
              difficulty,
              category,
              variantGroupKey: group,
              concepts: primary
                ? [{ conceptId: 'c.main', weight: 1, isPrimary: true }]
                : [
                    { conceptId: 'c.x', weight: 1, isPrimary: true },
                    { conceptId: 'c.main', weight: 0.4, isPrimary: false },
                  ],
            }),
            { ...facts, submittedAt: T0 + day * DAY_MS },
          );
          const after = learner.state.mastery;
          expect(after.score).toBeGreaterThanOrEqual(0);
          expect(after.score).toBeLessThanOrEqual(100);
          const o = facts.outcome === 'correct' ? 1 : facts.outcome === 'partial' ? facts.score : 0;
          if (o === 1) expect(after.score).toBeGreaterThanOrEqual(before.score);
          if (o === 0) expect(after.score).toBeLessThanOrEqual(before.score);
          expect(stageIndex(after.stage) - stageIndex(before.stage)).toBeLessThanOrEqual(1);
        }
      }),
      { seed: 20261114, numRuns: 200 },
    );
  });

  it('keeps decay within 0.6–1.0', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: 0.01, max: 400, noNaN: true }),
        fc.double({ min: 0, max: 800, noNaN: true }),
        (score, stability, elapsedDays) => {
          const eff = effectiveMastery(
            deps,
            score,
            reviewedMemory('c', T0, stability),
            T0 + elapsedDays * DAY_MS,
          );
          expect(eff.decay).toBeGreaterThanOrEqual(0.6);
          expect(eff.decay).toBeLessThanOrEqual(1);
          expect(eff.effective).toBeLessThanOrEqual(score + 1e-9);
        },
      ),
      { seed: 20261114, numRuns: 300 },
    );
  });
});
