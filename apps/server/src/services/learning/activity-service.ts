import { localDateOf, startOfLocalDay, type DayBoundary } from '@proginone/learning-engine';
import type { HeartbeatRequest, HeartbeatResponse } from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import { addDailyActivity, getDailyActivity } from '../../db/user/progress.ts';
import type { Clock } from '../clock.ts';
import { learnerContext } from '../practice/engine.ts';

/** Input older than this ends the active stretch (FR-GOAL-05). */
export const IDLE_THRESHOLD_MS = 2 * 60_000;
/** A longer gap between heartbeats counts as nothing (app closed, laptop asleep). */
export const MAX_HEARTBEAT_GAP_MS = 90_000;

/**
 * Splits `[start, end)` at the learner's day boundaries so time just after the day start goes
 * to the new day (learning-engine.md#학습-시간-측정).
 */
export function splitByLocalDay(
  start: number,
  end: number,
  boundary: DayBoundary,
): { date: string; ms: number }[] {
  const out: { date: string; ms: number }[] = [];
  let cursor = start;
  while (cursor < end) {
    const date = localDateOf(cursor, boundary);
    const next = localDateOf(end - 1, boundary) === date ? end : nextDayStart(cursor, boundary);
    const stop = Math.min(end, next);
    out.push({ date, ms: stop - cursor });
    cursor = stop;
  }
  return out;
}

function nextDayStart(at: number, boundary: DayBoundary): number {
  // The next local date's start: search forward a day at a time (DST-safe via startOfLocalDay).
  const today = localDateOf(at, boundary);
  let probe = at + 3_600_000;
  while (localDateOf(probe, boundary) === today) probe += 3_600_000;
  return startOfLocalDay(localDateOf(probe, boundary), boundary);
}

/**
 * Active learning time from 30-second heartbeats into `daily_activity.active_ms`. The previous
 * heartbeat is kept in memory: after a restart the first interval is not counted, which loses at
 * most one heartbeat interval. `study_sessions` (session boundaries, idle close) is v0.2.
 */
export class ActivityService {
  readonly #userDb: UserDb;
  readonly #now: Clock;
  #previousAt: number | null = null;

  constructor(deps: { userDb: UserDb; now: Clock }) {
    this.#userDb = deps.userDb;
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
    const previous = this.#previousAt;
    this.#previousAt = now;

    let segments: { date: string; ms: number }[] = [];
    if (
      previous !== null &&
      previous < now &&
      now - previous <= MAX_HEARTBEAT_GAP_MS &&
      request.visible
    ) {
      const lastInputAt = Math.min(Math.max(request.lastInputAt, 0), now);
      const end = Math.min(now, lastInputAt + IDLE_THRESHOLD_MS);
      if (end > previous) segments = splitByLocalDay(previous, end, dayBoundary);
    }
    const orm = this.#userDb.orm;
    if (segments.length > 0) {
      orm.transaction(() => {
        for (const s of segments) addDailyActivity(orm, learnerId, s.date, { activeMs: s.ms });
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
