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
  findActiveSet,
  getSet,
  insertSet,
  lastSeenAtByGroup,
  type PracticeSet,
} from '../../db/user/practice-sets.ts';
import { getLessonProgress, upsertLessonProgress } from '../../db/user/progress.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import type { ReviewService } from '../review/review-service.ts';
import type { WeaknessService } from './weakness.ts';
import { candidateOf, learnerContext, passRuleOverrides } from './engine.ts';
import { activeMisconceptionsByConcept, misconceptionTargetIds } from './signals.ts';
import { buildSetView } from './views.ts';

export interface PracticeSetServiceDeps {
  userDb: UserDb;
  content: ContentAccess;
  engine: EngineDeps;
  now: Clock;
  review: ReviewService;
  weakness: WeaknessService;
}

/** Builds and reads practice sets (learning-engine.md#연습-세트-구성). */
export class PracticeSetService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;
  readonly #engine: EngineDeps;
  readonly #now: Clock;
  readonly #review: ReviewService;
  readonly #weakness: WeaknessService;

  constructor(deps: PracticeSetServiceDeps) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
    this.#engine = deps.engine;
    this.#now = deps.now;
    this.#review = deps.review;
    this.#weakness = deps.weakness;
  }

  get(id: string): PracticeSetView {
    const { learnerId } = learnerContext(this.#userDb);
    const set = getSet(this.#userDb.orm, learnerId, id);
    if (!set)
      throw new AppError('NOT_FOUND', 404, '연습 세트를 찾을 수 없습니다.', { details: { id } });
    return this.#view(set);
  }

  create(request: CreatePracticeSetRequest): PracticeSetView {
    switch (request.kind) {
      case 'lesson':
        return this.#createLessonSet(request.lessonId);
      case 'review':
        return this.#createReviewSet();
      case 'weakness':
        return this.#createWeaknessSet(request.conceptIds);
    }
  }

  /**
   * Weakness practice (`buildWeaknessSet`). Without `conceptIds` the latest active weakness set
   * is resumed, or one is built for the automatic targets; with `conceptIds` a new set is built
   * for those concepts (an older active set stays resumable). No pass rule.
   */
  #createWeaknessSet(conceptIds: readonly string[] | undefined): PracticeSetView {
    const orm = this.#userDb.orm;
    const { learnerId } = learnerContext(this.#userDb);
    if (conceptIds === undefined) {
      const activeId = findActiveSet(orm, learnerId, 'weakness');
      const active = activeId === null ? null : getSet(orm, learnerId, activeId);
      if (active) return this.#view(active);
    }
    const setId = newId();
    const plan = this.#weakness.planSet(setId, conceptIds);
    if (!plan) {
      throw new AppError('PRACTICE_NOTHING_WEAK', 409, '지금 약점으로 볼 개념이 없습니다.', {
        details: { conceptIds: conceptIds ?? [] },
      });
    }
    if (plan.items.length === 0) {
      throw new AppError('PRACTICE_NO_EXERCISES', 409, '약점 연습에 쓸 문제가 없습니다.', {
        details: { conceptIds: plan.conceptIds },
      });
    }
    orm.transaction(() => {
      insertSet(
        orm,
        {
          id: setId,
          learnerId,
          kind: 'weakness',
          status: 'active',
          scope: {
            v: 1,
            lessonId: null,
            conceptIds: plan.conceptIds,
            rationale: JSON.parse(JSON.stringify(plan.rationale)) as Record<string, unknown>,
          },
          passRule: null,
          engineVersion: ENGINE_VERSION,
          createdAt: new Date(plan.now),
          completedAt: null,
        },
        itemRows(setId, learnerId, plan.items),
      );
    });
    return this.get(setId);
  }

  /**
   * The active review set, or a new one for today's queue (`buildReviewSet`). Review sets have no
   * pass rule; their ratings update FSRS as each concept's items are done.
   */
  #createReviewSet(): PracticeSetView {
    const orm = this.#userDb.orm;
    const { learnerId } = learnerContext(this.#userDb);
    const activeId = findActiveSet(orm, learnerId, 'review');
    const active = activeId === null ? null : getSet(orm, learnerId, activeId);
    if (active) return this.#view(active);

    const setId = newId();
    const plan = this.#review.planSet(setId);
    if (!plan) {
      throw new AppError('PRACTICE_NOTHING_DUE', 409, '오늘 복습할 개념이 없습니다.');
    }
    if (plan.items.length === 0) {
      throw new AppError('PRACTICE_NO_EXERCISES', 409, '복습에 쓸 문제가 없습니다.', {
        details: { conceptIds: plan.conceptIds },
      });
    }
    orm.transaction(() => {
      insertSet(
        orm,
        {
          id: setId,
          learnerId,
          kind: 'review',
          status: 'active',
          scope: {
            v: 1,
            lessonId: null,
            conceptIds: plan.conceptIds,
            rationale: { ...plan.rationale },
          },
          passRule: null,
          engineVersion: ENGINE_VERSION,
          createdAt: new Date(plan.now),
          completedAt: null,
        },
        itemRows(setId, learnerId, plan.items),
      );
    });
    return this.get(setId);
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
      misconceptionTargetIds: misconceptionTargetIds(
        repo,
        activeMisconceptionsByConcept(this.#engine, orm, learnerId, now),
      ),
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
