import {
  buildLessonPracticeSet,
  ENGINE_VERSION,
  type EngineDeps,
  type LessonSetConcept,
  type PlannedItem,
} from '@proginone/learning-engine';
import type { CreatePracticeSetRequest, PracticeSetView } from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import { excludedExerciseIds } from '../../db/user/exercise-records.ts';
import { newId } from '../../db/user/learners.ts';
import { loadConceptStates } from '../../db/user/learning-state.ts';
import {
  getSet,
  insertSet,
  lastSeenAtByGroup,
  type PracticeSet,
} from '../../db/user/practice-sets.ts';
import { getLessonProgress, upsertLessonProgress } from '../../db/user/progress.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { candidateOf, learnerContext, passRuleOverrides } from './engine.ts';
import { buildSetView } from './views.ts';

export interface PracticeSetServiceDeps {
  userDb: UserDb;
  content: ContentAccess;
  engine: EngineDeps;
  now: Clock;
}

/** Builds and reads practice sets (learning-engine.md#연습-세트-구성). */
export class PracticeSetService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;
  readonly #engine: EngineDeps;
  readonly #now: Clock;

  constructor(deps: PracticeSetServiceDeps) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
    this.#engine = deps.engine;
    this.#now = deps.now;
  }

  get(id: string): PracticeSetView {
    const { learnerId } = learnerContext(this.#userDb);
    const set = getSet(this.#userDb.orm, learnerId, id);
    if (!set)
      throw new AppError('NOT_FOUND', 404, '연습 세트를 찾을 수 없습니다.', { details: { id } });
    return this.#view(set);
  }

  create(request: CreatePracticeSetRequest): PracticeSetView {
    return this.#createLessonSet(request.lessonId);
  }

  #view(set: PracticeSet): PracticeSetView {
    return buildSetView(this.#userDb.orm, this.#content.repo, set);
  }

  /**
   * The active set of the lesson, or a new one (`buildLessonPracticeSet`). Candidates are the
   * lesson's practice exercises plus those of its reviewed concepts, minus reported ones and
   * types this version cannot grade. A finished set (passed or not) is not reused: asking again
   * builds the next set ("더 풀기").
   */
  #createLessonSet(lessonId: string): PracticeSetView {
    const repo = this.#content.repo;
    const orm = this.#userDb.orm;
    const lesson = repo.getLessonPlan(lessonId);
    if (!lesson) {
      throw new AppError('NOT_FOUND', 404, '단원을 찾을 수 없습니다.', {
        details: { id: lessonId },
      });
    }
    const { learnerId } = learnerContext(this.#userDb);
    const progress = getLessonProgress(orm, learnerId, lessonId);
    if (progress?.practiceSetId) {
      const active = getSet(orm, learnerId, progress.practiceSetId);
      if (active?.row.status === 'active') return this.#view(active);
    }

    const excluded = excludedExerciseIds(orm, learnerId);
    const candidates = repo
      .listPracticeExercises(lessonId, lesson.reviews)
      .filter((e) => !excluded.has(e.id))
      .map(candidateOf)
      .filter((c) => c !== null);
    const conceptIds = [...new Set([...lesson.introduces, ...lesson.reviews])];
    const concepts = repo.getConcepts(conceptIds);
    const states = loadConceptStates(orm, learnerId, conceptIds, this.#engine.fsrs);
    const setConcepts: LessonSetConcept[] = conceptIds.flatMap((id) => {
      const concept = concepts.get(id);
      if (!concept) return [];
      const state = states.get(id);
      return [{ conceptId: id, importance: concept.importance, ...(state ? { state } : {}) }];
    });

    const setId = newId();
    const now = this.#now();
    const plan = buildLessonPracticeSet(this.#engine, {
      lesson: {
        id: lesson.id,
        importance: lesson.importance,
        introduces: lesson.introduces,
        reviews: lesson.reviews,
        passRule: passRuleOverrides(lesson.passRule),
      },
      concepts: setConcepts,
      candidates,
      lastSeenAtByGroup: lastSeenAtByGroup(orm, learnerId),
      seed: setId,
      now,
    });
    if (plan.items.length === 0) {
      throw new AppError('PRACTICE_NO_EXERCISES', 409, '이 단원에는 아직 연습 문제가 없습니다.', {
        details: { lessonId },
      });
    }

    orm.transaction(() => {
      insertSet(
        orm,
        {
          id: setId,
          learnerId,
          kind: 'lesson',
          status: 'active',
          scope: {
            v: 1,
            lessonId,
            conceptIds: lesson.introduces,
            rationale: { ...plan.rationale },
          },
          passRule: { v: 1, ...plan.passRule },
          engineVersion: ENGINE_VERSION,
          createdAt: new Date(now),
          completedAt: null,
        },
        itemRows(setId, learnerId, plan.items),
      );
      upsertLessonProgress(orm, {
        learnerId,
        lessonId,
        status: progress?.status === 'completed' ? 'completed' : 'practicing',
        lastSectionId: progress?.lastSectionId ?? null,
        readProgress: progress?.readProgress ?? 0,
        practiceSetId: setId,
        startedAt: progress?.startedAt ?? new Date(now),
        completedAt: progress?.completedAt ?? null,
        contentHashSeen: progress?.contentHashSeen ?? null,
        updatedAt: new Date(now),
      });
    });
    return this.get(setId);
  }
}

/** `practice_set_items` rows of planned items. */
export function itemRows(setId: string, learnerId: string, items: readonly PlannedItem[]) {
  return items.map((item) => ({
    id: newId(),
    learnerId,
    practiceSetId: setId,
    position: item.position,
    exerciseId: item.exerciseId,
    exerciseOrigin: item.exerciseOrigin,
    reason: item.reason,
    targetConceptId: item.targetConceptId,
    status: 'pending' as const,
    finalAttemptId: null,
  }));
}
