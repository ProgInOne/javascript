import { and, asc, desc, eq, gte, inArray, ne } from 'drizzle-orm';
import type { Orm } from './connection.ts';
import { answerJson, gradingJson, stringListJson } from './json.ts';
import { fromRow } from './json-io.ts';
import {
  attempts,
  hintEvents,
  masteryEvidence,
  practiceSetItems,
  practiceSets,
  submissions,
} from './schema.ts';

// Read models of the review screen: mistake notes (derived from attempts, glossary `MistakeNote`)
// and stage changes (derived from mastery_evidence). Nothing here is stored separately.

/** An attempt with the kind and status of its practice set (null for inline checks). */
export interface GradedAttemptRow {
  id: string;
  exerciseId: string;
  outcome: 'correct' | 'partial' | 'incorrect' | 'error';
  confidence: 'sure' | 'unsure' | 'guess' | null;
  submittedAt: number;
  solutionViewed: boolean;
  hintLevelMax: number;
  misconceptionIds: string[];
  setKind: (typeof practiceSets.$inferSelect)['kind'] | null;
  setStatus: (typeof practiceSets.$inferSelect)['status'] | null;
}

/**
 * Every graded attempt of the learner (sandbox errors excluded), newest first, optionally for
 * one exercise. Attempts the engine did not count (`engine_applied = 0`: sandbox failures and a
 * project's unfinished or repeated runs, D-048) are left out too: they are not wrong answers.
 * The `attempts_learner_submitted` index serves the scan.
 */
export function listGradedAttempts(
  orm: Orm,
  learnerId: string,
  exerciseId?: string,
): GradedAttemptRow[] {
  return orm
    .select({
      id: attempts.id,
      exerciseId: attempts.exerciseId,
      outcome: attempts.outcome,
      confidence: attempts.confidence,
      submittedAt: attempts.submittedAt,
      solutionViewed: attempts.solutionViewed,
      hintLevelMax: attempts.hintLevelMax,
      misconceptionIds: attempts.misconceptionIdsJson,
      setKind: practiceSets.kind,
      setStatus: practiceSets.status,
    })
    .from(attempts)
    .leftJoin(practiceSetItems, eq(attempts.practiceSetItemId, practiceSetItems.id))
    .leftJoin(practiceSets, eq(practiceSetItems.practiceSetId, practiceSets.id))
    .where(
      and(
        eq(attempts.learnerId, learnerId),
        ne(attempts.outcome, 'error'),
        eq(attempts.engineApplied, true),
        exerciseId === undefined ? undefined : eq(attempts.exerciseId, exerciseId),
      ),
    )
    .orderBy(desc(attempts.submittedAt), desc(attempts.id))
    .all()
    .map((row) => ({
      ...row,
      submittedAt: row.submittedAt.getTime(),
      misconceptionIds: fromRow(stringListJson, row.misconceptionIds, 'attempts', row.id),
    }));
}

/** Exercises of assessments still in progress (their notes stay hidden until the end). */
export function activeAssessmentExerciseIds(orm: Orm, learnerId: string): Set<string> {
  const rows = orm
    .select({ exerciseId: practiceSetItems.exerciseId })
    .from(practiceSetItems)
    .innerJoin(practiceSets, eq(practiceSetItems.practiceSetId, practiceSets.id))
    .where(
      and(
        eq(practiceSetItems.learnerId, learnerId),
        eq(practiceSets.kind, 'assessment'),
        eq(practiceSets.status, 'active'),
      ),
    )
    .all();
  return new Set(rows.map((r) => r.exerciseId));
}

/** Stored answers and grader feedback of the given attempts. */
export function loadSubmissions(orm: Orm, attemptIds: readonly string[]) {
  const out = new Map<string, { answer: Record<string, unknown>; feedback: string[] }>();
  if (attemptIds.length === 0) return out;
  for (const row of orm
    .select({
      id: attempts.id,
      answer: submissions.answerJson,
      grading: attempts.gradingJson,
    })
    .from(attempts)
    .innerJoin(submissions, eq(submissions.attemptId, attempts.id))
    .where(inArray(attempts.id, [...attemptIds]))
    .all()) {
    const grading = fromRow(gradingJson, row.grading, 'attempts', row.id);
    out.set(row.id, {
      answer: fromRow(answerJson, row.answer, 'submissions', row.id),
      feedback: grading.feedback.map((f) => f.message),
    });
  }
  return out;
}

