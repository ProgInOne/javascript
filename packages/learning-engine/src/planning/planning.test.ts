/**
 * Goals, pace, weekly streak and active time (learning-engine.md#오늘의-학습과-목표,
 * #학습-시간-측정). Scenarios 18–21.
 */
import { describe, expect, it } from 'vitest';
import { deps, SEOUL } from '../test/fixtures.ts';
import type { Heartbeat } from '../time/active-time.ts';
import { accumulateActiveTime, splitByLocalDay } from '../time/active-time.ts';
import { addDays } from '../util/time.ts';
import type { Goal, LessonEstimate } from './pace.ts';
import { computePace, paceCalibration, remainingLessonMinutes } from './pace.ts';
import { summarizeWeek, weekStartOf, weeklyStreak } from './week.ts';

const MIN = 60_000;
const TODAY = '2026-03-02'; // a Monday

function lessons(totalMinutes: number, count = 10): LessonEstimate[] {
  return Array.from({ length: count }, (_, i) => ({
    lessonId: `l${i}`,
    estimatedMinutes: totalMinutes / count,
    readMinutes: totalMinutes / count / 2,
    status: 'not_started' as const,
    readProgress: 0,
    practiceProgress: 0,
  }));
}

const goal = (overrides: Partial<Goal> = {}): Goal => ({
  dailyMinutes: 30,
  weeklyDays: 5,
  targetCourseId: 'js-basics',
  targetDate: addDays(TODAY, 30),
  ...overrides,
});

describe('scenario 18: pace with 600 minutes left, 30 days, 5 days a week, 30 minutes a day', () => {
  it('computes requiredPerDay, the status and a 5-minute suggestion', () => {
    const pace = computePace(deps, {
      goal: goal(),
      lessons: lessons(600),
      completedTimings: [],
      today: TODAY,
      todayGoalMet: false,
    });
    // 31 calendar days (today included) × 5/7 → 22 study days; 600 / 22 ≈ 27.3 > 18.
    expect(pace).toMatchObject({
      status: 'behind',
      remainingMinutes: 600,
      studyDaysLeft: 22,
      newLearningBudget: 18,
      suggestedDailyMinutes: 50, // ceil(27.27 / 0.6 / 5) × 5
      calibration: 1,
    });
    expect(pace?.requiredPerDay).toBeCloseTo(600 / 22, 6);
    // At 18 minutes a day: 34 study days → 48 calendar days, today included.
    expect(pace?.suggestedTargetDate).toBe(addDays(TODAY, 47));
  });

  it('is on track, tight or overdue by the thresholds', () => {
    const run = (minutes: number, overrides: Partial<Goal> = {}, todayGoalMet = false) =>
      computePace(deps, {
        goal: goal(overrides),
        lessons: lessons(minutes),
        completedTimings: [],
        today: TODAY,
        todayGoalMet,
      });
    expect(run(300)?.status).toBe('on_track'); // 13.6 ≤ 15.3
    expect(run(380)?.status).toBe('tight'); // 17.3 ≤ 18
    expect(run(300, { targetDate: addDays(TODAY, -1) })).toMatchObject({
      status: 'overdue',
      suggestedDailyMinutes: null,
    });
    // Today's goal met: today is no longer a study day.
    expect(run(600, {}, true)?.studyDaysLeft).toBe(21);
    expect(run(600, { targetCourseId: null })).toBeNull();
    expect(run(600, { targetDate: null })).toBeNull();
  });

  it('counts only what is left of lessons in progress', () => {
    const base = { lessonId: 'x', estimatedMinutes: 30, readMinutes: 10, practiceProgress: 0 };
    expect(remainingLessonMinutes({ ...base, status: 'completed', readProgress: 1 })).toBe(0);
    expect(remainingLessonMinutes({ ...base, status: 'reading', readProgress: 0.5 })).toBe(25);
    expect(
      remainingLessonMinutes({
        ...base,
        status: 'practicing',
        readProgress: 1,
        practiceProgress: 0.25,
      }),
    ).toBe(15);
  });

  it('calibrates estimates with actual time after five completed lessons (0.5–2.0)', () => {
    const t = (actual: number) => ({ estimatedMinutes: 20, actualMinutes: actual });
    expect(paceCalibration(deps, [t(30), t(30), t(30), t(30)])).toBe(1);
    expect(paceCalibration(deps, [t(10), t(30), t(30), t(40), t(60)])).toBe(1.5);
    expect(paceCalibration(deps, [t(100), t(100), t(100), t(100), t(100)])).toBe(2);
  });
});

