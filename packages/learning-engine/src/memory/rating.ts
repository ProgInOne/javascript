import type { AttemptFacts, AttemptId, ConceptId, ExerciseFacts, FsrsRating } from '../types.ts';
import { observationOf } from '../mastery/evidence.ts';

/**
 * A rating waiting to be merged and applied to FSRS when the concept's items in the set are done
 * ("one rating per concept per day"). The server keeps these with the practice set.
 */
export interface PendingRating {
  readonly conceptId: ConceptId;
  readonly rating: FsrsRating;
  readonly attemptId: AttemptId;
  readonly variantGroupKey: string;
  readonly at: number;
}

/**
 * Attempt → FSRS rating (primary concept only). First matching row wins:
 * again → hard → easy → good.
 */
export function ratingForAttempt(attempt: AttemptFacts, exercise: ExerciseFacts): FsrsRating {
  const o = observationOf(attempt);
  if (o < 0.5 || attempt.solutionViewed || attempt.hintLevelMax >= 3) return 'again';
  if (
    attempt.hintLevelMax >= 1 ||
    attempt.attemptInItem >= 2 ||
    attempt.confidence === 'guess' ||
    o < 1 ||
    attempt.tutorAssisted
  ) {
    return 'hard';
  }
  if (
    attempt.confidence === 'sure' &&
    exercise.difficulty >= 3 &&
    attempt.activeMs <= exercise.estimatedSeconds * 1000
  ) {
    return 'easy';
  }
  return 'good';
}

/** Merges ratings: any `again` → `again`; else any `hard` → `hard`; all `easy` → `easy`; else `good`. */
export function aggregateRatings(ratings: readonly FsrsRating[]): FsrsRating | null {
  if (ratings.length === 0) return null;
  if (ratings.includes('again')) return 'again';
  if (ratings.includes('hard')) return 'hard';
  if (ratings.every((rating) => rating === 'easy')) return 'easy';
  return 'good';
}
