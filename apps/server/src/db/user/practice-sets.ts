import { and, asc, desc, eq, inArray, isNull, like, max, or } from 'drizzle-orm';
import type { Orm } from './connection.ts';
import {
  passRuleJson,
  practiceResultJson,
  practiceScopeJson,
  type PassRuleJson,
  type PracticeResultJson,
  type PracticeScopeJson,
} from './json.ts';
import { forWrite, fromRow } from './json-io.ts';
import { attempts, hintEvents, pendingRatings, practiceSetItems, practiceSets } from './schema.ts';

// practice_sets, practice_set_items and pending_ratings.

export type PracticeSetRow = typeof practiceSets.$inferSelect;
export type PracticeItemRow = typeof practiceSetItems.$inferSelect;
export type PendingRatingRow = typeof pendingRatings.$inferSelect;

/** A practice set with its JSON columns validated. */
export interface PracticeSet {
  row: PracticeSetRow;
  scope: PracticeScopeJson;
  passRule: PassRuleJson | null;
  result: PracticeResultJson | null;
}

export function insertSet(
  orm: Orm,
  row: Omit<typeof practiceSets.$inferInsert, 'scopeJson' | 'passRuleJson' | 'resultJson'> & {
    scope: PracticeScopeJson;
    passRule: PassRuleJson | null;
  },
  items: (typeof practiceSetItems.$inferInsert)[],
): void {
  const { scope, passRule, ...rest } = row;
  orm
    .insert(practiceSets)
    .values({
      ...rest,
      scopeJson: forWrite(practiceScopeJson, scope, 'practice_sets.scope_json'),
      passRuleJson:
        passRule === null ? null : forWrite(passRuleJson, passRule, 'practice_sets.pass_rule_json'),
    })
    .run();
  if (items.length > 0) orm.insert(practiceSetItems).values(items).run();
}

export function getSet(orm: Orm, learnerId: string, id: string): PracticeSet | null {
  const row = orm
    .select()
    .from(practiceSets)
    .where(and(eq(practiceSets.id, id), eq(practiceSets.learnerId, learnerId)))
    .get();
  if (!row) return null;
  return {
    row,
    scope: fromRow(practiceScopeJson, row.scopeJson, 'practice_sets', row.id),
    passRule:
      row.passRuleJson === null
        ? null
        : fromRow(passRuleJson, row.passRuleJson, 'practice_sets', row.id),
    result:
      row.resultJson === null
        ? null
        : fromRow(practiceResultJson, row.resultJson, 'practice_sets', row.id),
  };
}

/** The most recent active set of a kind (review sets: one at a time). */
export function findActiveSet(orm: Orm, learnerId: string, kind: PracticeSetRow['kind']) {
  return (
    orm
      .select({ id: practiceSets.id })
      .from(practiceSets)
      .where(
        and(
          eq(practiceSets.learnerId, learnerId),
          eq(practiceSets.kind, kind),
          eq(practiceSets.status, 'active'),
        ),
      )
      .orderBy(asc(practiceSets.createdAt))
      .all()
      .at(-1)?.id ?? null
  );
}

/** Active sets of a kind, newest first. */
export function findActiveSets(orm: Orm, learnerId: string, kind: PracticeSetRow['kind']) {
  return orm
    .select({ id: practiceSets.id })
    .from(practiceSets)
    .where(
      and(
        eq(practiceSets.learnerId, learnerId),
        eq(practiceSets.kind, kind),
        eq(practiceSets.status, 'active'),
      ),
    )
    .orderBy(desc(practiceSets.createdAt))
    .all()
    .map((r) => r.id);
}

export function listItems(orm: Orm, setId: string): PracticeItemRow[] {
  return orm
    .select()
    .from(practiceSetItems)
    .where(eq(practiceSetItems.practiceSetId, setId))
    .orderBy(asc(practiceSetItems.position))
    .all();
}

