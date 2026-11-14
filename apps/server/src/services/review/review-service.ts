import {
  buildReviewQueue,
  buildReviewSet,
  endOfLocalDay,
  localDateOf,
  type EngineDeps,
  type ReviewQueueConcept,
  type ReviewQueueEntry,
} from '@proginone/learning-engine';
import type { ReviewQueue, ReviewQueueEntryView } from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import { excludedExerciseIds } from '../../db/user/exercise-records.ts';
import { dueConceptIds, lastRatings, loadConceptStates } from '../../db/user/learning-state.ts';
import { lastSeenAtByGroup } from '../../db/user/practice-sets.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { candidateOf, learnerContext } from '../practice/engine.ts';

/**
 * Minutes of review per day. Goals ("오늘의 학습" time split) are not in v0.1, so the queue uses
 * a fixed budget that a request may override.
 */
export const DEFAULT_REVIEW_BUDGET_MINUTES = 20;

export interface ReviewServiceDeps {
  userDb: UserDb;
  content: ContentAccess;
  engine: EngineDeps;
  now: Clock;
}

/** Today's review queue and review sets (learning-engine.md#복습-세트). */
export class ReviewService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;
  readonly #engine: EngineDeps;
  readonly #now: Clock;

  constructor(deps: ReviewServiceDeps) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
    this.#engine = deps.engine;
    this.#now = deps.now;
  }

  /**
   * `buildReviewQueue` over cards due before the end of the learner's day. Concepts missing from
   * the content pack (orphans) are left out.
   */
  #engineQueue(budgetMinutes: number) {
    const orm = this.#userDb.orm;
    const repo = this.#content.repo;
    const now = this.#now();
    const { learnerId, dayBoundary } = learnerContext(this.#userDb);
    const ids = dueConceptIds(orm, learnerId, endOfLocalDay(now, dayBoundary));
    const concepts = repo.getConcepts(ids);
    const states = loadConceptStates(orm, learnerId, ids, this.#engine.fsrs);
    const ratings = lastRatings(orm, learnerId, ids);
    const input: ReviewQueueConcept[] = ids.flatMap((id) => {
      const concept = concepts.get(id);
      const state = states.get(id);
      if (!concept || !state?.memory) return [];
      return [
        {
          memory: state.memory,
          mastery: state.mastery,
          importance: concept.importance,
          lastRating: ratings.get(id) ?? null,
        },
      ];
    });
    const queue = buildReviewQueue(this.#engine, {
      concepts: input,
      budgetMinutes,
      now,
      dayBoundary,
    });
    return { queue, now, learnerId, dayBoundary, concepts, states, repo };
  }

  queue(budgetMinutes = DEFAULT_REVIEW_BUDGET_MINUTES): ReviewQueue {
    const { queue, now, dayBoundary, concepts } = this.#engineQueue(budgetMinutes);
    const view = (e: ReviewQueueEntry): ReviewQueueEntryView => ({
      conceptId: e.conceptId,
      title: concepts.get(e.conceptId)?.title ?? e.conceptId,
      dueAt: e.dueAt,
      overdue: e.overdue,
      overdueDays: e.overdueDays,
      itemCount: e.itemCount,
      estimatedSeconds: e.estimatedSeconds,
      priority: e.priority,
    });
    return {
      date: localDateOf(now, dayBoundary),
      budgetMinutes,
      due: queue.due.map(view),
      deferred: queue.deferred.map(view),
      estimatedMinutes: Math.round(queue.due.reduce((s, e) => s + e.estimatedSeconds, 0) / 60),
    };
  }

  /** Number of reviews planned for today (dashboard). */
  dueCount(): number {
    return this.#engineQueue(DEFAULT_REVIEW_BUDGET_MINUTES).queue.due.length;
  }

  /**
   * Plans a review set for today's due concepts with `buildReviewSet`, or null when nothing is
   * due. The caller stores the set.
   */
  planSet(seed: string) {
    const { queue, now, learnerId, concepts, states, repo } = this.#engineQueue(
      DEFAULT_REVIEW_BUDGET_MINUTES,
    );
    if (queue.due.length === 0) return null;
    const orm = this.#userDb.orm;
    const ids = queue.due.map((e) => e.conceptId);
    const excluded = excludedExerciseIds(orm, learnerId);
    const candidates = repo
      .listPracticeExercisesForConcepts(ids)
      .filter((e) => !excluded.has(e.id))
      .map(candidateOf)
      .filter((c) => c !== null);
    const plan = buildReviewSet(this.#engine, {
      entries: queue.due,
      concepts: ids.flatMap((id) => {
        const state = states.get(id);
        const concept = concepts.get(id);
        return state && concept ? [{ conceptId: id, moduleId: concept.moduleId, state }] : [];
      }),
      candidates,
      lastSeenAtByGroup: lastSeenAtByGroup(orm, learnerId),
      seed,
      now,
    });
    return { learnerId, now, conceptIds: ids, items: plan.items, rationale: plan.rationale };
  }
}
