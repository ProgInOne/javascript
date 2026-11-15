import type { ExerciseStats } from '@proginone/shared';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { Orm } from './connection.ts';
import { activeAssessmentAttemptIds } from './practice-sets.ts';
import { attempts, practiceSetItems } from './schema.ts';

/**
 * Per-exercise statistics (FR-EX-10, data-model.md#exercise_stats-exercise_reports), derived from
 * `attempts` and `practice_set_items` on read instead of a maintained `exercise_stats` table
 * (D-051): one learner has thousands of attempts at most, the attempts are the source of truth
 * anyway (data-model.md 재계산 가능성), and there is no counter to keep in step with restores,
 * resets and assessments. Only engine-applied attempts count, and attempts of an assessment still
 * in progress are left out so the numbers cannot reveal withheld results.
 */
export function exerciseStats(
  orm: Orm,
  learnerId: string,
  exerciseIds: readonly string[],
): Map<string, ExerciseStats> {
  const out = new Map<string, ExerciseStats>();
  if (exerciseIds.length === 0) return out;
  for (const id of exerciseIds) out.set(id, empty(id));

  const withheld = activeAssessmentAttemptIds(orm, learnerId);
  const rows = orm
    .select({
      id: attempts.id,
      exerciseId: attempts.exerciseId,
      attemptInItem: attempts.attemptInItem,
      outcome: attempts.outcome,
      hintLevelMax: attempts.hintLevelMax,
      solutionViewed: attempts.solutionViewed,
      activeMs: attempts.activeMs,
      submittedAt: attempts.submittedAt,
    })
    .from(attempts)
    .where(
      and(
        eq(attempts.learnerId, learnerId),
        eq(attempts.engineApplied, true),
        inArray(attempts.exerciseId, [...exerciseIds]),
      ),
    )
    .all();
  const totalMs = new Map<string, number>();
  for (const r of rows) {
    const s = out.get(r.exerciseId);
    if (!s || withheld.has(r.id)) continue;
    s.attempts += 1;
    totalMs.set(r.exerciseId, (totalMs.get(r.exerciseId) ?? 0) + r.activeMs);
    if (r.attemptInItem === 1) {
      s.firstTries += 1;
      if (r.outcome === 'correct') s.firstTryCorrect += 1;
    }
    if (r.hintLevelMax > 0) s.hintUsedAttempts += 1;
    if (r.solutionViewed) s.solutionViewedAttempts += 1;
    const at = r.submittedAt.getTime();
    if (s.lastAttemptAt === null || at > s.lastAttemptAt) s.lastAttemptAt = at;
  }

  for (const row of orm
    .select({ exerciseId: practiceSetItems.exerciseId, n: count() })
    .from(practiceSetItems)
    .where(
      and(
        eq(practiceSetItems.learnerId, learnerId),
        inArray(practiceSetItems.exerciseId, [...exerciseIds]),
      ),
    )
    .groupBy(practiceSetItems.exerciseId)
    .all()) {
    const s = out.get(row.exerciseId);
    if (s) s.timesServed = row.n;
  }

  for (const s of out.values()) {
    s.firstTryCorrectRate = s.firstTries > 0 ? s.firstTryCorrect / s.firstTries : null;
    s.hintUsageRate = s.attempts > 0 ? s.hintUsedAttempts / s.attempts : null;
    s.averageActiveMs =
      s.attempts > 0 ? Math.round((totalMs.get(s.exerciseId) ?? 0) / s.attempts) : null;
  }
  return out;
}

function empty(exerciseId: string): ExerciseStats {
  return {
    exerciseId,
    attempts: 0,
    timesServed: 0,
    firstTries: 0,
    firstTryCorrect: 0,
    firstTryCorrectRate: null,
    averageActiveMs: null,
    hintUsedAttempts: 0,
    hintUsageRate: null,
    solutionViewedAttempts: 0,
    lastAttemptAt: null,
  };
}
