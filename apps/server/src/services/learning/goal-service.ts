import {
  addDays,
  computePace,
  daysBetween,
  localDateOf,
  paceCalibration,
  summarizeWeek,
  weekStartOf,
  weeklyStreak,
  type EngineDeps,
  type Goal,
  type PaceResult,
} from '@proginone/learning-engine';
import type { GoalRequest, GoalStatus } from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import { replaceGoal } from '../../db/user/goals.ts';
import { getDailyActivity, listDailyActivity } from '../../db/user/progress.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { learnerContext } from '../practice/engine.ts';
import {
  completedLessonTimings,
  courseLessonEstimates,
  goalOnDate,
  goalView,
  loadGoal,
} from './planning-input.ts';

/** Weeks looked back for the weekly streak. */
const STREAK_WEEKS = 104;

/** `GET/PUT /goals`: goal, pace, this week's achievement and the weekly streak (FR-GOAL-*). */
export class GoalService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;
  readonly #engine: EngineDeps;
  readonly #now: Clock;

  constructor(deps: { userDb: UserDb; content: ContentAccess; engine: EngineDeps; now: Clock }) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
    this.#engine = deps.engine;
    this.#now = deps.now;
  }

  /** Pace of the course target at `now` (null without a target). */
  pace(goal: Goal, now = this.#now()): PaceResult | null {
    if (goal.targetCourseId === null) return null;
    const orm = this.#userDb.orm;
    const { learnerId, dayBoundary } = learnerContext(this.#userDb);
    const today = localDateOf(now, dayBoundary);
    const activeMs = getDailyActivity(orm, learnerId, today)?.activeMs ?? 0;
    return computePace(this.#engine, {
      goal,
      lessons: courseLessonEstimates(this.#content.repo, orm, learnerId, goal.targetCourseId).map(
        (l) => l.estimate,
      ),
      // Actual time of completed lessons calibrates the estimates (FR-GOAL-02).
      completedTimings: completedLessonTimings(this.#content.repo, orm, learnerId),
      today,
      todayGoalMet: activeMs >= goal.dailyMinutes * 60_000,
    });
  }

  /** The learner's actual/estimated lesson time ratio (1 until enough lessons are timed). */
  calibration(): number {
    const { learnerId } = learnerContext(this.#userDb);
    return paceCalibration(
      this.#engine,
      completedLessonTimings(this.#content.repo, this.#userDb.orm, learnerId),
    );
  }

  get(): GoalStatus {
    const now = this.#now();
    const orm = this.#userDb.orm;
    const { learnerId, dayBoundary } = learnerContext(this.#userDb);
    const today = localDateOf(now, dayBoundary);
    const { row, goal } = loadGoal(this.#engine, orm, learnerId);
    const goalOn = goalOnDate(this.#engine, orm, learnerId, dayBoundary);
    const weekStart = weekStartOf(today);
    const days = listDailyActivity(orm, learnerId, addDays(weekStart, -7 * STREAK_WEEKS), today);
    return {
      date: today,
      goal: goalView(this.#content.repo, row, goal),
      pace: this.pace(goal, now),
      week: (({ days: weekDays, ...week }) => ({ ...week, days: [...weekDays] }))(
        summarizeWeek(this.#engine, { days, goalOn, weekStart, today }),
      ),
      streakWeeks: weeklyStreak(this.#engine, { days, goalOn, today, maxWeeks: STREAK_WEEKS }),
    };
  }

  /**
   * Replaces the goal (the old row is kept with `effective_to`, so past weeks keep their goal).
   * A course target needs an existing course and a date from today on.
   */
  put(request: GoalRequest): GoalStatus {
    const now = this.#now();
    const orm = this.#userDb.orm;
    const { learnerId, dayBoundary } = learnerContext(this.#userDb);
    const targetCourseId = request.targetCourseId ?? null;
    const targetDate = request.targetDate ?? null;
    if (targetCourseId !== null && this.#content.repo.getCourse(targetCourseId) === null) {
      throw new AppError('VALIDATION_FAILED', 400, '목표 과정을 찾을 수 없습니다.', {
        details: { targetCourseId },
      });
    }
    if (targetDate !== null && daysBetween(localDateOf(now, dayBoundary), targetDate) < 0) {
      throw new AppError('VALIDATION_FAILED', 400, '목표일은 오늘 이후로 정해 주세요.', {
        details: { targetDate },
      });
    }
    orm.transaction(() => {
      replaceGoal(
        orm,
        learnerId,
        {
          dailyMinutes: request.dailyMinutes,
          weeklyDays: request.weeklyDays,
          targetCourseId,
          targetDate,
        },
        now,
      );
    });
    return this.get();
  }
}
