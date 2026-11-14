import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Orm } from './connection.ts';
import { exerciseReports, hintEvents, practiceSetItems, practiceSets } from './schema.ts';

// Per-exercise learner records outside the attempt transaction: hint/solution events and
// reports (docs/design/data-model.md#트랜잭션-경계: "힌트 열기", "문제 신고").

export type HintEventRow = typeof hintEvents.$inferSelect;

/** Hint scope: one practice set item, or the exercise outside any set (`itemId = null`). */
export interface HintScope {
  learnerId: string;
  exerciseId: string;
  itemId: string | null;
}

export function listHintEvents(orm: Orm, scope: HintScope): HintEventRow[] {
  return orm
    .select()
    .from(hintEvents)
    .where(
      and(
        eq(hintEvents.learnerId, scope.learnerId),
        eq(hintEvents.exerciseId, scope.exerciseId),
        scope.itemId === null
          ? isNull(hintEvents.practiceSetItemId)
          : eq(hintEvents.practiceSetItemId, scope.itemId),
      ),
    )
    .orderBy(asc(hintEvents.createdAt), asc(hintEvents.id))
    .all();
}

/** Highest hint level opened and whether the solution was viewed in a scope. */
export function hintState(events: readonly HintEventRow[]) {
  let level = 0;
  let solutionViewed = false;
  for (const e of events) {
    if (e.kind === 'hint' && e.level !== null) level = Math.max(level, e.level);
    if (e.kind === 'solution') solutionViewed = true;
  }
  return { level, solutionViewed };
}

export function insertHintEvent(orm: Orm, row: typeof hintEvents.$inferInsert): void {
  orm.insert(hintEvents).values(row).run();
}

export function insertReport(orm: Orm, row: typeof exerciseReports.$inferInsert): void {
  orm.insert(exerciseReports).values(row).run();
}

/** Exercises this learner reported and asked not to see again. */
export function excludedExerciseIds(orm: Orm, learnerId: string): Set<string> {
  const rows = orm
    .selectDistinct({ exerciseId: exerciseReports.exerciseId })
    .from(exerciseReports)
    .where(and(eq(exerciseReports.learnerId, learnerId), eq(exerciseReports.excluded, true)))
    .all();
  return new Set(rows.map((r) => r.exerciseId));
}

/** A practice set item with its set's kind and status, or null when it is not the learner's. */
export function findItem(orm: Orm, learnerId: string, itemId: string) {
  return (
    orm
      .select({
        item: practiceSetItems,
        setKind: practiceSets.kind,
        setStatus: practiceSets.status,
      })
      .from(practiceSetItems)
      .innerJoin(practiceSets, eq(practiceSetItems.practiceSetId, practiceSets.id))
      .where(and(eq(practiceSetItems.id, itemId), eq(practiceSetItems.learnerId, learnerId)))
      .get() ?? null
  );
}
