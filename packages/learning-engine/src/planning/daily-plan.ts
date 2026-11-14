import type { EngineDeps } from '../config.ts';
import type { ReviewQueueEntry } from '../memory/review-queue.ts';
import type { WeakConceptEntry } from '../practice/weakness-set.ts';
import type { ConceptId } from '../types.ts';
import { MINUTE_MS } from '../util/time.ts';
import type { Goal, LessonEstimate, PaceResult } from './pace.ts';
import { remainingLessonMinutes } from './pace.ts';

/**
 * Today's plan (learning-engine.md#오늘의-학습-구성-builddailyplan, FR-GOAL-03).
 *
 * ```text
 * budget = max(goal.dailyMinutes − todayActiveMinutes, 10)
 * 1 review      due reviews, up to budget × 0.5 (× 0.6 with ≥ 3 days of overdue reviews)
 * 2 continue    remaining reading + practice of the lesson in progress
 * 3 new lesson  ≥ 10 minutes left and (pace behind/tight or nothing in progress)
 * 4 weakness    ≥ 8 minutes left and the weakest concept is below effective 60
 * ```
 *
 * The plan is a suggestion: what does not fit goes to `later` ("시간이 남으면").
 */

export type DailyBlockKind = 'review' | 'continue' | 'new_lesson' | 'weakness';

/** Why a block is in the plan (stable codes; the UI writes the sentence). */
export type DailyBlockReason =
  | { readonly code: 'reviews_due'; readonly count: number; readonly overdueCount: number }
  | { readonly code: 'reviews_over_budget'; readonly count: number }
  | { readonly code: 'continue_lesson'; readonly remainingMinutes: number }
  | {
      readonly code: 'new_lesson';
      readonly why: 'first_lesson' | 'nothing_in_progress' | 'pace_behind' | 'pace_tight';
    }
  | { readonly code: 'weak_concepts'; readonly topEffective: number }
  | { readonly code: 'over_budget' };

export interface DailyPlanBlock {
  readonly kind: DailyBlockKind;
  /** Planned minutes (rounded up to whole minutes). */
  readonly minutes: number;
  readonly reason: DailyBlockReason;
  /** `review`: concepts in priority order. `weakness`: target concepts. */
  readonly conceptIds: readonly ConceptId[];
  /** `continue` / `new_lesson`. */
  readonly lessonId: string | null;
  /** Only part of the lesson fits today's budget. */
  readonly partial: boolean;
}

export interface DailyPlan {
  readonly goalMinutes: number;
  readonly activeMinutesToday: number;
  readonly budgetMinutes: number;
  /** Today's goal is met: the same composition is offered as extra study. */
  readonly goalMet: boolean;
  readonly mode: 'plan' | 'extra';
  /** In order: review → continue → new lesson → weakness. */
  readonly blocks: readonly DailyPlanBlock[];
  /** "시간이 남으면": what did not fit the budget. */
  readonly later: readonly DailyPlanBlock[];
  /** Review minutes allowed today (`budget × 0.5`, or `× 0.6` with a backlog). */
  readonly reviewCapMinutes: number;
}

export interface DailyPlanInput {
  readonly goal: Goal;
  readonly todayActiveMs: number;
  /** Today's due reviews in priority order (the full queue, not cut to a budget). */
  readonly reviewQueue: readonly ReviewQueueEntry[];
  /** The most recently active lesson being read or practised. */
  readonly continueLesson: LessonEstimate | null;
  /** The next recommended lesson (not started, not in progress). */
  readonly nextLesson: LessonEstimate | null;
  /** Ranked weak concepts (`rankWeakConcepts`); the top ones become the weakness block. */
  readonly weakConcepts: readonly WeakConceptEntry[];
  readonly pace: PaceResult | null;
  /** No practice record at all yet (first run): the plan only starts the first lesson. */
  readonly firstRun: boolean;
}

function block(
  kind: DailyBlockKind,
  minutes: number,
  reason: DailyBlockReason,
  extra: Partial<Pick<DailyPlanBlock, 'conceptIds' | 'lessonId' | 'partial'>> = {},
): DailyPlanBlock {
  return {
    kind,
    minutes: Math.max(1, Math.ceil(minutes - 1e-9)),
    reason,
    conceptIds: extra.conceptIds ?? [],
    lessonId: extra.lessonId ?? null,
    partial: extra.partial ?? false,
  };
}

/**
 * Share of the day for reviews: `reviewShare` (0.5), or `reviewShareBacklog` (0.6) when the
 * overdue reviews add up to `backlogDays` days of reviews (`dailyMinutes × reviewShare` each).
 */
export function reviewShareFor(
  deps: EngineDeps,
  goal: Pick<Goal, 'dailyMinutes'>,
  queue: readonly ReviewQueueEntry[],
): number {
  const d = deps.config.dailyPlan;
  const backlog = queue.filter((e) => e.overdue).reduce((s, e) => s + e.estimatedSeconds / 60, 0);
  return backlog >= d.backlogDays * goal.dailyMinutes * d.reviewShare
    ? d.reviewShareBacklog
    : d.reviewShare;
}

/**
 * Review minutes for the day's review queue: the goal's review share. It does not shrink as the
 * day goes on, so the queue (and the header badge) stays stable; the plan's review block uses
 * what is left of today's budget.
 */
