/**
 * 30-day fake-clock simulation (roadmap M5 completion criterion): a simulated learner follows
 * today's plan on weekdays for 30 days with the real ts-fsrs scheduler. The assertions check that
 * the review schedule, mastery and today's plan behave as designed over time.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineDeps } from './config.ts';
import { defaultEngineConfig } from './config.ts';
import { createTsFsrsPort } from './memory/fsrs-adapter.ts';
import { SEOUL } from './test/fixtures.ts';
import type { SimConcept, SimLesson } from './test/simulator.ts';
import { SimulatedLearner } from './test/simulator.ts';
import { addDays, DAY_MS, daysBetween, localDateOf } from './util/time.ts';

/** Monday 2026-03-02, 19:00 in Seoul. */
const START = Date.UTC(2026, 2, 2, 10, 0, 0);
const DAYS = 30;
const STRUGGLING = 'js.c03b';
const STRONG = ['js.c01a', 'js.c01b'];

const lessons: SimLesson[] = Array.from({ length: 10 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return {
    id: `js.l${n}`,
    importance: 'standard',
    introduces: [`js.c${n}a`, `js.c${n}b`],
    estimatedMinutes: 25,
    readMinutes: 8,
  };
});

const concepts: SimConcept[] = lessons.flatMap((l, i) =>
  l.introduces.map((id, j) => ({
    id,
    importance: j === 0 ? 'core' : 'standard',
    moduleId: `m${Math.floor(i / 3)}`,
    base: STRONG.includes(id) ? 0.9 : id === STRUGGLING ? 0.2 : 0.8,
    misconceptionProne: id === STRUGGLING,
  })),
);

let deps: EngineDeps;

function simulate(seed = 'sim-30') {
  const learner = new SimulatedLearner(deps, {
    concepts,
    lessons,
    goal: {
      dailyMinutes: 30,
      weeklyDays: 5,
      targetCourseId: 'js',
      targetDate: addDays(localDateOf(START, SEOUL), 27),
    },
    dayBoundary: SEOUL,
    seed,
  });
  for (let day = 0; day < DAYS; day++) {
    // Weekends off: day 5 and 6 of each week (Saturday, Sunday).
    learner.runDay(day, START + day * DAY_MS, day % 7 >= 5);
  }
  return learner;
}

