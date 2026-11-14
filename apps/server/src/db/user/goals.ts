import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Orm } from './connection.ts';
import { newId } from './learners.ts';
import { goals } from './schema.ts';

// goals: the current goal (effective_to IS NULL) and its history.

export type GoalRow = typeof goals.$inferSelect;

export function currentGoal(orm: Orm, learnerId: string): GoalRow | null {
  return (
    orm
      .select()
      .from(goals)
      .where(and(eq(goals.learnerId, learnerId), isNull(goals.effectiveTo)))
      .get() ?? null
  );
}

/** Every goal the learner has had, oldest first (weekly achievement uses the goal of the time). */
export function goalHistory(orm: Orm, learnerId: string): GoalRow[] {
  return orm
    .select()
    .from(goals)
    .where(eq(goals.learnerId, learnerId))
    .orderBy(asc(goals.effectiveFrom), asc(goals.id))
    .all();
}

/** Closes the current goal and starts a new one at `now` (run inside a transaction). */
export function replaceGoal(
  orm: Orm,
  learnerId: string,
  values: Pick<GoalRow, 'dailyMinutes' | 'weeklyDays' | 'targetCourseId' | 'targetDate'>,
  now: number,
): GoalRow {
  orm
    .update(goals)
    .set({ effectiveTo: new Date(now) })
    .where(and(eq(goals.learnerId, learnerId), isNull(goals.effectiveTo)))
    .run();
  return orm
    .insert(goals)
    .values({ id: newId(), learnerId, ...values, effectiveFrom: new Date(now), effectiveTo: null })
    .returning()
    .get();
}
