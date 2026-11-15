import { and, count, eq, isNull } from 'drizzle-orm';
import type { Orm } from './connection.ts';
import {
  answerJson,
  gradingJson,
  publicSpecJson,
  runResultJson,
  stringListJson,
  type GradingJson,
  type RunResultJson,
} from './json.ts';
import { forWrite } from './json-io.ts';
import { attempts, exerciseSnapshots, submissions } from './schema.ts';

// attempts, submissions and exercise_snapshots (append-only).

export type AttemptInsert = Omit<
  typeof attempts.$inferInsert,
  'misconceptionIdsJson' | 'gradingJson'
> & { misconceptionIds: readonly string[]; grading: GradingJson };

export function insertAttempt(orm: Orm, row: AttemptInsert): void {
  const { misconceptionIds, grading, ...rest } = row;
  orm
    .insert(attempts)
    .values({
      ...rest,
      misconceptionIdsJson: forWrite(
        stringListJson,
        misconceptionIds,
        'attempts.misconception_ids_json',
      ),
      gradingJson: forWrite(gradingJson, grading, 'attempts.grading_json'),
    })
    .run();
}

export function insertSubmission(
  orm: Orm,
  row: {
    attemptId: string;
    learnerId: string;
    answer: unknown;
    runResult: RunResultJson | null;
    answerHash: string;
  },
): void {
  orm
    .insert(submissions)
    .values({
      attemptId: row.attemptId,
      learnerId: row.learnerId,
      answerJson: forWrite(answerJson, row.answer, 'submissions.answer_json'),
      runResultJson:
        row.runResult === null
          ? null
          : forWrite(runResultJson, row.runResult, 'submissions.run_result_json'),
      answerHash: row.answerHash,
    })
    .run();
}

/** Stores the exercise as shown, once per content hash. */
export function insertSnapshot(
  orm: Orm,
  row: { contentHash: string; exerciseId: string; publicSpec: unknown; createdAt: number },
): void {
  orm
    .insert(exerciseSnapshots)
    .values({
      contentHash: row.contentHash,
      exerciseId: row.exerciseId,
      publicSpecJson: forWrite(
        publicSpecJson,
        row.publicSpec,
        'exercise_snapshots.public_spec_json',
      ),
      revision: null,
      createdAt: new Date(row.createdAt),
    })
    .onConflictDoNothing()
    .run();
}

/** Attempts the learner made on an exercise so far (any context). */
export function countExerciseAttempts(orm: Orm, learnerId: string, exerciseId: string): number {
  return (
    orm
      .select({ n: count() })
      .from(attempts)
      .where(and(eq(attempts.learnerId, learnerId), eq(attempts.exerciseId, exerciseId)))
      .get()?.n ?? 0
  );
}

/** Attempts on an exercise in one context: a practice set item, or outside any set (null). */
export function countExerciseScopeAttempts(
  orm: Orm,
  scope: { learnerId: string; exerciseId: string; itemId: string | null },
): number {
  return (
    orm
      .select({ n: count() })
      .from(attempts)
      .where(
        and(
          eq(attempts.learnerId, scope.learnerId),
          eq(attempts.exerciseId, scope.exerciseId),
          scope.itemId === null
            ? isNull(attempts.practiceSetItemId)
            : eq(attempts.practiceSetItemId, scope.itemId),
        ),
      )
      .get()?.n ?? 0
  );
}

/** Engine-applied attempts in a practice set item (`attempt_in_item` counts these). */
export function countAppliedItemAttempts(orm: Orm, itemId: string): number {
  return (
    orm
      .select({ n: count() })
      .from(attempts)
      .where(and(eq(attempts.practiceSetItemId, itemId), eq(attempts.engineApplied, true)))
      .get()?.n ?? 0
  );
}

/** Engine-applied attempts on an exercise outside any practice set (inline checks). */
export function countAppliedStandaloneAttempts(
  orm: Orm,
  learnerId: string,
  exerciseId: string,
): number {
  return (
    orm
      .select({ n: count() })
      .from(attempts)
      .where(
        and(
          eq(attempts.learnerId, learnerId),
          eq(attempts.exerciseId, exerciseId),
          isNull(attempts.practiceSetItemId),
          eq(attempts.engineApplied, true),
        ),
      )
      .get()?.n ?? 0
  );
}
