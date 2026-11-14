import type { EngineDeps } from '../config.ts';
import type { ReviewQueueEntry } from '../memory/review-queue.ts';
import type { ConceptId, ConceptState } from '../types.ts';
import { clamp } from '../util/math.ts';
import { tieBreakKeys } from '../util/rng.ts';
import type { ExerciseCandidate, PlannedItem, SelectionContext } from './candidates.ts';
import { pickBest, plan, primaryConceptOf, recentTypesOf } from './candidates.ts';
import type { InsufficientCandidates } from './lesson-set.ts';
import { interleave } from './order.ts';

export interface ReviewSetConcept {
  readonly conceptId: ConceptId;
  /** Module of the concept (`concepts.course_id` → module of `introduced_in_lesson_id`). */
  readonly moduleId: string;
  readonly state: ConceptState;
}

export interface ReviewSetRequest extends SelectionContext {
  /** `due` entries of {@link buildReviewQueue} (already within today's budget). */
  readonly entries: readonly ReviewQueueEntry[];
  readonly concepts: readonly ReviewSetConcept[];
  /** Candidates whose primary concept is one of the entries' concepts. */
  readonly candidates: readonly ExerciseCandidate[];
  /** Seeds tie-breaking and interleaving; use the practice set ID. */
  readonly seed: string;
}

export interface ReviewSet {
  readonly items: readonly PlannedItem[];
  readonly rationale: {
    readonly insufficientCandidates: readonly InsufficientCandidates[];
    readonly estimatedSeconds: number;
  };
}

/**
 * Builds a review set (learning-engine.md#복습-세트): per due concept one item (two after
 * `again` or below effective 60), target difficulty `clamp(maxDifficultyCorrect, 2, 4)`,
 * preferring fresh variant groups and types different from the recent ones, then interleaved so
 * the same concept never repeats back to back and a module appears at most twice in a row.
 * Review sets have no pass rule.
 */
export function buildReviewSet(deps: EngineDeps, input: ReviewSetRequest): ReviewSet {
  const { config } = deps;
  const byId = new Map(input.concepts.map((c) => [c.conceptId, c]));
  const tieBreak = tieBreakKeys(
    input.seed,
    input.candidates.map((c) => c.id),
  );
  const used = new Set<string>();
  const picked: PlannedItem[] = [];
  const insufficientCandidates: InsufficientCandidates[] = [];

  for (const entry of input.entries) {
    const concept = byId.get(entry.conceptId);
    const target = clamp(
      concept?.state.mastery.maxDifficultyCorrect ?? 0,
      config.review.minDifficulty,
      config.review.maxDifficulty,
    );
    const recent = recentTypesOf(config, concept?.state);
    let planned = 0;
    for (let n = 0; n < entry.itemCount; n++) {
      const pool = input.candidates.filter(
        (c) => primaryConceptOf(c) === entry.conceptId && !used.has(c.variantGroupKey),
      );
      const best = pickBest(config, pool, {
        targetDifficulty: target,
        inRange: (c) =>
          c.difficulty >= config.review.minDifficulty &&
          c.difficulty <= config.review.maxDifficulty,
        recentTypes: recent,
        context: input,
        tieBreak,
      });
      if (best === null) break;
      used.add(best.candidate.variantGroupKey);
      recent.push(best.candidate.type);
      picked.push(
        plan(
          best.candidate,
          best.scored,
          n === 0 ? 'review_due' : 'review_reinforce',
          entry.conceptId,
          null,
        ),
      );
      planned += 1;
    }
    if (planned < entry.itemCount) {
      insufficientCandidates.push({
        conceptId: entry.conceptId,
        requested: entry.itemCount,
        available: planned,
      });
    }
  }

  const ordered = interleave(
    picked,
    (item) => ({
      concept: item.targetConceptId,
      module: byId.get(item.targetConceptId)?.moduleId ?? '',
    }),
    (item) => tieBreak.get(item.exerciseId) ?? 0,
  ).map((item, position) => ({ ...item, position }));

  return {
    items: ordered,
    rationale: {
      insufficientCandidates,
      estimatedSeconds: ordered.reduce((sum, item) => sum + item.estimatedSeconds, 0),
    },
  };
}
