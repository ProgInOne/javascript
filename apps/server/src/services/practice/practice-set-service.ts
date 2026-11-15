import {
  buildAssessmentSet,
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
  findActiveSets,
  getSet,
  inActiveAssessment,
  insertSet,
  lastSeenAtByGroup,
  listItems,
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

/** Item reason of a "다시 풀기" item (an `extra` set from the mistake notes). */
export const MISTAKE_RETRY_REASON = 'mistake_retry';

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
      case 'assessment':
        return this.#createAssessmentSet(request.lessonId);
      case 'extra':
        return this.#createExtraSet(request.exerciseIds);
    }
  }

  /**
   * "다시 풀기" from the mistake notes: an `extra` set of exactly these exercises (no pass rule;
   * the usual adaptation and relearning apply). The latest active extra set with the same
   * exercises is resumed. Exercises that cannot be retried outside their context are refused:
   * assessment-only items (a retake must stay unseen), items of an assessment in progress,
   * reported ones and types this version cannot grade.
   */
  #createExtraSet(exerciseIds: readonly string[]): PracticeSetView {
    const repo = this.#content.repo;
    const orm = this.#userDb.orm;
    const { learnerId } = learnerContext(this.#userDb);
    const found = new Map(repo.getExercises(exerciseIds).map((e) => [e.id, e]));
    const missing = exerciseIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new AppError('NOT_FOUND', 404, '문제를 찾을 수 없습니다.', {
        details: { exerciseIds: missing },
      });
    }
    const locked = exerciseIds.filter(
      (id) => found.get(id)?.usage === 'assessment' || inActiveAssessment(orm, learnerId, id),
    );
    if (locked.length > 0) {
      throw new AppError(
        'EXERCISE_LOCKED_IN_ASSESSMENT',
        403,
        '단원 평가 문항은 평가 안에서만 풀 수 있습니다.',
        { details: { exerciseIds: locked } },
      );
    }
    const excluded = excludedExerciseIds(orm, learnerId);
    const candidates = exerciseIds.flatMap((id) => {
      const exercise = found.get(id);
      const candidate = exercise && !excluded.has(id) ? candidateOf(exercise) : null;
      return candidate ? [candidate] : [];
    });
    if (candidates.length < exerciseIds.length) {
      throw new AppError('PRACTICE_NO_EXERCISES', 409, '다시 풀 수 없는 문제가 있습니다.', {
        details: {
          exerciseIds: exerciseIds.filter((id) => !candidates.some((c) => c.id === id)),
        },
      });
    }

    const key = [...exerciseIds].sort().join('\n');
    for (const id of findActiveSets(orm, learnerId, 'extra')) {
      const active = getSet(orm, learnerId, id);
      const ids = active ? listItems(orm, active.row.id).map((i) => i.exerciseId) : [];
      // Compare the exercises the set started with (adaptation may append follow-ups).
      if (active && [...ids.slice(0, exerciseIds.length)].sort().join('\n') === key) {
        return this.#view(active);
      }
    }

    const setId = newId();
    const now = this.#now();
    const items = candidates.map((c, position) => ({
      id: newId(),
      learnerId,
      practiceSetId: setId,
      position,
      exerciseId: c.id,
      exerciseOrigin: c.origin,
      reason: MISTAKE_RETRY_REASON,
      targetConceptId: c.concepts.find((x) => x.isPrimary)?.conceptId ?? null,
      status: 'pending' as const,
      finalAttemptId: null,
    }));
    orm.transaction(() => {
      insertSet(
        orm,
        {
          id: setId,
          learnerId,
          kind: 'extra',
          status: 'active',
          scope: {
            v: 1,
            lessonId: null,
            conceptIds: [
              ...new Set(items.flatMap((i) => (i.targetConceptId ? [i.targetConceptId] : []))),
            ],
            rationale: { source: 'mistake_notes', exerciseIds: [...exerciseIds] },
          },
          passRule: null,
          engineVersion: ENGINE_VERSION,
          createdAt: new Date(now),
          completedAt: null,
        },
        items,
      );
    });
    return this.get(setId);
  }

  /**
   * The active attempt of a unit assessment, or a new one (`buildAssessmentSet`). Candidates are
   * the assessment's own items minus reported and ungradable ones; no adaptation, no pass rule
   * (the pass ratio is kept in the scope). A finished attempt is not reused: asking again is a
   * retake, which prefers items the learner has not seen.
   */
  #createAssessmentSet(lessonId: string): PracticeSetView {
    const repo = this.#content.repo;
    const orm = this.#userDb.orm;
    const lesson = repo.getLessonPlan(lessonId);
    if (!lesson) {
      throw new AppError('NOT_FOUND', 404, '단원을 찾을 수 없습니다.', {
        details: { id: lessonId },
      });
    }
    const assessment = repo.getAssessment(lessonId);
    if (!assessment) {
      throw new AppError('PRACTICE_KIND_MISMATCH', 409, '이 단원은 단원 평가가 아닙니다.', {
        details: { lessonId, expected: 'lesson' },
      });
    }
    const { learnerId } = learnerContext(this.#userDb);
    const progress = getLessonProgress(orm, learnerId, lessonId);
    if (progress?.practiceSetId) {
      const active = getSet(orm, learnerId, progress.practiceSetId);
      if (active?.row.status === 'active' && active.row.kind === 'assessment') {
        return this.#view(active);
      }
    }

    const excluded = excludedExerciseIds(orm, learnerId);
    const candidates = repo
      .getExercises(assessment.exerciseIds)
      .filter((e) => e.usage === 'assessment' && !excluded.has(e.id))
      .map(candidateOf)
      .filter((c) => c !== null);
    const concepts = repo.getConcepts(assessment.conceptIds);
    const setId = newId();
    const now = this.#now();
    const plan = buildAssessmentSet(this.#engine, {
      assessment: {
        id: assessment.id,
        concepts: assessment.conceptIds.flatMap((id) => {
          const concept = concepts.get(id);
          return concept ? [{ conceptId: id, importance: concept.importance }] : [];
        }),
        itemCount: assessment.itemCount,
      },
      candidates,
      lastSeenAtByGroup: lastSeenAtByGroup(orm, learnerId),
      seed: setId,
      now,
    });
    if (plan.items.length === 0) {
      throw new AppError('PRACTICE_NO_EXERCISES', 409, '이 단원 평가에는 아직 문항이 없습니다.', {
        details: { lessonId },
      });
    }

    orm.transaction(() => {
      insertSet(
        orm,
        {
          id: setId,
          learnerId,
          kind: 'assessment',
          status: 'active',
          scope: {
            v: 1,
            lessonId,
            conceptIds: assessment.conceptIds,
            rationale: { ...plan.rationale },
            passRatio: assessment.passRatio,
          },
          passRule: null,
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
    if (repo.getAssessment(lessonId)) {
      throw new AppError(
        'PRACTICE_KIND_MISMATCH',
        409,
        '단원 평가는 평가 세트로 풉니다(kind: assessment).',
        { details: { lessonId, expected: 'assessment' } },
      );
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