export function updateItem(
  orm: Orm,
  id: string,
  values: Pick<PracticeItemRow, 'status' | 'finalAttemptId'>,
): void {
  orm.update(practiceSetItems).set(values).where(eq(practiceSetItems.id, id)).run();
}

/** Items appended to a set while it is in progress (positions continue the set). */
export function insertItems(
  orm: Orm,
  rows: readonly (typeof practiceSetItems.$inferInsert)[],
): void {
  if (rows.length > 0)
    orm
      .insert(practiceSetItems)
      .values([...rows])
      .run();
}

/** Swaps the exercise of a pending, untouched item (adaptive step-up). */
export function replaceItemExercise(
  orm: Orm,
  row: Pick<PracticeItemRow, 'id' | 'exerciseId' | 'exerciseOrigin' | 'reason'>,
): void {
  orm
    .update(practiceSetItems)
    .set({ exerciseId: row.exerciseId, exerciseOrigin: row.exerciseOrigin, reason: row.reason })
    .where(and(eq(practiceSetItems.id, row.id), eq(practiceSetItems.status, 'pending')))
    .run();
}

/** Items the learner has seen: any attempt (sandbox failures included) or hint/solution view. */
export function touchedItemIds(orm: Orm, itemIds: readonly string[]): Set<string> {
  const out = new Set<string>();
  if (itemIds.length === 0) return out;
  for (const row of orm
    .selectDistinct({ id: attempts.practiceSetItemId })
    .from(attempts)
    .where(inArray(attempts.practiceSetItemId, [...itemIds]))
    .all()) {
    if (row.id !== null) out.add(row.id);
  }
  for (const row of orm
    .selectDistinct({ id: hintEvents.practiceSetItemId })
    .from(hintEvents)
    .where(inArray(hintEvents.practiceSetItemId, [...itemIds]))
    .all()) {
    if (row.id !== null) out.add(row.id);
  }
  return out;
}

export function completeSet(orm: Orm, id: string, result: PracticeResultJson, now: number): void {
  orm
    .update(practiceSets)
    .set({
      status: 'completed',
      resultJson: forWrite(practiceResultJson, result, 'practice_sets.result_json'),
      completedAt: new Date(now),
    })
    .where(eq(practiceSets.id, id))
    .run();
}

/** Ratings of a set not yet applied to FSRS. */
export function listUnflushedRatings(orm: Orm, setId: string): PendingRatingRow[] {
  return orm
    .select()
    .from(pendingRatings)
    .where(and(eq(pendingRatings.practiceSetId, setId), isNull(pendingRatings.flushedAt)))
    .orderBy(asc(pendingRatings.ratedAt), asc(pendingRatings.id))
    .all();
}

export function insertPendingRating(orm: Orm, row: typeof pendingRatings.$inferInsert): void {
  orm.insert(pendingRatings).values(row).run();
}

export function markRatingsFlushed(
  orm: Orm,
  ids: readonly string[],
  outcome: 'applied' | 'skipped',
  now: number,
): void {
  if (ids.length === 0) return;
  orm
    .update(pendingRatings)
    .set({ flushedAt: new Date(now), flushOutcome: outcome })
    .where(inArray(pendingRatings.id, [...ids]))
    .run();
}

/** Engine-applied attempts of the given items in submission order. */
export function appliedItemAttempts(orm: Orm, itemIds: readonly string[]) {
  if (itemIds.length === 0) return [];
  return orm
    .select({
      id: attempts.id,
      itemId: attempts.practiceSetItemId,
      outcome: attempts.outcome,
      score: attempts.score,
      hintLevelMax: attempts.hintLevelMax,
      solutionViewed: attempts.solutionViewed,
      tutorAssisted: attempts.tutorAssisted,
      attemptInItem: attempts.attemptInItem,
      submittedAt: attempts.submittedAt,
    })
    .from(attempts)
    .where(and(inArray(attempts.practiceSetItemId, [...itemIds]), eq(attempts.engineApplied, true)))
    .orderBy(asc(attempts.submittedAt), asc(attempts.id))
    .all();
}