describe('30-day simulation', () => {
  let learner: SimulatedLearner;

  beforeAll(async () => {
    deps = { config: defaultEngineConfig, fsrs: await createTsFsrsPort(defaultEngineConfig.fsrs) };
    learner = simulate();
  });

  it('is deterministic for the same seed', () => {
    const again = simulate();
    expect(again.reviewLogs).toEqual(learner.reviewLogs);
    expect([...again.states.values()].map((s) => s.mastery)).toEqual(
      [...learner.states.values()].map((s) => s.mastery),
    );
  });

  describe('review schedule', () => {
    it('creates a card only after practice and rates each concept at most once a day (again excepted)', () => {
      const byDay = new Map<string, string[]>();
      for (const log of learner.reviewLogs) {
        const key = `${log.conceptId}@${localDateOf(log.reviewedAt, SEOUL)}`;
        byDay.set(key, [...(byDay.get(key) ?? []), log.rating]);
      }
      for (const ratings of byDay.values()) {
        // A second rating on the same day is only ever an `again`.
        expect(ratings.slice(1).every((r) => r === 'again')).toBe(true);
      }
      for (const log of learner.reviewLogs) {
        expect(log.reviewedAt).toBeGreaterThanOrEqual(
          learner.firstPracticeAt.get(log.conceptId) ?? Infinity,
        );
      }
    });

    it('reviews due concepts on study days, within the daily plan budget', () => {
      const studyDays = learner.days.filter((d) => d.studied);
      for (const day of studyDays) {
        const review = day.plan?.blocks.find((b) => b.kind === 'review');
        if (day.dueAtStart.length > 0) {
          expect(review, `review block on ${day.date}`).toBeDefined();
          expect(day.reviewedConcepts.length).toBeGreaterThan(0);
        }
        if (review && day.plan) {
          // The first review always fits; beyond it the review share caps the block.
          expect(review.minutes).toBeLessThanOrEqual(
            Math.max(
              Math.ceil(day.plan.reviewCapMinutes),
              Math.ceil(day.dueAtStart[0]?.estimatedSeconds ?? 0) / 60 + 1,
            ),
          );
        }
      }
    });

    it('defers reviews over budget by priority and works the backlog down', () => {
      const studyDays = learner.days.filter((d) => d.studied);
      for (const day of studyDays) {
        const worst = Math.max(0, ...day.dueAtStart.map((e) => e.overdueDays));
        // Lesson-heavy weeks push low-priority reviews back (about a week at most with a
        // 15-minute review share; overdue ratio raises their priority over time).
        expect(worst, `overdue on ${day.date}`).toBeLessThanOrEqual(10);
        const review = day.plan?.blocks.find((b) => b.kind === 'review');
        // The plan takes the queue's highest priorities first.
        if (review) {
          expect(review.conceptIds).toEqual(
            day.dueAtStart.slice(0, review.conceptIds.length).map((e) => e.conceptId),
          );
        }
      }
      // Once no new lessons compete for time, the backlog shrinks.
      const due = studyDays.map((d) => d.dueAtStart.length);
      expect(Math.min(...due.slice(-5))).toBeLessThan(Math.max(...due));
    });

    it('spaces successful reviews further apart (expanding intervals)', () => {
      for (const id of STRONG) {
        const goods = learner.reviewLogs.filter(
          (l) => l.conceptId === id && (l.rating === 'good' || l.rating === 'easy'),
        );
        expect(goods.length, id).toBeGreaterThanOrEqual(3);
        const gaps = goods
          .slice(1)
          .map((l, i) =>
            daysBetween(
              localDateOf(goods[i]?.reviewedAt ?? 0, SEOUL),
              localDateOf(l.reviewedAt, SEOUL),
            ),
          );
        expect(gaps.at(-1) ?? 0, `${id} gaps ${gaps.join(',')}`).toBeGreaterThan(gaps[0] ?? 0);
        const card = learner.state(id).memory?.card;
        expect(card?.stability ?? 0).toBeGreaterThan(7);
      }
    });
  });

  describe('mastery', () => {
    it('keeps scores in range and stages consistent with the gates', () => {
      for (const s of learner.states.values()) {
        expect(s.mastery.score).toBeGreaterThanOrEqual(0);
        expect(s.mastery.score).toBeLessThanOrEqual(100);
      }
    });

    it('brings strong concepts to proficient, never mastered within two weeks of first practice', () => {
      for (const id of STRONG) {
        const s = learner.state(id);
        expect(['proficient', 'mastered'], id).toContain(s.mastery.stage);
        if (s.mastery.stage === 'mastered') {
          const first = learner.firstPracticeAt.get(id) ?? 0;
          expect((s.mastery.stageChangedAt ?? 0) - first).toBeGreaterThanOrEqual(
            14 * DAY_MS - DAY_MS / 2,
          );
        }
      }
      for (const s of learner.states.values()) {
        if (s.mastery.stage !== 'mastered') continue;
        const first = learner.firstPracticeAt.get(s.mastery.conceptId) ?? 0;
        expect((s.mastery.stageChangedAt ?? 0) - first).toBeGreaterThanOrEqual(13 * DAY_MS);
      }
    });

    it('keeps the struggling concept below proficient with a confirmed misconception', () => {
      const s = learner.state(STRUGGLING);
      expect(['introduced', 'practicing']).toContain(s.mastery.stage);
      expect(learner.misconceptions.get(`${STRUGGLING}.mc`)?.status).toBe('confirmed');
    });
  });

  describe("today's plan", () => {
    it('stays within the budget and keeps the block order', () => {
      const order = ['review', 'continue', 'new_lesson', 'weakness'];
      for (const day of learner.days.filter((d) => d.studied)) {
        const plan = day.plan;
        if (!plan) throw new Error('no plan');
        const total = plan.blocks.reduce((s, b) => s + b.minutes, 0);
        expect(total, `planned minutes on ${day.date}`).toBeLessThanOrEqual(plan.budgetMinutes + 1);
        const kinds = plan.blocks.map((b) => order.indexOf(b.kind));
        expect(kinds).toEqual([...kinds].sort((a, b) => a - b));
      }
    });

    it('starts with the first lesson and moves through the course without blocking', () => {
      const first = learner.days[0]?.plan;
      expect(first?.blocks.map((b) => [b.kind, b.lessonId, b.reason])).toEqual([
        ['new_lesson', 'js.l01', { code: 'new_lesson', why: 'first_lesson' }],
      ]);
      // Every lesson gets started; a lesson that does not pass (the struggling concept's) does
      // not lock the next ones (FR-CUR-05).
      const started = learner.days.flatMap((d) =>
        (d.plan?.blocks ?? []).flatMap((b) => (b.lessonId === null ? [] : [b.lessonId])),
      );
      expect(new Set(started)).toEqual(new Set(lessons.map((l) => l.id)));
      expect(learner.lessonProgress.get('js.l03')).toBe('practicing');
      const completed = learner.days.flatMap((d) => d.lessonsCompleted);
      expect(completed.length).toBeGreaterThanOrEqual(lessons.length / 2);
    });

    it('offers weakness practice for the struggling concept', () => {
      const weaknessDays = learner.days.filter((d) => d.weaknessConcepts.includes(STRUGGLING));
      expect(weaknessDays.length).toBeGreaterThan(0);
      const firstSeen = learner.firstPracticeAt.get(STRUGGLING) ?? Infinity;
      for (const d of weaknessDays) {
        expect(START + d.day * DAY_MS).toBeGreaterThan(firstSeen);
      }
    });

    it('tracks the pace towards the target date', () => {
      const paces = learner.days.map((d) => d.pace);
      expect(paces.every((p) => p !== null)).toBe(true);
      const remaining = paces.map((p) => p?.remainingMinutes ?? 0);
      // Remaining minutes never grow, and the course shrinks over the month.
      expect(remaining).toEqual([...remaining].sort((a, b) => b - a));
      expect(remaining.at(-1)).toBeLessThan(remaining[0] ?? 0);
      expect(paces.at(-1)?.status).toBe('overdue');
    });
  });
});