describe('active time from heartbeats', () => {
  const at = Date.UTC(2026, 2, 2, 1, 0, 0); // 10:00 in Seoul
  const hb = (offsetMs: number, lastInputOffsetMs: number, visible = true): Heartbeat => ({
    at: at + offsetMs,
    lastInputAt: at + lastInputOffsetMs,
    visible,
    focused: true,
  });

  it('scenario 19: three minutes without input count two minutes', () => {
    // Input at 0; heartbeats every 30 seconds up to three minutes.
    let prev: Heartbeat | null = hb(0, 0);
    let total = 0;
    for (let t = 30_000; t <= 180_000; t += 30_000) {
      const cur = hb(t, 0);
      total += accumulateActiveTime(deps.config, prev, cur, SEOUL).reduce((s, d) => s + d.ms, 0);
      prev = cur;
    }
    expect(total).toBe(2 * MIN);
  });

  it('counts nothing while hidden, after a long gap, or without a previous heartbeat', () => {
    expect(accumulateActiveTime(deps.config, null, hb(30_000, 30_000), SEOUL)).toEqual([]);
    expect(accumulateActiveTime(deps.config, hb(0, 0), hb(30_000, 30_000, false), SEOUL)).toEqual(
      [],
    );
    expect(accumulateActiveTime(deps.config, hb(0, 0), hb(91_000, 91_000), SEOUL)).toEqual([]);
    // A client clock ahead of the server is clamped.
    expect(accumulateActiveTime(deps.config, hb(0, 0), hb(30_000, 999_999), SEOUL)).toEqual([
      { date: TODAY, ms: 30_000 },
    ]);
  });

  it('scenario 20: activity across the 04:00 day start is split between two dates', () => {
    const before = Date.UTC(2026, 2, 2, 18, 59, 40); // 03:59:40 on 03-03 Seoul → still 03-02
    const prev: Heartbeat = { at: before, lastInputAt: before, visible: true, focused: true };
    const cur: Heartbeat = {
      at: before + 30_000,
      lastInputAt: before + 30_000,
      visible: true,
      focused: true,
    };
    expect(accumulateActiveTime(deps.config, prev, cur, SEOUL)).toEqual([
      { date: '2026-03-02', ms: 20_000 },
      { date: '2026-03-03', ms: 10_000 },
    ]);
    expect(splitByLocalDay(before, before + 10_000, SEOUL)).toEqual([
      { date: '2026-03-02', ms: 10_000 },
    ]);
  });
});

describe('weekly achievement and streak', () => {
  const goalOn = () => ({ dailyMinutes: 30, weeklyDays: 5 });
  /** Studies 40 minutes Monday–Friday and rests on the weekend, for `weeks` weeks. */
  function weekdaysOnly(weeks: number, lastMonday: string) {
    const days = [];
    for (let w = 0; w < weeks; w++) {
      const monday = addDays(lastMonday, -7 * w);
      for (let d = 0; d < 5; d++) days.push({ date: addDays(monday, d), activeMs: 40 * MIN });
    }
    return days;
  }

  it('finds the Monday of a week', () => {
    expect(weekStartOf('2026-03-02')).toBe('2026-03-02');
    expect(weekStartOf('2026-03-08')).toBe('2026-03-02'); // Sunday
    expect(weekStartOf('2026-03-04')).toBe('2026-03-02');
  });

  it('summarizes a week: studied days (≥ 5 minutes), goal days and achievement', () => {
    const summary = summarizeWeek(deps, {
      days: [
        { date: '2026-03-02', activeMs: 31 * MIN },
        { date: '2026-03-03', activeMs: 4 * MIN },
        { date: '2026-03-04', activeMs: 10 * MIN },
      ],
      goalOn,
      weekStart: '2026-03-02',
      today: '2026-03-04',
    });
    expect(summary).toMatchObject({ studiedDays: 2, goalDays: 1, weeklyDays: 5, achieved: false });
    expect(summary.activeMinutes).toBe(45);
    expect(summary.days.map((d) => d.studied)).toEqual([
      true,
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('scenario 21: a 5-day goal with weekends off keeps the streak', () => {
    const days = weekdaysOnly(3, '2026-03-16');
    // Sunday of the third week: three achieved weeks in a row.
    expect(weeklyStreak(deps, { days, goalOn, today: '2026-03-22' })).toBe(3);
    // Monday of the next week, nothing yet: the open week neither adds nor breaks.
    expect(weeklyStreak(deps, { days, goalOn, today: '2026-03-23' })).toBe(3);
    // A week with only four studied days ends the streak.
    const broken = days.filter((d) => d.date !== '2026-03-11');
    expect(weeklyStreak(deps, { days: broken, goalOn, today: '2026-03-22' })).toBe(1);
  });

  it('uses the goal that applied in each week', () => {
    const days = weekdaysOnly(2, '2026-03-09').filter(
      (d) => !['2026-03-05', '2026-03-06'].includes(d.date),
    );
    // First week: 3 days, goal 3 a week then; second week: 5 days, goal 5.
    const history = (date: string) => ({
      dailyMinutes: 30,
      weeklyDays: date < '2026-03-09' ? 3 : 5,
    });
    expect(weeklyStreak(deps, { days, goalOn: history, today: '2026-03-15' })).toBe(2);
    expect(weeklyStreak(deps, { days, goalOn, today: '2026-03-15' })).toBe(1);
  });
});
