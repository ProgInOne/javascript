import { MASTERY_STAGES, type MasteryStage } from '@proginone/shared';
import { and, desc, eq, inArray, isNotNull, max, ne } from 'drizzle-orm';
import type { Orm } from './connection.ts';
import { practiceResultJson, practiceScopeJson } from './json.ts';
import { fromRow } from './json-io.ts';
import {
  attempts,
  lessonProgress,
  masteryEvidence,
  practiceSetItems,
  practiceSets,
} from './schema.ts';

// "최근 활동" (FR-DASH-01, D-061): practice sets and completed lessons read from the records that
// already exist (practice_sets, practice_set_items, attempts, mastery_evidence, lesson_progress).
// There is no session table to keep in step with restores, resets and assessments.

export interface RecentSetRow {
  id: string;
  kind: (typeof practiceSets.$inferSelect)['kind'];
  status: (typeof practiceSets.$inferSelect)['status'];
  lessonId: string | null;
  conceptIds: string[];
  completedAt: number | null;
  /** The set's completion, else its latest counted attempt. */
  at: number;
  total: number;
  answered: number;
  correct: number;
  /** Concepts whose stage went up from this set's attempts. */
  stageUps: number;
  lessonPassed: boolean;
  assessment: { passed: boolean; ratio: number } | null;
}

const rank = (stage: MasteryStage) => MASTERY_STAGES.indexOf(stage);

/**
 * The `limit` practice sets with the most recent activity that have at least one counted attempt
 * (`engine_applied`), newest first, with their item counts and stage promotions.
 */
export function listRecentSets(orm: Orm, learnerId: string, limit: number): RecentSetRow[] {
  const latest = orm
    .select({
      id: practiceSets.id,
      kind: practiceSets.kind,
      status: practiceSets.status,
      scopeJson: practiceSets.scopeJson,
      resultJson: practiceSets.resultJson,
      completedAt: practiceSets.completedAt,
      lastAttemptAt: max(attempts.submittedAt),
    })
    .from(practiceSets)
    .innerJoin(practiceSetItems, eq(practiceSetItems.practiceSetId, practiceSets.id))
    .innerJoin(attempts, eq(attempts.practiceSetItemId, practiceSetItems.id))
    .where(and(eq(practiceSets.learnerId, learnerId), eq(attempts.engineApplied, true)))
    .groupBy(practiceSets.id)
    .all()
    .map((r) => {
      const last = r.lastAttemptAt?.getTime() ?? 0;
      const done = r.completedAt?.getTime() ?? null;
      return { ...r, completed: done, at: Math.max(last, done ?? 0) };
    })
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
    .slice(0, limit);
  if (latest.length === 0) return [];
  const ids = latest.map((r) => r.id);

  const items = orm
    .select({
      setId: practiceSetItems.practiceSetId,
      status: practiceSetItems.status,
      outcome: attempts.outcome,
    })
    .from(practiceSetItems)
    .leftJoin(attempts, eq(attempts.id, practiceSetItems.finalAttemptId))
    .where(inArray(practiceSetItems.practiceSetId, ids))
    .all();
  const counts = new Map<string, { total: number; answered: number; correct: number }>();
  for (const item of items) {
    const c = counts.get(item.setId) ?? { total: 0, answered: 0, correct: 0 };
    c.total += 1;
    if (item.status === 'answered') c.answered += 1;
    if (item.status === 'answered' && item.outcome === 'correct') c.correct += 1;
    counts.set(item.setId, c);
  }

  const ups = new Map<string, Set<string>>();
  for (const e of orm
    .select({
      setId: practiceSetItems.practiceSetId,
      conceptId: masteryEvidence.conceptId,
      stageBefore: masteryEvidence.stageBefore,
      stageAfter: masteryEvidence.stageAfter,
    })
    .from(masteryEvidence)
    .innerJoin(attempts, eq(attempts.id, masteryEvidence.attemptId))
    .innerJoin(practiceSetItems, eq(practiceSetItems.id, attempts.practiceSetItemId))
    .where(
      and(
        eq(masteryEvidence.learnerId, learnerId),
        ne(masteryEvidence.stageBefore, masteryEvidence.stageAfter),
        inArray(practiceSetItems.practiceSetId, ids),
      ),
    )
    .all()) {
    if (rank(e.stageAfter) <= rank(e.stageBefore)) continue;
    const set = ups.get(e.setId) ?? new Set<string>();
    set.add(e.conceptId);
    ups.set(e.setId, set);
  }

  return latest.map((r) => {
    const scope = fromRow(practiceScopeJson, r.scopeJson, 'practice_sets', r.id);
    const result =
      r.resultJson === null
        ? null
        : fromRow(practiceResultJson, r.resultJson, 'practice_sets', r.id);
    const c = counts.get(r.id) ?? { total: 0, answered: 0, correct: 0 };
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      lessonId: scope.lessonId,
      conceptIds: scope.conceptIds,
      completedAt: r.completed,
      at: r.at,
      ...c,
      stageUps: ups.get(r.id)?.size ?? 0,
      lessonPassed: result?.pass?.passed === true,
      assessment: result?.assessment
        ? { passed: result.assessment.passed, ratio: result.assessment.ratio }
        : null,
    };
  });
}

/** The `limit` most recently completed lessons, newest first. */
export function listRecentLessonCompletions(
  orm: Orm,
  learnerId: string,
  limit: number,
): { lessonId: string; completedAt: number; practiceSetId: string | null }[] {
  return orm
    .select({
      lessonId: lessonProgress.lessonId,
      completedAt: lessonProgress.completedAt,
      practiceSetId: lessonProgress.practiceSetId,
    })
    .from(lessonProgress)
    .where(and(eq(lessonProgress.learnerId, learnerId), isNotNull(lessonProgress.completedAt)))
    .orderBy(desc(lessonProgress.completedAt))
    .limit(limit)
    .all()
    .flatMap((r) =>
      r.completedAt
        ? [
            {
              lessonId: r.lessonId,
              completedAt: r.completedAt.getTime(),
              practiceSetId: r.practiceSetId,
            },
          ]
        : [],
    );
}