export function dailyReviewMinutes(
  deps: EngineDeps,
  goal: Pick<Goal, 'dailyMinutes'>,
  queue: readonly ReviewQueueEntry[],
): number {
  return goal.dailyMinutes * reviewShareFor(deps, goal, queue);
}

export function buildDailyPlan(deps: EngineDeps, input: DailyPlanInput): DailyPlan {
  const d = deps.config.dailyPlan;
  const { goal } = input;
  const activeMinutesToday = Math.floor(input.todayActiveMs / MINUTE_MS);
  const goalMet = activeMinutesToday >= goal.dailyMinutes;
  const budget = Math.max(goal.dailyMinutes - activeMinutesToday, d.minBudgetMinutes);
  const blocks: DailyPlanBlock[] = [];
  const later: DailyPlanBlock[] = [];
  let left = budget;

  // 1. Reviews, in priority order, within the review cap.
  const minutesOf = (e: ReviewQueueEntry) => e.estimatedSeconds / 60;
  const reviewCapMinutes = budget * reviewShareFor(deps, goal, input.reviewQueue);
  const fit: ReviewQueueEntry[] = [];
  const over: ReviewQueueEntry[] = [];
  let used = 0;
  for (const entry of input.reviewQueue) {
    // The first review always fits; then strict priority order (as in the review queue).
    if (over.length === 0 && (fit.length === 0 || used + minutesOf(entry) <= reviewCapMinutes)) {
      fit.push(entry);
      used += minutesOf(entry);
    } else {
      over.push(entry);
    }
  }
  if (fit.length > 0) {
    blocks.push(
      block(
        'review',
        used,
        {
          code: 'reviews_due',
          count: fit.length,
          overdueCount: fit.filter((e) => e.overdue).length,
        },
        { conceptIds: fit.map((e) => e.conceptId) },
      ),
    );
    left -= used;
  }
  if (over.length > 0) {
    later.push(
      block(
        'review',
        over.reduce((s, e) => s + minutesOf(e), 0),
        { code: 'reviews_over_budget', count: over.length },
        { conceptIds: over.map((e) => e.conceptId) },
      ),
    );
  }

  // 2. Continue the lesson in progress. A lesson longer than what is left is planned in part.
  const lessonBlock = (
    lesson: LessonEstimate,
    kind: 'continue' | 'new_lesson',
    reason: DailyBlockReason,
  ) => {
    const minutes = remainingLessonMinutes(lesson, input.pace?.calibration ?? 1);
    if (minutes <= 0) return;
    if (left >= minutes) {
      blocks.push(block(kind, minutes, reason, { lessonId: lesson.lessonId }));
      left -= minutes;
    } else if (left >= d.minPartialMinutes) {
      blocks.push(block(kind, left, reason, { lessonId: lesson.lessonId, partial: true }));
      later.push(
        block(
          kind,
          minutes - left,
          { code: 'over_budget' },
          { lessonId: lesson.lessonId, partial: true },
        ),
      );
      left = 0;
    } else {
      later.push(block(kind, minutes, reason, { lessonId: lesson.lessonId }));
    }
  };
  if (input.continueLesson !== null) {
    lessonBlock(input.continueLesson, 'continue', {
      code: 'continue_lesson',
      remainingMinutes: Math.ceil(remainingLessonMinutes(input.continueLesson)),
    });
  }

  // 3. A new lesson when the pace needs it or nothing is in progress.
  const paceNeedsIt = input.pace?.status === 'behind' || input.pace?.status === 'tight';
  if (input.nextLesson !== null && (paceNeedsIt || input.continueLesson === null)) {
    const why = input.firstRun
      ? 'first_lesson'
      : input.continueLesson === null
        ? 'nothing_in_progress'
        : input.pace?.status === 'behind'
          ? 'pace_behind'
          : 'pace_tight';
    if (left >= d.newLessonMinMinutes || input.firstRun) {
      lessonBlock(input.nextLesson, 'new_lesson', { code: 'new_lesson', why });
    } else {
      later.push(
        block(
          'new_lesson',
          remainingLessonMinutes(input.nextLesson),
          { code: 'new_lesson', why },
          {
            lessonId: input.nextLesson.lessonId,
          },
        ),
      );
    }
  }

  // 4. Weakness practice for the weakest concepts.
  const weak = input.weakConcepts.filter((e) => e.weakness > 0).slice(0, d.weaknessConcepts);
  const top = weak[0];
  if (!input.firstRun && top !== undefined && top.effective < d.weaknessBelowEffective) {
    const targets = weak.filter((e) => e.effective < d.weaknessBelowEffective);
    const minutes =
      (targets.length * d.weaknessItemsPerConcept * deps.config.review.defaultItemSeconds) / 60;
    const reason: DailyBlockReason = { code: 'weak_concepts', topEffective: top.effective };
    const conceptIds = targets.map((e) => e.conceptId);
    if (left >= d.weaknessMinMinutes) {
      blocks.push(block('weakness', Math.min(minutes, left), reason, { conceptIds }));
      left -= Math.min(minutes, left);
    } else {
      later.push(block('weakness', minutes, reason, { conceptIds }));
    }
  }

  return {
    goalMinutes: goal.dailyMinutes,
    activeMinutesToday,
    budgetMinutes: budget,
    goalMet,
    mode: goalMet ? 'extra' : 'plan',
    blocks,
    later,
    reviewCapMinutes,
  };
}
