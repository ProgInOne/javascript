import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineDeps } from '../config.ts';
import { defaultEngineConfig } from '../config.ts';
import type { StageGateBreakdown } from '../mastery/apply.ts';
import {
  deps as fakeDeps,
  exercise,
  Learner,
  reviewedMemory,
  SEOUL,
  T0,
} from '../test/fixtures.ts';
import type { ConceptState, FsrsRating } from '../types.ts';
import { DAY_MS, HOUR_MS } from '../util/time.ts';
import { conceptsReadyToFlush, flushPendingRatings } from './flush.ts';
import { createTsFsrsPort } from './fsrs-adapter.ts';
import type { PendingRating } from './rating.ts';

let realDeps: EngineDeps;
beforeAll(async () => {
  realDeps = {
    config: defaultEngineConfig,
    fsrs: await createTsFsrsPort(defaultEngineConfig.fsrs),
  };
});

function pending(rating: FsrsRating, at = T0, group = 'g-a', conceptId = 'c.main'): PendingRating {
  return { conceptId, rating, attemptId: `${rating}-${at}-${group}`, variantGroupKey: group, at };
}

function practicedState(memory: ConceptState['memory'] = null): ConceptState {
  const learner = new Learner();
  for (let i = 0; i < 3; i++) learner.answer(exercise());
  return { ...learner.state, memory };
}

describe.each([
  ['fake FSRS', () => fakeDeps],
  ['ts-fsrs', () => realDeps],
] as const)('flushPendingRatings with %s', (_name, getDeps) => {
  it('creates the card on the first rating and logs the review', () => {
    const deps = getDeps();
    const result = flushPendingRatings(deps, {
      pending: [pending('good')],
      concepts: [practicedState()],
      now: T0,
      dayBoundary: SEOUL,
    });
    expect(result.memory).toHaveLength(1);
    expect(result.memory[0]).toMatchObject({
      conceptId: 'c.main',
      fsrsVersion: deps.fsrs.modelVersion,
      suspended: false,
    });
    expect(result.memory[0]?.card.reps).toBe(1);
    expect(result.reviewLogs[0]).toMatchObject({
      rating: 'good',
      stateBefore: 'new',
      retrievabilityBefore: null,
      sourceVariantGroupKeys: ['g-a'],
      reviewedAt: T0,
    });
  });

  it('scenario 9: same-day pending good, good, hard → one hard review', () => {
    const deps = getDeps();
    const state = practicedState();
    const result = flushPendingRatings(deps, {
      pending: [
        pending('good', T0),
        pending('good', T0 + 1, 'g-b'),
        pending('hard', T0 + 2, 'g-c'),
      ],
      concepts: [state],
      now: T0 + 3,
      dayBoundary: SEOUL,
    });
    expect(result.reviewLogs).toHaveLength(1);
    expect(result.reviewLogs[0]?.rating).toBe('hard');
    expect(result.reviewLogs[0]?.sourceAttemptIds).toHaveLength(3);
    expect(result.memory[0]?.card.reps).toBe(1);
    // A later flush on the same local day does not apply another non-again rating.
    const again = flushPendingRatings(deps, {
      pending: [pending('good', T0 + HOUR_MS)],
      concepts: [{ ...state, memory: result.memory[0] ?? null }],
      now: T0 + HOUR_MS,
      dayBoundary: SEOUL,
    });
    expect(again.reviewLogs).toHaveLength(0);
    expect(again.skipped).toEqual([
      {
        conceptId: 'c.main',
        rating: 'good',
        sourceAttemptIds: [`good-${T0 + HOUR_MS}-g-a`],
        reason: 'already_reviewed_today',
      },
    ]);
  });

  it('scenario 10: again on a concept already reviewed today is applied', () => {
    const deps = getDeps();
    const state = practicedState();
    const first = flushPendingRatings(deps, {
      pending: [pending('good')],
      concepts: [state],
      now: T0,
      dayBoundary: SEOUL,
    });
    const second = flushPendingRatings(deps, {
      pending: [pending('again', T0 + HOUR_MS)],
      concepts: [{ ...state, memory: first.memory[0] ?? null }],
      now: T0 + 2 * HOUR_MS,
      dayBoundary: SEOUL,
    });
    expect(second.skipped).toEqual([]);
    expect(second.reviewLogs[0]?.rating).toBe('again');
    expect(second.memory[0]?.card.reps).toBe(2);
  });

  it('treats the hours before 04:00 as the previous day', () => {
    const deps = getDeps();
    // T0 = 10:00 KST. 03:30 KST next calendar day is still the same learner day; 04:30 is not.
    const sameDay = T0 + 17.5 * HOUR_MS;
    const nextDay = T0 + 18.5 * HOUR_MS;
    const state = practicedState();
    const first = flushPendingRatings(deps, {
      pending: [pending('good')],
      concepts: [state],
      now: T0,
      dayBoundary: SEOUL,
    });
    const withMemory = { ...state, memory: first.memory[0] ?? null };
    expect(
      flushPendingRatings(deps, {
        pending: [pending('good', sameDay)],
        concepts: [withMemory],
        now: sameDay,
        dayBoundary: SEOUL,
      }).skipped,
    ).toHaveLength(1);
    expect(
      flushPendingRatings(deps, {
        pending: [pending('good', nextDay)],
        concepts: [withMemory],
        now: nextDay,
        dayBoundary: SEOUL,
      }).reviewLogs,
    ).toHaveLength(1);
  });

  it('never changes the mastery score', () => {
    const deps = getDeps();
    const state = practicedState();
    const result = flushPendingRatings(deps, {
      pending: [pending('again')],
      concepts: [state],
      now: T0,
      dayBoundary: SEOUL,
    });
    for (const update of result.mastery) expect(update.after.score).toBe(state.mastery.score);
  });
});

