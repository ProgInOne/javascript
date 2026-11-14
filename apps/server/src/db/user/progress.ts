import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Orm } from './connection.ts';
import { dailyActivity, lessonProgress } from './schema.ts';

// lesson_progress and daily_activity.

export type LessonProgressRow = typeof lessonProgress.$inferSelect;

export function getLessonProgress(orm: Orm, learnerId: string, lessonId: string) {
  return (
    orm
      .select()
      .from(lessonProgress)
      .where(and(eq(lessonProgress.learnerId, learnerId), eq(lessonProgress.lessonId, lessonId)))
      .get() ?? null
  );
}

export function upsertLessonProgress(orm: Orm, row: LessonProgressRow): void {
  const { learnerId: _l, lessonId: _id, ...set } = row;
  orm
    .insert(lessonProgress)
    .values(row)
    .onConflictDoUpdate({ target: [lessonProgress.learnerId, lessonProgress.lessonId], set })
    .run();
}

export interface ActivityDelta {
  activeMs?: number;
  attempts?: number;
  correct?: number;
  reviewsDone?: number;
  lessonsCompleted?: number;
}

/** Adds to the learner's `daily_activity` row for a local date (created on first use). */
export function addDailyActivity(
  orm: Orm,
  learnerId: string,
  date: string,
  delta: ActivityDelta,
): void {
  const d = {
    activeMs: delta.activeMs ?? 0,
    attemptsCount: delta.attempts ?? 0,
    correctCount: delta.correct ?? 0,
    reviewsDone: delta.reviewsDone ?? 0,
    lessonsCompleted: delta.lessonsCompleted ?? 0,
  };
  orm
    .insert(dailyActivity)
    .values({ learnerId, date, ...d })
    .onConflictDoUpdate({
      target: [dailyActivity.learnerId, dailyActivity.date],
      set: {
        activeMs: sql`${dailyActivity.activeMs} + ${d.activeMs}`,
        attemptsCount: sql`${dailyActivity.attemptsCount} + ${d.attemptsCount}`,
        correctCount: sql`${dailyActivity.correctCount} + ${d.correctCount}`,
        reviewsDone: sql`${dailyActivity.reviewsDone} + ${d.reviewsDone}`,
        lessonsCompleted: sql`${dailyActivity.lessonsCompleted} + ${d.lessonsCompleted}`,
      },
    })
    .run();
}

export function getDailyActivity(orm: Orm, learnerId: string, date: string) {
  return (
    orm
      .select()
      .from(dailyActivity)
      .where(and(eq(dailyActivity.learnerId, learnerId), eq(dailyActivity.date, date)))
      .get() ?? null
  );
}

/** `daily_activity` rows of a date range (inclusive), oldest first. */
export function listDailyActivity(orm: Orm, learnerId: string, from: string, to: string) {
  return orm
    .select()
    .from(dailyActivity)
    .where(
      and(
        eq(dailyActivity.learnerId, learnerId),
        gte(dailyActivity.date, from),
        lte(dailyActivity.date, to),
      ),
    )
    .orderBy(asc(dailyActivity.date))
    .all();
}

/** Marks a date's goal as met (`daily_activity.goal_met`); never unmarks. */
export function markGoalMet(orm: Orm, learnerId: string, date: string): void {
  orm
    .update(dailyActivity)
    .set({ goalMet: true })
    .where(and(eq(dailyActivity.learnerId, learnerId), eq(dailyActivity.date, date)))
    .run();
}

/** Lesson progress rows of the learner (all lessons, or the given ones). */
export function listLessonProgress(
  orm: Orm,
  learnerId: string,
  lessonIds?: readonly string[],
): LessonProgressRow[] {
  return orm
    .select()
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.learnerId, learnerId),
        lessonIds === undefined ? undefined : inArray(lessonProgress.lessonId, [...lessonIds]),
      ),
    )
    .all();
}

/** The most recently active lesson that is being read or practiced ("이어서 학습"). */
export function latestActiveLesson(orm: Orm, learnerId: string) {
  return (
    orm
      .select()
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.learnerId, learnerId),
          inArray(lessonProgress.status, ['reading', 'practicing']),
        ),
      )
      .orderBy(desc(lessonProgress.updatedAt))
      .limit(1)
      .get() ?? null
  );
}
