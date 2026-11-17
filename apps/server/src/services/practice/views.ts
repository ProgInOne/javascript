import { defaultEngineConfig } from '@proginone/learning-engine';
import { inArray } from 'drizzle-orm';
import type {
  AssessmentResult,
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
import { attempts as attemptsTable } from '../../db/user/schema.ts';
import { loadSpec } from './kit.ts';
import { solutionView } from './solution-view.ts';

/** Missed concepts offered to the weakness set after an assessment (its request maximum). */
const WEAKNESS_SUGGESTION_MAX = 5;

/** Item counts by status. */
export function progressOf(items: readonly Pick<PracticeItemRow, 'status'>[]): PracticeProgress {
  const answered = items.filter((i) => i.status === 'answered').length;
  const skipped = items.filter((i) => i.status === 'skipped').length;
  return { total: items.length, answered, skipped, pending: items.length - answered - skipped };
}

/** Sets built before D-081 stored no `minConceptCredit`; they are judged with the default. */
const defaultConceptCredit = defaultEngineConfig.practice.passRule.minConceptCredit;

export function nextItemIdOf(items: readonly Pick<PracticeItemRow, 'id' | 'status'>[]) {
  return items.find((i) => i.status === 'pending')?.id ?? null;
}

/**
 * Stored result → API result, with concept titles for the concepts below the bar. Assessment
 * results also carry every item's outcome, explanation and reference answer: they are built
 * only from a finished set's stored result, so nothing is revealed while it is in progress.
 */
export function resultView(
  result: PracticeResultJson,
  repo: ContentRepository,
  assessment?: { orm: Orm; setId: string },
): PracticeSetResult {
  const pass = result.pass;
  const legacy = pass?.checks.minConceptScore;
  const credit = pass?.checks.minConceptCredit;
  const titles = repo.getConcepts([
    ...(legacy?.below ?? []),
    ...(credit?.concepts.map((c) => c.conceptId) ?? []),
  ]);
  const refOf = (id: string) => ({ id, title: titles.get(id)?.title ?? id });
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
              allAnswered: pass.checks.allAnswered,
              minCorrect: pass.checks.minCorrect,
              minDistinctTypes: pass.checks.minDistinctTypes,
              minLevel3Correct: pass.checks.minLevel3Correct,
              ...(legacy ? { minConceptScore: { ...legacy, below: legacy.below.map(refOf) } } : {}),
              ...(credit
                ? {
                    minConceptCredit: {
                      met: credit.met,
                      required: credit.required,
                      actual: credit.actual,
                      below: credit.below.map(refOf),
                      concepts: credit.concepts.map(({ conceptId, ...rest }) => ({
                        ...refOf(conceptId),
                        ...rest,
                      })),
                    },
                  }
                : {}),
            },
          },
    ...(result.assessment && assessment
      ? {
          assessment: assessmentView(assessment.orm, repo, assessment.setId, result.assessment),
        }
      : {}),
  };
}

function assessmentView(
  orm: Orm,
  repo: ContentRepository,
  setId: string,
  stored: NonNullable<PracticeResultJson['assessment']>,
): AssessmentResult {
  const items = listItems(orm, setId);
  const exercises = new Map(
    repo.getExercises(items.map((i) => i.exerciseId)).map((e) => [e.id, e]),
  );
  const finals = new Map(
    items.flatMap((i) => (i.finalAttemptId === null ? [] : [[i.finalAttemptId, i.id] as const])),
  );
  const rows =
    finals.size === 0
      ? []
      : orm
          .select({
            id: attemptsTable.id,
            outcome: attemptsTable.outcome,
            misconceptionIds: attemptsTable.misconceptionIdsJson,
          })
          .from(attemptsTable)
          .where(inArray(attemptsTable.id, [...finals.keys()]))
          .all();
  const byItem = new Map(rows.map((r) => [finals.get(r.id) ?? '', r]));
  const misconceptionIds = rows.flatMap((r) => (r.misconceptionIds as string[] | null) ?? []);
  const misconceptions = repo.getMisconceptions(misconceptionIds);
  const conceptIds = [
    ...items.flatMap((i) => (i.targetConceptId === null ? [] : [i.targetConceptId])),
    ...stored.concepts.map((c) => c.conceptId),
  ];
  const titles = repo.getConcepts(conceptIds);
  const ref = (id: string) => ({ id, title: titles.get(id)?.title ?? id });
  return {
    correct: stored.correct,
    total: stored.total,
    ratio: stored.ratio,
    passRatio: stored.passRatio,
    passed: stored.passed,
    items: items.map((item) => {
      const exercise = exercises.get(item.exerciseId);
      const attempt = item.status === 'answered' ? byItem.get(item.id) : undefined;
      const ids = (attempt?.misconceptionIds as string[] | null) ?? [];
      let solution: AssessmentResult['items'][number]['solution'] = { kind: 'none' };
      if (exercise) {
        try {
          solution = solutionView(exercise.type, loadSpec(exercise).spec);
        } catch {
          // An exercise whose spec no longer validates keeps its slot without an answer.
        }
      }
      return {
        itemId: item.id,
        position: item.position,
        exerciseId: item.exerciseId,
        type: exercise?.type ?? 'unknown',
        difficulty: Math.min(5, Math.max(1, exercise?.difficulty ?? 1)),
        prompt: exercise?.prompt ?? '',
        concept: item.targetConceptId === null ? null : ref(item.targetConceptId),
        status: item.status,
        outcome: attempt?.outcome ?? null,
        correct: attempt?.outcome === 'correct',
        misconceptions: ids.map((id) => ({ id, title: misconceptions.get(id)?.title ?? id })),
        explanation: exercise?.explanation ?? '',
        solution,
      };
    }),
    concepts: stored.concepts.map((c) => ({
      concept: ref(c.conceptId),
      total: c.total,
      correct: c.correct,
    })),
    missedConcepts: stored.missedConceptIds.map(ref),
    weaknessConceptIds: stored.missedConceptIds.slice(0, WEAKNESS_SUGGESTION_MAX),
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
  // Results of an assessment in progress are withheld (learning-engine.md#단원-평가-세트).
  const withhold = set.row.kind === 'assessment' && set.row.status === 'active';
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
      lastOutcome: withhold ? null : (mine.at(-1)?.outcome ?? null),
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
            minConceptCredit: passRule.minConceptCredit ?? defaultConceptCredit,
            minDistinctTypes: passRule.minDistinctTypes,
            minLevel3Correct: passRule.minLevel3Correct,
          },
    result: result === null ? null : resultView(result, repo, { orm, setId: row.id }),
    createdAt: row.createdAt.getTime(),
    completedAt: row.completedAt?.getTime() ?? null,
  };
}
