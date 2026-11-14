import type {
  PracticeItemView,
  PracticeProgress,
  PracticeSetResult,
  PracticeSetView,
} from '@proginone/shared';
import type { ContentRepository } from '../../db/content/repository.ts';
import type { PracticeResultJson } from '../../db/user/json.ts';
import {
  appliedItemAttempts,
  listItems,
  type PracticeItemRow,
  type PracticeSet,
} from '../../db/user/practice-sets.ts';
import type { Orm } from '../../db/user/connection.ts';

/** Item counts by status. */
export function progressOf(items: readonly Pick<PracticeItemRow, 'status'>[]): PracticeProgress {
  const answered = items.filter((i) => i.status === 'answered').length;
  const skipped = items.filter((i) => i.status === 'skipped').length;
  return { total: items.length, answered, skipped, pending: items.length - answered - skipped };
}

export function nextItemIdOf(items: readonly Pick<PracticeItemRow, 'id' | 'status'>[]) {
  return items.find((i) => i.status === 'pending')?.id ?? null;
}

/** Stored result → API result, with concept titles for the concepts below the bar. */
export function resultView(result: PracticeResultJson, repo: ContentRepository): PracticeSetResult {
  const pass = result.pass;
  const below = pass?.checks.minConceptScore.below ?? [];
  const titles = repo.getConcepts(below);
  return {
    total: result.total,
    answered: result.answered,
    skipped: result.skipped,
    correct: result.correct,
    pass:
      pass === null
        ? null
        : {
            passed: pass.passed,
            checks: {
              ...pass.checks,
              minConceptScore: {
                ...pass.checks.minConceptScore,
                below: below.map((id) => ({ id, title: titles.get(id)?.title ?? id })),
              },
            },
          },
  };
}

/** The API view of a practice set: items with exercise facts, concept titles and attempt counts. */
export function buildSetView(orm: Orm, repo: ContentRepository, set: PracticeSet): PracticeSetView {
  const items = listItems(orm, set.row.id);
  const exercises = new Map(
    repo.getExercises(items.map((i) => i.exerciseId)).map((e) => [e.id, e]),
  );
  const concepts = repo.getConcepts(
    items.flatMap((i) => (i.targetConceptId === null ? [] : [i.targetConceptId])),
  );
  const attempts = appliedItemAttempts(
    orm,
    items.map((i) => i.id),
  );
  const views: PracticeItemView[] = items.map((item) => {
    const mine = attempts.filter((a) => a.itemId === item.id);
    const exercise = exercises.get(item.exerciseId);
    const concept = item.targetConceptId === null ? undefined : concepts.get(item.targetConceptId);
    return {
      id: item.id,
      position: item.position,
      exerciseId: item.exerciseId,
      // An exercise removed from a later content pack keeps its slot (shown as archived).
      type: exercise?.type ?? 'unknown',
      difficulty: Math.min(5, Math.max(1, exercise?.difficulty ?? 1)),
      status: item.status,
      reason: item.reason,
      targetConcept:
        item.targetConceptId === null
          ? null
          : { id: item.targetConceptId, title: concept?.title ?? item.targetConceptId },
      attempts: mine.length,
      lastOutcome: mine.at(-1)?.outcome ?? null,
    };
  });
  const { row, passRule, result } = set;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    lessonId: set.scope.lessonId,
    items: views,
    progress: progressOf(items),
    nextItemId: row.status === 'active' ? nextItemIdOf(items) : null,
    passRule:
      passRule === null
        ? null
        : {
            minCorrect: passRule.minCorrect,
            minConceptScore: passRule.minConceptScore,
            minDistinctTypes: passRule.minDistinctTypes,
            minLevel3Correct: passRule.minLevel3Correct,
          },
    result: result === null ? null : resultView(result, repo),
    createdAt: row.createdAt.getTime(),
    completedAt: row.completedAt?.getTime() ?? null,
  };
}
