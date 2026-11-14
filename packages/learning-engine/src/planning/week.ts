import type { EngineDeps } from '../config.ts';
import type { LocalDate } from '../types.ts';
import { addDays, daysBetween } from '../util/time.ts';

/**
 * Weekly achievement and streak (learning-engine.md#주간-달성과-연속-기록, FR-GOAL-04).
 *
 * - studied day: `active_ms ≥ 5 minutes`
 * - goal day: `active_ms ≥` that day's `dailyMinutes`
 * - achieved week (Monday–Sunday): studied days ≥ that week's `weeklyDays`
 * - streak: consecutive achieved weeks (not days), so rest days never break it
 */

/** `daily_activity` row (only the fields used here). */
export interface DayActivity {
  readonly date: LocalDate;
  readonly activeMs: number;
}

/** The goal that applied on a date (goal history; defaults when none existed). */
export type GoalOnDate = (date: LocalDate) => { dailyMinutes: number; weeklyDays: number };

export interface WeekDay {
  readonly date: LocalDate;
  readonly activeMinutes: number;
  readonly studied: boolean;
  readonly goalMet: boolean;
}

export interface WeekSummary {
  readonly weekStart: LocalDate;
  readonly days: readonly WeekDay[];
  readonly studiedDays: number;
  readonly goalDays: number;
  /** The week's goal (that of its last day up to today). */
  readonly weeklyDays: number;
  readonly achieved: boolean;
  readonly activeMinutes: number;
}

/** Monday of the week containing `date`. */
export function weekStartOf(date: LocalDate): LocalDate {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

export function summarizeWeek(
  deps: EngineDeps,
  input: {
    readonly days: readonly DayActivity[];
    readonly goalOn: GoalOnDate;
    readonly weekStart: LocalDate;
    /** Days after today are listed without activity; the goal of today applies to them. */
    readonly today: LocalDate;
  },
): WeekSummary {
  const minMs = deps.config.activity.studyDayMinMs;
  const byDate = new Map(input.days.map((d) => [d.date, d.activeMs]));
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(input.weekStart, i);
    const activeMs = byDate.get(date) ?? 0;
    const goal = input.goalOn(daysBetween(date, input.today) < 0 ? input.today : date);
    days.push({
      date,
      activeMinutes: Math.floor(activeMs / 60_000),
      studied: activeMs >= minMs,
      goalMet: activeMs >= goal.dailyMinutes * 60_000,
    });
  }
  const lastCounted =
    daysBetween(input.weekStart, input.today) >= 6 ? addDays(input.weekStart, 6) : input.today;
  const weeklyDays = input.goalOn(
    daysBetween(input.weekStart, lastCounted) < 0 ? input.weekStart : lastCounted,
  ).weeklyDays;
  const studiedDays = days.filter((d) => d.studied).length;
  return {
    weekStart: input.weekStart,
    days,
    studiedDays,
    goalDays: days.filter((d) => d.goalMet).length,
    weeklyDays,
    achieved: studiedDays >= weeklyDays,
    activeMinutes: days.reduce((s, d) => s + d.activeMinutes, 0),
  };
}

/**
 * Consecutive achieved weeks up to now. The current week counts once it is achieved; while it
 * is still open and not achieved it neither adds nor breaks the streak.
 */
export function weeklyStreak(
  deps: EngineDeps,
  input: {
    readonly days: readonly DayActivity[];
    readonly goalOn: GoalOnDate;
    readonly today: LocalDate;
    /** Stop looking further back than this many weeks. */
    readonly maxWeeks?: number;
  },
): number {
  const max = input.maxWeeks ?? 520;
  let weekStart = weekStartOf(input.today);
  const current = summarizeWeek(deps, { ...input, weekStart });
  let streak = current.achieved ? 1 : 0;
  for (let i = 1; i < max; i++) {
    weekStart = addDays(weekStart, -7);
    const week = summarizeWeek(deps, { ...input, weekStart });
    if (!week.achieved) break;
    streak += 1;
  }
  return streak;
}
