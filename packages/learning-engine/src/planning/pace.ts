import type { EngineDeps } from '../config.ts';
import type { LocalDate } from '../types.ts';
import { clamp } from '../util/math.ts';
import { addDays, daysBetween } from '../util/time.ts';

/** The learner's current goal (`goals` row, or the defaults 30 minutes × 5 days). */
export interface Goal {
  readonly dailyMinutes: number;
  readonly weeklyDays: number;
  readonly targetCourseId: string | null;
  /** `YYYY-MM-DD` in the learner's calendar. */
  readonly targetDate: LocalDate | null;
}

export type LessonStatus = 'not_started' | 'reading' | 'practicing' | 'completed';

/** A lesson's estimate and the learner's progress in it. */
export interface LessonEstimate {
  readonly lessonId: string;
  /** Content `estimated_minutes` (reading + practice). */
  readonly estimatedMinutes: number;
  /** Content `read_minutes` (part of `estimatedMinutes`). */
  readonly readMinutes: number;
  readonly status: LessonStatus;
  /** 0–1 scroll progress of the body. */
  readonly readProgress: number;
  /** 0–1 share of the active lesson set's items done (0 without a set). */
  readonly practiceProgress: number;
}

/** A completed lesson's estimate and the learner's actual minutes in it. */
export interface LessonTiming {
  readonly estimatedMinutes: number;
  readonly actualMinutes: number;
}

export type PaceStatus = 'on_track' | 'tight' | 'behind' | 'overdue';

export interface PaceResult {
  readonly status: PaceStatus;
  readonly targetDate: LocalDate;
  readonly remainingMinutes: number;
  /** Study days from today (today included while today's goal is not met) to the target date. */
  readonly studyDaysLeft: number;
  readonly requiredPerDay: number;
  /** `goal.dailyMinutes × 0.6`: the share assumed for new lessons. */
  readonly newLearningBudget: number;
  /** `ceil(requiredPerDay / 0.6 / 5) × 5`: daily goal that keeps the date (null when overdue). */
  readonly suggestedDailyMinutes: number | null;
  /** Completion date at the current daily goal. */
  readonly suggestedTargetDate: LocalDate;
  /** Actual/estimated time ratio applied to the estimates (1 until 5 lessons are completed). */
  readonly calibration: number;
}

/** Minutes left in a lesson: unread part of the reading plus the unfinished part of practice. */
export function remainingLessonMinutes(lesson: LessonEstimate, calibration = 1): number {
  if (lesson.status === 'completed') return 0;
  const read = Math.min(lesson.readMinutes, lesson.estimatedMinutes);
  const practice = Math.max(0, lesson.estimatedMinutes - read);
  const readLeft =
    lesson.status === 'practicing' ? 0 : read * (1 - clamp(lesson.readProgress, 0, 1));
  const practiceLeft = practice * (1 - clamp(lesson.practiceProgress, 0, 1));
  return (readLeft + practiceLeft) * calibration;
}

/** Median of actual/estimated over completed lessons, once there are enough of them. */
export function paceCalibration(deps: EngineDeps, timings: readonly LessonTiming[]): number {
  const { calibrationMinLessons, calibrationMin, calibrationMax } = deps.config.goals;
  const ratios = timings
    .filter((t) => t.estimatedMinutes > 0 && t.actualMinutes > 0)
    .map((t) => t.actualMinutes / t.estimatedMinutes)
    .sort((a, b) => a - b);
  if (ratios.length < calibrationMinLessons) return 1;
  const mid = Math.floor(ratios.length / 2);
  const median =
    ratios.length % 2 === 1
      ? (ratios[mid] ?? 1)
      : ((ratios[mid - 1] ?? 1) + (ratios[mid] ?? 1)) / 2;
  return clamp(median, calibrationMin, calibrationMax);
}

/**
 * Goal pace (learning-engine.md#목표-페이스-계산-computepace, FR-GOAL-02). Null without a
 * target course and date.
 *
 * ```text
 * remainingMinutes  = Σ remaining minutes of the target course's lessons × calibration
 * studyDaysLeft     = floor(calendar days to the target date × weeklyDays / 7), at least 1
 * requiredPerDay    = remainingMinutes / studyDaysLeft
 * newLearningBudget = dailyMinutes × 0.6
 * on_track ≤ 0.85 × budget < tight ≤ budget < behind; overdue once the date has passed
 * ```
 */
export function computePace(
  deps: EngineDeps,
  input: {
    readonly goal: Goal;
    /** Every lesson of the target course with the learner's progress. */
    readonly lessons: readonly LessonEstimate[];
    readonly completedTimings: readonly LessonTiming[];
    readonly today: LocalDate;
    /** Today's daily goal is met: today no longer counts as a study day. */
    readonly todayGoalMet: boolean;
  },
): PaceResult | null {
  const g = deps.config.goals;
  const { goal, today } = input;
  if (goal.targetCourseId === null || goal.targetDate === null) return null;
  const calibration = paceCalibration(deps, input.completedTimings);
  const remainingMinutes = input.lessons.reduce(
    (sum, lesson) => sum + remainingLessonMinutes(lesson, calibration),
    0,
  );
  const newLearningBudget = goal.dailyMinutes * g.newLearningShare;
  const firstDay = input.todayGoalMet ? 1 : 0;
  // Completion date at the current budget, counted in study days spread over the week.
  const studyDaysNeeded = Math.ceil(remainingMinutes / Math.max(newLearningBudget, 1));
  const calendarDaysNeeded = Math.ceil((studyDaysNeeded * 7) / goal.weeklyDays);
  const suggestedTargetDate = addDays(today, firstDay + Math.max(calendarDaysNeeded - 1, 0));

  const daysToTarget = daysBetween(today, goal.targetDate);
  if (daysToTarget < 0) {
    return {
      status: 'overdue',
      targetDate: goal.targetDate,
      remainingMinutes,
      studyDaysLeft: 0,
      requiredPerDay: remainingMinutes,
      newLearningBudget,
      suggestedDailyMinutes: null,
      suggestedTargetDate,
      calibration,
    };
  }
  const calendarDays = daysToTarget + 1 - firstDay;
  const studyDaysLeft = Math.max(1, Math.floor((calendarDays * goal.weeklyDays) / 7));
  const requiredPerDay = remainingMinutes / studyDaysLeft;
  const status: PaceStatus =
    requiredPerDay <= newLearningBudget * g.onTrackRatio
      ? 'on_track'
      : requiredPerDay <= newLearningBudget
        ? 'tight'
        : 'behind';
  return {
    status,
    targetDate: goal.targetDate,
    remainingMinutes,
    studyDaysLeft,
    requiredPerDay,
    newLearningBudget,
    suggestedDailyMinutes: Math.ceil(requiredPerDay / g.newLearningShare / 5) * 5,
    suggestedTargetDate,
    calibration,
  };
}