/**
 * When each variant group was last attempted (selection freshness). Served-but-unanswered
 * exercises do not count yet; `exercise_stats.last_seen_at` replaces this in v0.2.
 */
export function lastSeenAtByGroup(orm: Orm, learnerId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of orm
    .select({ key: attempts.variantGroupKey, at: max(attempts.submittedAt) })
    .from(attempts)
    .where(eq(attempts.learnerId, learnerId))
    .groupBy(attempts.variantGroupKey)
    .all()) {
    if (row.at !== null) out[row.key] = row.at.getTime();
  }
  return out;
}

/**
 * Exercises the learner answered at least once (exact IDs; each template variant is its own
 * exercise). Selection ranks repeats below unseen exercises (D-057).
 */
export function seenExerciseIds(orm: Orm, learnerId: string): Set<string> {
  return new Set(
    orm
      .selectDistinct({ id: attempts.exerciseId })
      .from(attempts)
      .where(eq(attempts.learnerId, learnerId))
      .all()
      .map((r) => r.id),
  );
}

/**
 * Variants of the given templates the learner was served in any practice set, oldest first
 * (set creation time, then position). Template IDs are slugs, so `LIKE '<id>@%'` has no
 * wildcard inside the ID.
 */
export function servedVariants(
  orm: Orm,
  learnerId: string,
  templateIds: readonly string[],
): { exerciseId: string; at: number }[] {
  if (templateIds.length === 0) return [];
  return orm
    .select({
      exerciseId: practiceSetItems.exerciseId,
      at: practiceSets.createdAt,
      position: practiceSetItems.position,
    })
    .from(practiceSetItems)
    .innerJoin(practiceSets, eq(practiceSetItems.practiceSetId, practiceSets.id))
    .where(
      and(
        eq(practiceSetItems.learnerId, learnerId),
        or(...templateIds.map((id) => like(practiceSetItems.exerciseId, `${id}@%`))),
      ),
    )
    .orderBy(asc(practiceSets.createdAt), asc(practiceSetItems.position))
    .all()
    .map((r) => ({ exerciseId: r.exerciseId, at: r.at.getTime() }));
}

/**
 * Whether the exercise is an item of one of the learner's assessments in progress. Hints, the
 * solution, the tutor and inline attempts are locked for it until the assessment ends, whatever
 * context a request names (learning-engine.md#단원-평가-세트).
 */
export function inActiveAssessment(orm: Orm, learnerId: string, exerciseId: string): boolean {
  return (
    orm
      .select({ id: practiceSetItems.id })
      .from(practiceSetItems)
      .innerJoin(practiceSets, eq(practiceSetItems.practiceSetId, practiceSets.id))
      .where(
        and(
          eq(practiceSetItems.learnerId, learnerId),
          eq(practiceSetItems.exerciseId, exerciseId),
          eq(practiceSets.kind, 'assessment'),
          eq(practiceSets.status, 'active'),
        ),
      )
      .get() !== undefined
  );
}

/** Attempts the learner made in assessments still in progress (their results are withheld). */
export function activeAssessmentAttemptIds(orm: Orm, learnerId: string): Set<string> {
  const rows = orm
    .select({ id: attempts.id })
    .from(attempts)
    .innerJoin(practiceSetItems, eq(attempts.practiceSetItemId, practiceSetItems.id))
    .innerJoin(practiceSets, eq(practiceSetItems.practiceSetId, practiceSets.id))
    .where(
      and(
        eq(attempts.learnerId, learnerId),
        eq(practiceSets.kind, 'assessment'),
        eq(practiceSets.status, 'active'),
      ),
    )
    .all();
  return new Set(rows.map((r) => r.id));
}
