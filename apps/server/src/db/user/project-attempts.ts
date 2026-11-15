import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { Orm } from './connection.ts';
import { answerJson, gradingJson, type GradingJson } from './json.ts';
import { fromRow } from './json-io.ts';
import { attempts, submissions } from './schema.ts';

// Grading runs of a project's milestone web_task (attempts outside practice sets).

/** A run that produced a judgement (not a sandbox failure: `grading_json.engineApplicable`). */
const graded = sql`json_extract(${attempts.gradingJson}, '$.engineApplicable') = 1`;

const mine = (learnerId: string, exerciseId: string) =>
  and(
    eq(attempts.learnerId, learnerId),
    eq(attempts.exerciseId, exerciseId),
    sql`${attempts.practiceSetItemId} IS NULL`,
  );

export interface ProjectRun {
  id: string;
  submittedAt: number;
  outcome: (typeof attempts.$inferSelect)['outcome'];
  score: number;
  grading: GradingJson;
}

/** The latest graded run of the project exercise, or null. */
export function latestGradedRun(
  orm: Orm,
  learnerId: string,
  exerciseId: string,
): ProjectRun | null {
  const row = orm
    .select({
      id: attempts.id,
      submittedAt: attempts.submittedAt,
      outcome: attempts.outcome,
      score: attempts.score,
      grading: attempts.gradingJson,
    })
    .from(attempts)
    .where(and(mine(learnerId, exerciseId), graded))
    .orderBy(desc(attempts.submittedAt), desc(attempts.id))
    .limit(1)
    .get();
  if (!row) return null;
  return {
    id: row.id,
    submittedAt: row.submittedAt.getTime(),
    outcome: row.outcome,
    score: row.score,
    grading: fromRow(gradingJson, row.grading, 'attempts', row.id),
  };
}

export function countGradedRuns(orm: Orm, learnerId: string, exerciseId: string): number {
  return (
    orm
      .select({ n: count() })
      .from(attempts)
      .where(and(mine(learnerId, exerciseId), graded))
      .get()?.n ?? 0
  );
}

/** Answer of the latest submission (graded or not) and when it was sent, or null. */
export function latestProjectAnswer(
  orm: Orm,
  learnerId: string,
  exerciseId: string,
): { answer: Record<string, unknown>; at: number } | null {
  const row = orm
    .select({ id: attempts.id, at: attempts.submittedAt, answer: submissions.answerJson })
    .from(attempts)
    .innerJoin(submissions, eq(submissions.attemptId, attempts.id))
    .where(mine(learnerId, exerciseId))
    .orderBy(desc(attempts.submittedAt), desc(attempts.id))
    .limit(1)
    .get();
  if (!row) return null;
  return { answer: fromRow(answerJson, row.answer, 'submissions', row.id), at: row.at.getTime() };
}