describe('stage changes after reviews', () => {
  function masteredState(): ConceptState {
    return {
      mastery: {
        conceptId: 'c.main',
        score: 95,
        stage: 'mastered',
        evidenceWeightSum: 10,
        distinctTypesCorrect: ['predict_output', 'fix_bug'],
        maxDifficultyCorrect: 4,
        consecutiveFailures: 0,
        lastAttemptAt: T0,
        stageChangedAt: T0,
      },
      history: [],
      reviews: [],
      memory: reviewedMemory('c.main', T0 - 10 * DAY_MS, 10),
    };
  }

  it('scenario 12: again on a mastered concept demotes to proficient immediately', () => {
    const result = flushPendingRatings(fakeDeps, {
      pending: [pending('again')],
      concepts: [masteredState()],
      now: T0,
      dayBoundary: SEOUL,
    });
    expect(result.mastery[0]?.after.stage).toBe('proficient');
    expect(result.mastery[0]?.after.score).toBe(95);
    const record = result.evidence[0];
    expect(record).toMatchObject({
      kind: 'stage_gate',
      stageBefore: 'mastered',
      stageAfter: 'proficient',
      attemptId: null,
    });
    expect((record?.breakdown as StageGateBreakdown).reason).toBe('demoted_again');
  });

  it('scenario 13e via review: the second spaced good review completes the mastered gate', () => {
    const learner = new Learner();
    for (let i = 0; i < 5; i++) learner.answer(exercise());
    learner.answer(exercise({ difficulty: 3, type: 'fix_bug', category: 'production' }));
    for (let i = 0; i < 3; i++) learner.answer(exercise({ difficulty: 3 }));
    learner.answer(exercise({ difficulty: 3 }), { setKind: 'assessment' });
    expect(learner.state.mastery.stage).toBe('proficient');
    const state: ConceptState = {
      ...learner.state,
      reviews: [
        { reviewedAt: T0, rating: 'good', variantGroupKeys: ['g-a'] },
        { reviewedAt: T0 + 7 * DAY_MS, rating: 'good', variantGroupKeys: ['g-a'] },
      ],
      memory: reviewedMemory('c.main', T0 + 7 * DAY_MS, 14),
    };
    const result = flushPendingRatings(fakeDeps, {
      pending: [pending('good', T0 + 21 * DAY_MS, 'g-b')],
      concepts: [state],
      now: T0 + 21 * DAY_MS,
      dayBoundary: SEOUL,
    });
    expect(result.mastery[0]?.after.stage).toBe('mastered');
    expect(result.evidence[0]?.kind).toBe('stage_gate');
  });
});

describe('conceptsReadyToFlush', () => {
  it('returns concepts with no remaining items, or all when the set is finished', () => {
    const list = [
      pending('good', T0, 'g', 'c.b'),
      pending('good', T0, 'g', 'c.a'),
      pending('hard', T0, 'h', 'c.a'),
    ];
    expect(
      conceptsReadyToFlush({ pending: list, remainingItemConcepts: ['c.b'], setFinished: false }),
    ).toEqual(['c.a']);
    expect(
      conceptsReadyToFlush({ pending: list, remainingItemConcepts: ['c.b'], setFinished: true }),
    ).toEqual(['c.a', 'c.b']);
  });
});
