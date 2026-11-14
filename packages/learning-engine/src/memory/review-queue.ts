import type { EngineDeps } from '../config.ts';
import { effectiveMastery } from '../mastery/effective.ts';
import type {
  ConceptId,
  ConceptMasteryState,
  ConceptMemoryState,
  FsrsRating,
  Importance,
} from '../types.ts';
import type { DayBoundary } from '../util/time.ts';
import { DAY_MS, daysBetween, endOfLocalDay, localDateOf } from '../util/time.ts';

export interface ReviewQueueConcept {
  readonly memory: ConceptMemoryState;
  readonly mastery: ConceptMasteryState;
  readonly importance: Importance;
  /** Active (`suspected`/`confirmed`) content misconceptions of the concept. Defaults to 0. */
  readonly activeMisconceptions?: number;
  /** Rating of the latest review (`review_logs`), or `null`. */
  readonly lastRating: FsrsRating | null;
  /** Expected seconds per review item (e.g. mean `estimated_seconds` of the candidates). */
  readonly estimatedSecondsPerItem?: number;
}

export interface ReviewQueueEntry {
  readonly conceptId: ConceptId;
  readonly priority: number;
  readonly factors: {
    readonly overdueRatio: number;
    readonly importanceFactor: number;
    readonly misconceptionFactor: number;
  };
  readonly dueAt: number;
  /** Due before today (learner-local): "예정일이 지났어요". */
  readonly overdue: boolean;
  /** Local days the review is late (0 when due today). */
  readonly overdueDays: number;
  /** 2 when the last rating was `again` or `effective < 60`, else 1. */
  readonly itemCount: 1 | 2;
  readonly estimatedSeconds: number;
}

export interface ReviewQueue {
  /** Reviews for today, highest priority first. */
  readonly due: readonly ReviewQueueEntry[];
  /** Due but over today's budget: shown as "밀림"; `concept_memory.due_at` is unchanged. */
  readonly deferred: readonly ReviewQueueEntry[];
}

/**
 * Today's review queue. Due = `due_at` before the end of the learner's day and not suspended.
 * `priority = overdueRatio × importanceFactor × (1 + 0.5 × activeMisconceptions)` with
 * `overdueRatio = (now − lastReviewAt) / max(scheduledInterval, 1 day)`.
 * Entries are taken in priority order until the minutes budget or `maxDailyReviews` is reached;
 * the first entry is always taken when the budget is positive.
 */
export function buildReviewQueue(
  deps: EngineDeps,
  input: {
    readonly concepts: readonly ReviewQueueConcept[];
    readonly budgetMinutes: number;
    readonly now: number;
    readonly dayBoundary: DayBoundary;
  },
): ReviewQueue {
  const { config } = deps;
  const { now, dayBoundary } = input;
  const endOfDay = endOfLocalDay(now, dayBoundary);
  const today = localDateOf(now, dayBoundary);

  const entries: ReviewQueueEntry[] = [];
  for (const concept of input.concepts) {
    const { memory } = concept;
    if (memory.suspended || memory.card.dueAt >= endOfDay) continue;
    const lastReviewAt = memory.card.lastReviewAt ?? memory.card.dueAt;
    const interval = Math.max(memory.card.dueAt - lastReviewAt, DAY_MS);
    const overdueRatio = Math.max(0, now - lastReviewAt) / interval;
    const importanceFactor = config.importanceFactor[concept.importance];
    const misconceptionFactor = 1 + 0.5 * (concept.activeMisconceptions ?? 0);
    const { effective } = effectiveMastery(deps, concept.mastery.score, memory, now);
    const itemCount: 1 | 2 =
      concept.lastRating === 'again' || effective < config.review.extraItemBelowEffective ? 2 : 1;
    const overdueDays = Math.max(
      0,
      daysBetween(localDateOf(memory.card.dueAt, dayBoundary), today),
    );
    entries.push({
      conceptId: memory.conceptId,
      priority: overdueRatio * importanceFactor * misconceptionFactor,
      factors: { overdueRatio, importanceFactor, misconceptionFactor },
      dueAt: memory.card.dueAt,
      overdue: overdueDays > 0,
      overdueDays,
      itemCount,
      estimatedSeconds:
        itemCount * (concept.estimatedSecondsPerItem ?? config.review.defaultItemSeconds),
    });
  }
  entries.sort(
    (a, b) =>
      b.priority - a.priority ||
      a.dueAt - b.dueAt ||
      (a.conceptId < b.conceptId ? -1 : a.conceptId > b.conceptId ? 1 : 0),
  );

  const budgetSeconds = Math.max(0, input.budgetMinutes) * 60;
  const due: ReviewQueueEntry[] = [];
  const deferred: ReviewQueueEntry[] = [];
  let used = 0;
  let full = budgetSeconds === 0;
  for (const entry of entries) {
    const fits =
      due.length === 0 ? budgetSeconds > 0 : used + entry.estimatedSeconds <= budgetSeconds;
    if (!full && fits && due.length < config.review.maxDailyReviews) {
      due.push(entry);
      used += entry.estimatedSeconds;
    } else {
      // Keep strict priority order: once something does not fit, the rest waits for tomorrow.
      full = true;
      deferred.push(entry);
    }
  }
  return { due, deferred };
}
