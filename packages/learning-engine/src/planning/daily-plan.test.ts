/**
 * Today's plan (learning-engine.md#오늘의-학습-구성-builddailyplan).
 */
import { describe, expect, it } from 'vitest';
import type { ReviewQueueEntry } from '../memory/review-queue.ts';
import type { WeakConceptEntry } from '../practice/weakness-set.ts';
import { deps } from '../test/fixtures.ts';
import type { DailyPlanInput } from './daily-plan.ts';
import { buildDailyPlan } from './daily-plan.ts';
import type { LessonEstimate, PaceResult } from './pace.ts';

const MIN = 60_000;

function review(id: string, seconds: number, overdue = false): ReviewQueueEntry {
  return {
    conceptId: id,
    priority: 1,
    factors: { overdueRatio: 1, importanceFactor: 1, misconceptionFactor: 1 },
    dueAt: 0,
    overdue,
    overdueDays: overdue ? 2 : 0,
    itemCount: 1,
    estimatedSeconds: seconds,
  };
}

function lesson(
  id: string,
  minutes: number,
  overrides: Partial<LessonEstimate> = {},
): LessonEstimate {
  return {
    lessonId: id,
    estimatedMinutes: minutes,
    readMinutes: minutes / 2,
    status: 'not_started',
    readProgress: 0,
    practiceProgress: 0,
    ...overrides,
  };
}

function weak(id: string, effective: number): WeakConceptEntry {
  return {
    conceptId: id,
    weakness: 100 - effective,
    effective,
    stage: 'practicing',
    factors: {
      gap: 100 - effective,
      importanceFactor: 1,
      misconceptionFactor: 1,
      failureFactor: 1,
    },
    confirmedMisconceptions: 0,
    suspectedMisconceptions: 0,
    consecutiveFailures: 0,
  };
}

function plan(overrides: Partial<DailyPlanInput> = {}) {
  return buildDailyPlan(deps, {
    goal: { dailyMinutes: 30, weeklyDays: 5, targetCourseId: null, targetDate: null },
    todayActiveMs: 0,
    reviewQueue: [],
    continueLesson: null,
    nextLesson: null,
    weakConcepts: [],
    pace: null,
    firstRun: false,
    ...overrides,
  });
}

const pace = (status: PaceResult['status']): PaceResult => ({
  status,
  targetDate: '2026-04-01',
  remainingMinutes: 300,
  studyDaysLeft: 20,
  requiredPerDay: 15,
  newLearningBudget: 18,
  suggestedDailyMinutes: 25,
  suggestedTargetDate: '2026-04-01',
  calibration: 1,
});

