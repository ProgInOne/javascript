import {
  accumulateActiveTime,
  localDateOf,
  type EngineDeps,
  type Heartbeat,
} from '@proginone/learning-engine';
import type { HeartbeatRequest, HeartbeatResponse } from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import {
  addDailyActivity,
  addLessonActiveTime,
  getDailyActivity,
  markGoalMet,
} from '../../db/user/progress.ts';
import type { Clock } from '../clock.ts';
import { learnerContext } from '../practice/engine.ts';
import { loadGoal } from './planning-input.ts';

/**
 * Active learning time from 30-second heartbeats into `daily_activity.active_ms`, and into the
 * lesson on screen (`lesson_progress.active_ms`, FR-GOAL-02) while that lesson is in progress.
 * The previous heartbeat is kept in memory: after a restart the first interval is not counted,
 * which loses at most one heartbeat interval. `study_sessions` (session boundaries, idle close)
 * is not implemented yet.
 */
export class ActivityService {
  readonly #userDb: UserDb;
  readonly #engine: EngineDeps;
  readonly #now: Clock;
  #previous: Heartbeat | null = null;

  constructor(deps: { userDb: UserDb; engine: EngineDeps; now: Clock }) {
    this.#userDb = deps.userDb;
    this.#engine = deps.engine;
    this.#now = deps.now;
  }

  /**
   * Counts the interval since the previous heartbeat: up to two minutes after the last input,
   * nothing while the page is hidden or after a gap over 90 seconds. The client clock is not
   * trusted beyond clamping `lastInputAt` into the interval.
   */
  heartbeat(request: HeartbeatRequest): HeartbeatResponse {
    const now = this.#now();
    const { learnerId, dayBoundary } = learnerContext(this.#userDb);
    // The server clock is the heartbeat time; the client only reports its last input.
    const current: Heartbeat = {
      at: now,
      lastInputAt: request.lastInputAt,
      visible: request.visible,
      focused: request.focused,
    };
    const segments = accumulateActiveTime(
      this.#engine.config,
      this.#previous,
      current,
      dayBoundary,
    );
    this.#previous = current;
    const orm = this.#userDb.orm;
    if (segments.length > 0) {
      const { goal } = loadGoal(this.#engine, orm, learnerId);
      orm.transaction(() => {
        for (const s of segments) {
          addDailyActivity(orm, learnerId, s.date, { activeMs: s.ms });
          // The goal of the day (FR-GOAL-04): today's goal for every segment of this heartbeat.
          const total = getDailyActivity(orm, learnerId, s.date)?.activeMs ?? 0;
          if (total >= goal.dailyMinutes * 60_000) markGoalMet(orm, learnerId, s.date);
        }
        // The interval belongs to the lesson on screen now (one heartbeat of attribution lag
        // when the learner switches pages). Unknown or untouched lessons have no row: no-op.
        if (request.lessonId !== undefined) {
          const ms = segments.reduce((sum, s) => sum + s.ms, 0);
          addLessonActiveTime(orm, learnerId, request.lessonId, ms);
        }
      });
    }
    const date = localDateOf(now, dayBoundary);
    return {
      date,
      countedMs: segments.reduce((sum, s) => sum + s.ms, 0),
      activeMsToday: getDailyActivity(orm, learnerId, date)?.activeMs ?? 0,
    };
  }
}
