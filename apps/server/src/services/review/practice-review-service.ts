import { redactSpec } from '@proginone/exercise-kit';
import type { PracticeReviewItem, PracticeSetReview, SolutionView } from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import { excludedExerciseIds } from '../../db/user/exercise-records.ts';
import { getSet, listItems } from '../../db/user/practice-sets.ts';
import {
  activeAssessmentExerciseIds,
  lastItemAttempts,
  loadSubmissions,
  seenSolutionExerciseIds,
} from '../../db/user/review-history.ts';
import { AppError } from '../../http/errors.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { learnerContext } from '../practice/engine.ts';
import { kit, loadSpec } from '../practice/kit.ts';
import { answerView, solutionView } from '../practice/solution-view.ts';
import { retryOf } from './mistake-service.ts';

/**
 * "푼 문제 돌아보기" (D-098): every item of a finished practice set with the learner's last answer.
 * Derived from attempts like mistake notes, and by the same rule shows only what the learner has
 * already seen (D-044): the feedback and explanation once an attempt on the item was graded, and
 * the reference answer only when it was opened or a finished assessment revealed it.
 */
export class PracticeReviewService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;

  constructor(deps: { userDb: UserDb; content: ContentAccess }) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
  }

  /** `GET /practice-sets/:id/review`. */
  get(setId: string): PracticeSetReview {
    const orm = this.#userDb.orm;
    const repo = this.#content.repo;
    const { learnerId } = learnerContext(this.#userDb);
    const set = getSet(orm, learnerId, setId);
    if (!set) {
      throw new AppError('NOT_FOUND', 404, '연습 세트를 찾을 수 없습니다.', {
        details: { id: setId },
      });
    }
    // An assessment shows every item on its own result screen, with the answers revealed.
    if (set.row.kind === 'assessment') {
      throw new AppError('PRACTICE_KIND_MISMATCH', 409, '단원 평가는 결과 화면에서 돌아봐요.', {
        details: { id: setId, kind: set.row.kind },
      });
    }
    if (set.row.status !== 'completed') {
      throw new AppError(
        'PRACTICE_SET_UNFINISHED',
        409,
        '연습을 마친 뒤에 푼 문제를 돌아볼 수 있습니다.',
        { details: { id: setId } },
      );
    }

    const items = listItems(orm, setId);
    const exercises = new Map(
      repo.getExercises(items.map((i) => i.exerciseId)).map((e) => [e.id, e]),
    );
    const concepts = repo.getConcepts(
      items.flatMap((i) => (i.targetConceptId === null ? [] : [i.targetConceptId])),
    );
    const last = lastItemAttempts(
      orm,
      items.map((i) => i.id),
    );
    const stored = loadSubmissions(
      orm,
      [...last.values()].map((a) => a.id),
    );
    const misconceptions = repo.getMisconceptions(
      [...last.values()].flatMap((a) => a.misconceptionIds),
    );
    const seen = seenSolutionExerciseIds(
      orm,
      learnerId,
      items.map((i) => i.exerciseId),
    );
    const excluded = excludedExerciseIds(orm, learnerId);
    // An exercise in an assessment in progress keeps its explanation and answer locked here too
    // (D-042, D-044), whatever set it was practised in before.
    const locked = activeAssessmentExerciseIds(orm, learnerId);

    const views = items.map((item): PracticeReviewItem => {
      const exercise = exercises.get(item.exerciseId);
      let spec: unknown = null;
      let code: string | null = exercise?.code ?? null;
      if (exercise) {
        try {
          spec = loadSpec(exercise).spec;
          const publicSpec = kit(() => redactSpec(exercise.type, spec)) as Record<string, unknown>;
          if (code === null && typeof publicSpec['code'] === 'string') code = publicSpec['code'];
        } catch {
          spec = null; // A spec that no longer validates: show the item without answers.
        }
      }
      const attempt = last.get(item.id);
      const sub = attempt ? stored.get(attempt.id) : undefined;
      let answer: SolutionView = { kind: 'none' };
      if (exercise && spec !== null && sub) {
        try {
          answer = answerView(exercise.type, spec, sub.answer);
        } catch {
          answer = { kind: 'none' };
        }
      }
      let solution: SolutionView | null = null;
      const hidden = locked.has(item.exerciseId);
      if (exercise && spec !== null && !hidden && seen.has(item.exerciseId)) {
        try {
          solution = solutionView(exercise.type, spec);
        } catch {
          solution = null;
        }
      }
      const conceptId = item.targetConceptId;
      const lessonId = exercise?.lessonId ?? null;
      return {
        itemId: item.id,
        position: item.position,
        exerciseId: item.exerciseId,
        type: exercise?.type ?? 'unknown',
        difficulty: Math.min(5, Math.max(1, exercise?.difficulty ?? 1)),
        prompt: exercise?.prompt ?? '',
        code,
        codeLanguage: lessonId === null ? null : repo.courseLanguageOfLesson(lessonId),
        concept:
          conceptId === null
            ? null
            : { id: conceptId, title: concepts.get(conceptId)?.title ?? conceptId },
        status: item.status,
        attempts: attempt?.count ?? 0,
        last: attempt
          ? {
              outcome: attempt.outcome,
              confidence: attempt.confidence,
              answer,
              feedback: sub?.feedback ?? [],
              misconceptions: attempt.misconceptionIds.map((id) => ({
                id,
                title: misconceptions.get(id)?.title ?? id,
              })),
              solutionViewed: attempt.solutionViewed,
            }
          : null,
        // The explanation is shown after every graded attempt, so only then.
        explanation: attempt && exercise && !hidden ? exercise.explanation : null,
        solution,
        archived: exercise === undefined,
        retry: retryOf(exercise, excluded),
      };
    });
    return { setId, items: views };
  }
}