describe('buildDailyPlan', () => {
  it('first run: only the first lesson', () => {
    const p = plan({ firstRun: true, nextLesson: lesson('l1', 25), weakConcepts: [weak('c', 0)] });
    expect(p.blocks).toEqual([
      {
        kind: 'new_lesson',
        minutes: 25,
        reason: { code: 'new_lesson', why: 'first_lesson' },
        conceptIds: [],
        lessonId: 'l1',
        partial: false,
      },
    ]);
    expect(p).toMatchObject({ budgetMinutes: 30, mode: 'plan', goalMet: false, later: [] });
  });

  it('orders review → continue → weakness within the budget, the rest goes to later', () => {
    const p = plan({
      reviewQueue: [review('a', 180, true), review('b', 180), review('c', 180), review('d', 900)],
      continueLesson: lesson('l1', 20, { status: 'reading', readProgress: 0.5 }), // 15 minutes left
      weakConcepts: [weak('w1', 40), weak('w2', 50), weak('w3', 70)],
    });
    // Review cap 15 minutes: a, b, c (9 minutes); d does not fit.
    expect(p.blocks.map((b) => [b.kind, b.minutes, b.conceptIds, b.lessonId])).toEqual([
      ['review', 9, ['a', 'b', 'c'], null],
      ['continue', 15, [], 'l1'],
    ]);
    expect(p.blocks[0]?.reason).toEqual({ code: 'reviews_due', count: 3, overdueCount: 1 });
    // 6 minutes left: not enough for weakness practice (8).
    expect(p.later.map((b) => [b.kind, b.conceptIds])).toEqual([
      ['review', ['d']],
      ['weakness', ['w1', 'w2']],
    ]);
    expect(p.reviewCapMinutes).toBe(15);
  });

  it('allows 60% for reviews when 3 days of reviews are overdue', () => {
    const backlog = Array.from({ length: 16 }, (_, i) => review(`r${i}`, 180, true));
    const p = plan({ reviewQueue: backlog });
    // 16 × 3 = 48 overdue minutes ≥ 3 × 15: cap 18 minutes → 6 reviews.
    expect(p.reviewCapMinutes).toBe(18);
    expect(p.blocks[0]?.conceptIds).toHaveLength(6);
  });

  it('adds a new lesson when the pace is behind, and plans a long lesson in part', () => {
    const p = plan({
      continueLesson: lesson('l1', 10, { status: 'practicing', readProgress: 1 }), // 5 left
      nextLesson: lesson('l2', 40),
      pace: pace('behind'),
    });
    expect(p.blocks.map((b) => [b.kind, b.minutes, b.partial, b.reason])).toEqual([
      ['continue', 5, false, { code: 'continue_lesson', remainingMinutes: 5 }],
      ['new_lesson', 25, true, { code: 'new_lesson', why: 'pace_behind' }],
    ]);
    expect(p.later).toMatchObject([{ kind: 'new_lesson', minutes: 15, partial: true }]);
    // On track with a lesson in progress: no new lesson.
    const calm = plan({
      continueLesson: lesson('l1', 10, { status: 'practicing', readProgress: 1 }),
      nextLesson: lesson('l2', 40),
      pace: pace('on_track'),
    });
    expect(calm.blocks.map((b) => b.kind)).toEqual(['continue']);
  });

  it('plans lessons with the calibrated estimate', () => {
    const calibrated = { ...pace('on_track'), calibration: 1.5 };
    const p = plan({
      continueLesson: lesson('l1', 20, { status: 'reading', readProgress: 0.5 }), // 15 → 22.5
      pace: calibrated,
    });
    expect(p.blocks[0]).toMatchObject({
      kind: 'continue',
      minutes: 23, // blocks round up
      reason: { code: 'continue_lesson', remainingMinutes: 23 },
    });
    // A new lesson that waits for later is calibrated as well.
    const later = plan({
      continueLesson: lesson('l1', 20, { status: 'reading', readProgress: 0 }), // 30 minutes
      nextLesson: lesson('l2', 20),
      pace: { ...pace('behind'), calibration: 1.5 },
    });
    expect(later.later.find((b) => b.lessonId === 'l2')?.minutes).toBe(30);
  });

  it('offers weakness practice when the weakest concept is below 60', () => {
    expect(plan({ weakConcepts: [weak('w', 65)] }).blocks).toEqual([]);
    const p = plan({ weakConcepts: [weak('w1', 30), weak('w2', 80)] });
    expect(p.blocks).toMatchObject([
      {
        kind: 'weakness',
        minutes: 5, // one concept × 3 items × 90 s, rounded up
        conceptIds: ['w1'],
        reason: { code: 'weak_concepts', topEffective: 30 },
      },
    ]);
  });

  it('switches to extra study once today’s goal is met, with a 10-minute budget', () => {
    const p = plan({ todayActiveMs: 35 * MIN, reviewQueue: [review('a', 120)] });
    expect(p).toMatchObject({
      goalMet: true,
      mode: 'extra',
      budgetMinutes: 10,
      activeMinutesToday: 35,
    });
    expect(p.blocks.map((b) => b.kind)).toEqual(['review']);
  });
});
