import type { EngineDeps } from '../config.ts';
import type { ConceptMemoryState } from '../types.ts';
import { clamp } from '../util/math.ts';

export interface EffectiveMastery {
  /** `score × decay`. Computed on read, never stored. */
  readonly effective: number;
  /** 0.6–1.0. */
  readonly decay: number;
  /** FSRS recall probability now, or `null` when there is no reviewed card yet. */
  readonly retrievability: number | null;
  /** `R < 0.8`: shown as "복습 필요". Time alone never demotes the stage. */
  readonly needsReview: boolean;
}

/**
 * Display mastery with forgetting: `decay = clamp(0.6 + 0.4 × R / desiredRetention, 0.6, 1)`.
 * This only reads the FSRS card; it never changes the card or the stored score.
 */
export function effectiveMastery(
  deps: EngineDeps,
  score: number,
  memory: ConceptMemoryState | null,
  now: number,
): EffectiveMastery {
  const { floor, needsReviewBelowR } = deps.config.effective;
  const unreviewed = { effective: score, decay: 1, retrievability: null, needsReview: false };
  if (memory === null) return unreviewed;
  if (memory.card.lastReviewAt === null) return unreviewed;
  const r = clamp(deps.fsrs.retrievability(memory.card, now), 0, 1);
  const decay = clamp(floor + (1 - floor) * (r / deps.config.fsrs.desiredRetention), floor, 1);
  return { effective: score * decay, decay, retrievability: r, needsReview: r < needsReviewBelowR };
}
