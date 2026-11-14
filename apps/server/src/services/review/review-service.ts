import {
  buildReviewQueue,
  dailyReviewMinutes,
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
import { loadGoal } from '../learning/planning-input.ts';
import { candidateOf, learnerContext } from '../practice/engine.ts';
import { activeMisconceptionsByConcept, misconceptionTargetIds } from '../practice/signals.ts';

/** Upper bound for building the full queue (the `maxDailyReviews` cap still applies). */
const UNBOUNDED_MINUTES = 24 * 60;

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
   * `buildReviewQueue` over cards due before the end of the learner's day, except concepts already
   * reviewed today (D-029). Concepts missing from the content pack (orphans) are left out.
   */
  #engineQueue(requestedBudget?: number) {
    const orm = this.#userDb.orm;
    const repo = this.#content.repo;
    const now = this.#now();
    const { learnerId, dayBoundary } = learnerContext(this.#userDb);
    const ids = dueConceptIds(orm, learnerId, endOfLocalDay(now, dayBoundary));
    const today = localDateOf(now, dayBoundary);
    const concepts = repo.getConcepts(ids);
    const states = loadConceptStates(orm, learnerId, ids, this.#engine.fsrs);
    const ratings = lastRatings(orm, learnerId, ids);
    const active = activeMisconceptionsByConcept(this.#engine, orm, learnerId, now);
    const input: ReviewQueueConcept[] = ids.flatMap((id) => {
      const concept = concepts.get(id);
      const state = states.get(id);
      if (!concept || !state?.memory) return [];
      // Already rated today: another rating today would be skipped by flushPendingRatings, so
      // showing it again only repeats work (D-029).
      const last = state.memory.card.lastReviewAt;
      if (last !== null && localDateOf(last, dayBoundary) === today) return [];
      return [
        {
          memory: state.memory,
          mastery: state.mastery,
          importance: concept.importance,
          lastRating: ratings.get(id) ?? null,
          activeMisconceptions:
            (active.get(id)?.confirmed.length ?? 0) + (active.get(id)?.suspected.length ?? 0),
        },
      ];
    });
    const build = (budgetMinutes: number) =>
      buildReviewQueue(this.#engine, { concepts: input, budgetMinutes, now, dayBoundary });
    // Every due review in priority order (for today's plan), then the queue within the budget:
    // the goal's review share of the day unless a request asks for another budget.
    const full = build(UNBOUNDED_MINUTES);
    const all = [...full.due, ...full.deferred];
    const budgetMinutes =
      requestedBudget ??
      Math.round(
        dailyReviewMinutes(this.#engine, loadGoal(this.#engine, orm, learnerId).goal, all),
      );
    const queue = build(budgetMinutes);
    return {
      queue,
      all,
      budgetMinutes,
      now,
      learnerId,
      dayBoundary,
      concepts,
      states,
      repo,
      active,
    };
  }

  /** Every review due today in priority order, not cut to a budget (today's plan). */
  allDue(): { entries: ReviewQueueEntry[]; titles: Map<string, string> } {
    const { all, concepts } = this.#engineQueue();
    return {
      entries: all,
      titles: new Map(
        all.map((e) => [e.conceptId, concepts.get(e.conceptId)?.title ?? e.conceptId]),
      ),
    };
  }

  queue(requestedBudget?: number): ReviewQueue {
    const { queue, budgetMinutes, now, dayBoundary, concepts } = this.#engineQueue(requestedBudget);
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
    return this.#engineQueue().queue.due.length;
  }

  /**
   * Plans a review set for today's due concepts with `buildReviewSet`, or null when nothing is
   * due. The caller stores the set.
   */
  planSet(seed: string) {
    const { queue, now, learnerId, concepts, states, repo, active } = this.#engineQueue();
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
      misconceptionTargetIds: misconceptionTargetIds(repo, active),
      seed,
      now,
    });
    return { learnerId, now, conceptIds: ids, items: plan.items, rationale: plan.rationale };
  }
}
