import type { EngineConfig } from '../config.ts';
import type { LocalDate } from '../types.ts';
import type { DayBoundary } from '../util/time.ts';
import { HOUR_MS, localDateOf, startOfLocalDay } from '../util/time.ts';

/**
 * Active learning time from heartbeats (learning-engine.md#학습-시간-측정, FR-GOAL-05).
 * The client sends `{ at, lastInputAt, visible, focused }` every 30 seconds.
 */
export interface Heartbeat {
  readonly at: number;
  /** Last keyboard/pointer/scroll/editor input. Clamped into `[0, at]`. */
  readonly lastInputAt: number;
  readonly visible: boolean;
  readonly focused: boolean;
}

/** Active milliseconds credited to one learner-local date. */
export interface ActiveTimeDelta {
  readonly date: LocalDate;
  readonly ms: number;
}

/** Splits `[start, end)` at the learner's day boundaries (DST-safe). */
export function splitByLocalDay(
  start: number,
  end: number,
  boundary: DayBoundary,
): ActiveTimeDelta[] {
  const out: ActiveTimeDelta[] = [];
  let cursor = start;
  while (cursor < end) {
    const date = localDateOf(cursor, boundary);
    const stop = localDateOf(end - 1, boundary) === date ? end : nextDayStart(cursor, boundary);
    const until = Math.min(end, stop);
    out.push({ date, ms: until - cursor });
    cursor = until;
  }
  return out;
}

function nextDayStart(at: number, boundary: DayBoundary): number {
  const today = localDateOf(at, boundary);
  let probe = at + HOUR_MS;
  while (localDateOf(probe, boundary) === today) probe += HOUR_MS;
  return startOfLocalDay(localDateOf(probe, boundary), boundary);
}

/**
 * Active time between the previous heartbeat and this one: from `prev.at` until
 * `min(cur.at, cur.lastInputAt + idleThreshold)`, nothing while the page is hidden, nothing
 * after a gap longer than `maxHeartbeatGapMs` (app closed, laptop asleep). The result is split
 * at the learner's day start so time after 04:00 goes to the new day.
 */
export function accumulateActiveTime(
  config: EngineConfig,
  prev: Heartbeat | null,
  cur: Heartbeat,
  dayBoundary: DayBoundary,
): ActiveTimeDelta[] {
  const { idleThresholdMs, maxHeartbeatGapMs } = config.activity;
  if (prev === null || prev.at >= cur.at || !cur.visible) return [];
  if (cur.at - prev.at > maxHeartbeatGapMs) return [];
  const lastInput = Math.min(Math.max(cur.lastInputAt, 0), cur.at);
  const end = Math.min(cur.at, lastInput + idleThresholdMs);
  return end > prev.at ? splitByLocalDay(prev.at, end, dayBoundary) : [];
}