/** Whether the learner opened the reference answer of an exercise ("정답 보기") anywhere. */
export function solutionOpened(orm: Orm, learnerId: string, exerciseId: string): boolean {
  return (
    orm
      .select({ id: hintEvents.id })
      .from(hintEvents)
      .where(
        and(
          eq(hintEvents.learnerId, learnerId),
          eq(hintEvents.exerciseId, exerciseId),
          eq(hintEvents.kind, 'solution'),
        ),
      )
      .get() !== undefined
  );
}

/** Evidence rows that changed a concept's stage since `since`, newest first. */
export function listStageChanges(orm: Orm, learnerId: string, since: number) {
  return orm
    .select({
      id: masteryEvidence.id,
      conceptId: masteryEvidence.conceptId,
      attemptId: masteryEvidence.attemptId,
      stageBefore: masteryEvidence.stageBefore,
      stageAfter: masteryEvidence.stageAfter,
      scoreBefore: masteryEvidence.scoreBefore,
      scoreAfter: masteryEvidence.scoreAfter,
      createdAt: masteryEvidence.createdAt,
    })
    .from(masteryEvidence)
    .where(
      and(
        eq(masteryEvidence.learnerId, learnerId),
        ne(masteryEvidence.stageBefore, masteryEvidence.stageAfter),
        gte(masteryEvidence.createdAt, new Date(since)),
      ),
    )
    .orderBy(desc(masteryEvidence.createdAt), desc(masteryEvidence.id))
    .all()
    .map((row) => ({ ...row, createdAt: row.createdAt.getTime() }));
}

/** The latest counted attempt of a set item, with how many were counted. */
export interface LastItemAttemptRow {
  id: string;
  itemId: string;
  outcome: 'correct' | 'partial' | 'incorrect' | 'error';
  confidence: 'sure' | 'unsure' | 'guess' | null;
  solutionViewed: boolean;
  misconceptionIds: string[];
  count: number;
}

/**
 * The latest engine-applied attempt of each given item ("푼 문제 돌아보기"). Attempts the engine
 * did not count (sandbox failures) are left out, as in the set view's attempt counts. The
 * `attempts_item` index serves the lookup.
 */
export function lastItemAttempts(
  orm: Orm,
  itemIds: readonly string[],
): Map<string, LastItemAttemptRow> {
  const out = new Map<string, LastItemAttemptRow>();
  if (itemIds.length === 0) return out;
  const rows = orm
    .select({
      id: attempts.id,
      itemId: attempts.practiceSetItemId,
      outcome: attempts.outcome,
      confidence: attempts.confidence,
      solutionViewed: attempts.solutionViewed,
      misconceptionIds: attempts.misconceptionIdsJson,
    })
    .from(attempts)
    .where(and(inArray(attempts.practiceSetItemId, [...itemIds]), eq(attempts.engineApplied, true)))
    .orderBy(asc(attempts.submittedAt), asc(attempts.id))
    .all();
  for (const row of rows) {
    if (row.itemId === null) continue;
    out.set(row.itemId, {
      id: row.id,
      itemId: row.itemId,
      outcome: row.outcome,
      confidence: row.confidence,
      solutionViewed: row.solutionViewed,
      misconceptionIds: fromRow(stringListJson, row.misconceptionIds, 'attempts', row.id),
      count: (out.get(row.itemId)?.count ?? 0) + 1,
    });
  }
  return out;
}

/**
 * Exercises among `exerciseIds` whose reference answer the learner has seen: opened with "정답
 * 보기" anywhere, or shown on the result screen of a finished assessment (D-044).
 */
export function seenSolutionExerciseIds(
  orm: Orm,
  learnerId: string,
  exerciseIds: readonly string[],
): Set<string> {
  if (exerciseIds.length === 0) return new Set();
  const ids = [...new Set(exerciseIds)];
  const opened = orm
    .selectDistinct({ exerciseId: hintEvents.exerciseId })
    .from(hintEvents)
    .where(
      and(
        eq(hintEvents.learnerId, learnerId),
        eq(hintEvents.kind, 'solution'),
        inArray(hintEvents.exerciseId, ids),
      ),
    )
    .all();
  const assessed = orm
    .selectDistinct({ exerciseId: practiceSetItems.exerciseId })
    .from(practiceSetItems)
    .innerJoin(practiceSets, eq(practiceSetItems.practiceSetId, practiceSets.id))
    .where(
      and(
        eq(practiceSetItems.learnerId, learnerId),
        eq(practiceSets.kind, 'assessment'),
        eq(practiceSets.status, 'completed'),
        inArray(practiceSetItems.exerciseId, ids),
      ),
    )
    .all();
  return new Set([...opened, ...assessed].map((r) => r.exerciseId));
}
