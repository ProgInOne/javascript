import type { RelatedExercises } from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import { exerciseStats } from '../../db/user/exercise-stats.ts';
import { ensureLearner } from '../../db/user/learners.ts';
import { activeAssessmentExerciseIds } from '../../db/user/review-history.ts';
import { AppError } from '../../http/errors.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';

/**
 * `GET /concepts/:id/exercises` (FR-DASH-02 "관련 문제", FR-EX-10, D-061): the practice exercises
 * whose primary concept is this one, easiest first, with the learner's statistics computed in one
 * batch (`exerciseStats`).
 *
 * Leak rules: only `usage: practice` exercises are listed (assessment, diagnostic and project items
 * stay unseen until they are served), exercises of an assessment in progress are left out, and the
 * statistics already ignore that assessment's attempts.
 */
export class RelatedExercisesService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;

  constructor(deps: { userDb: UserDb; content: ContentAccess }) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
  }

  list(conceptId: string): RelatedExercises {
    const repo = this.#content.repo;
    if (!repo.getConceptDetail(conceptId)) {
      throw new AppError('NOT_FOUND', 404, '개념을 찾을 수 없습니다.', {
        details: { id: conceptId },
      });
    }
    const orm = this.#userDb.orm;
    const learnerId = ensureLearner(this.#userDb).id;
    const hidden = activeAssessmentExerciseIds(orm, learnerId);
    const exercises = repo
      .listExercisesForConcepts([conceptId], ['practice'])
      .filter((e) => !hidden.has(e.id))
      .sort((a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id));
    const stats = exerciseStats(
      orm,
      learnerId,
      exercises.map((e) => e.id),
    );
    const titles = new Map<string, string>();
    for (const id of new Set(exercises.flatMap((e) => (e.lessonId ? [e.lessonId] : [])))) {
      const title = repo.getLessonPlan(id)?.title;
      if (title) titles.set(id, title);
    }
    return {
      conceptId,
      exercises: exercises.flatMap((e) => {
        const s = stats.get(e.id);
        if (!s) return [];
        return [
          {
            id: e.id,
            type: e.type,
            difficulty: e.difficulty,
            prompt: e.prompt,
            lesson: e.lessonId
              ? { id: e.lessonId, title: titles.get(e.lessonId) ?? e.lessonId }
              : null,
            stats: s,
          },
        ];
      }),
    };
  }
}
