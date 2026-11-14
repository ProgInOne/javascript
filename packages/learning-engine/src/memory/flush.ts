import type { EngineDeps } from '../config.ts';
import { ENGINE_VERSION } from '../config.ts';
import type { MasteryEvidenceRecord, MasteryUpdate } from '../mastery/apply.ts';
import { initialConceptState, reevaluateStage } from '../mastery/apply.ts';
import { effectiveMastery } from '../mastery/effective.ts';
import type {
  AttemptId,
  ConceptId,
  ConceptMasteryState,
  ConceptMemoryState,
  ConceptState,
  FsrsCardState,
  FsrsRating,
  JsonObject,
} from '../types.ts';
import type { DayBoundary } from '../util/time.ts';
import { localDateOf } from '../util/time.ts';
import type { PendingRating } from './rating.ts';
import { aggregateRatings } from './rating.ts';

/** A `review_logs` row without `id`/`learner_id`. */
export interface ReviewLogRecord {
  readonly conceptId: ConceptId;
  readonly rating: FsrsRating;
  /** `source_attempt_ids_json`. */
  readonly sourceAttemptIds: readonly AttemptId[];
  /** Variant group keys of the source attempts (feeds {@link ReviewFact} for gates). */
  readonly sourceVariantGroupKeys: readonly string[];
  readonly reviewedAt: number;
  readonly elapsedDays: number;
  readonly scheduledDays: number;
  readonly stateBefore: FsrsCardState;
  /** `revlog_json`. */
  readonly revlog: JsonObject;
  /** `null` for the first review of a new card. */
  readonly retrievabilityBefore: number | null;
}

export interface SkippedRating {
  readonly conceptId: ConceptId;
  readonly rating: FsrsRating;
  readonly sourceAttemptIds: readonly AttemptId[];
  readonly reason: 'already_reviewed_today';
}

export interface FlushResult {
  /** New or updated `concept_memory` rows (`card.raw` → `card_json`). */
  readonly memory: readonly ConceptMemoryState[];
  readonly reviewLogs: readonly ReviewLogRecord[];
  /** Ratings not applied because the concept was already reviewed that local day. */
  readonly skipped: readonly SkippedRating[];
  /** Stage changes caused by the reviews (`mastered` + `again`, or a completed gate). */
  readonly mastery: readonly MasteryUpdate[];
  readonly evidence: readonly MasteryEvidenceRecord[];
}

export interface FlushInput {
  /** Pending ratings to apply now (one practice set, or one concept whose items are done). */
  readonly pending: readonly PendingRating[];
  /** Current state of the concepts in `pending`. Missing concepts start empty. */
  readonly concepts: readonly ConceptState[];
  readonly now: number;
  readonly dayBoundary: DayBoundary;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * Merges pending ratings per concept and applies them to FSRS ("one rating per concept per local
 * day", except `again`). Creates the card on the first rating. Afterwards it re-reads the stage:
 * `again` on a `mastered` concept demotes to `proficient`; otherwise a newly completed gate
 * (e.g. the second spaced review) promotes. The mastery score is never changed here.
 */
export function flushPendingRatings(deps: EngineDeps, input: FlushInput): FlushResult {
  const { fsrs } = deps;
  const { now, dayBoundary } = input;
  const states = new Map(input.concepts.map((state) => [state.mastery.conceptId, state]));
  const groups = new Map<ConceptId, PendingRating[]>();
  for (const pending of input.pending) {
    const list = groups.get(pending.conceptId) ?? [];
    list.push(pending);
    groups.set(pending.conceptId, list);
  }

  const memory: ConceptMemoryState[] = [];
  const reviewLogs: ReviewLogRecord[] = [];
  const skipped: SkippedRating[] = [];
  const mastery: MasteryUpdate[] = [];
  const evidence: MasteryEvidenceRecord[] = [];
  const today = localDateOf(now, dayBoundary);

  for (const conceptId of [...groups.keys()].sort()) {
    const pending = [...(groups.get(conceptId) ?? [])].sort((a, b) => a.at - b.at);
    const rating = aggregateRatings(pending.map((p) => p.rating));
    if (rating === null) continue;
    const sourceAttemptIds = pending.map((p) => p.attemptId);
    const state = states.get(conceptId) ?? initialConceptState(conceptId);
    const lastReviewAt = state.memory?.card.lastReviewAt ?? null;

    if (
      lastReviewAt !== null &&
      localDateOf(lastReviewAt, dayBoundary) === today &&
      rating !== 'again'
    ) {
      skipped.push({ conceptId, rating, sourceAttemptIds, reason: 'already_reviewed_today' });
      continue;
    }

    const card = state.memory?.card ?? fsrs.newCard(conceptId, now);
    const retrievabilityBefore = card.lastReviewAt === null ? null : fsrs.retrievability(card, now);
    const result = fsrs.review(card, rating, now);
    const nextMemory: ConceptMemoryState = {
      conceptId,
      card: result.card,
      fsrsVersion: fsrs.modelVersion,
      suspended: state.memory?.suspended ?? false,
    };
    const sourceVariantGroupKeys = unique(pending.map((p) => p.variantGroupKey));
    memory.push(nextMemory);
    reviewLogs.push({
      conceptId,
      rating,
      sourceAttemptIds,
      sourceVariantGroupKeys,
      reviewedAt: now,
      elapsedDays: result.log.elapsedDays,
      scheduledDays: result.log.scheduledDays,
      stateBefore: result.log.stateBefore,
      revlog: result.log.raw,
      retrievabilityBefore,
    });

    const after: ConceptState = {
      ...state,
      memory: nextMemory,
      reviews: [
        ...state.reviews,
        { reviewedAt: now, rating, variantGroupKeys: sourceVariantGroupKeys },
      ],
    };
    if (rating === 'again' && state.mastery.stage === 'mastered') {
      const before = state.mastery;
      const demoted: ConceptMasteryState = { ...before, stage: 'proficient', stageChangedAt: now };
      const { effective } = effectiveMastery(deps, before.score, nextMemory, now);
      mastery.push({ conceptId, before, after: demoted, engineVersion: ENGINE_VERSION });
      evidence.push({
        conceptId,
        attemptId: null,
        kind: 'stage_gate',
        scoreBefore: before.score,
        scoreAfter: before.score,
        stageBefore: 'mastered',
        stageAfter: 'proficient',
        breakdown: {
          v: 1,
          engineVersion: ENGINE_VERSION,
          reason: 'demoted_again',
          effective,
          gates: null,
        },
        createdAt: now,
      });
      continue;
    }
    const reevaluated = reevaluateStage(deps, after, now, dayBoundary);
    if (reevaluated.update !== null) mastery.push(reevaluated.update);
    if (reevaluated.evidence !== null) evidence.push(reevaluated.evidence);
  }

  return { memory, reviewLogs, skipped, mastery, evidence };
}

/**
 * Concepts whose pending ratings are ready: the set is finished, or no pending item of the set
 * targets the concept any more.
 */
export function conceptsReadyToFlush(input: {
  readonly pending: readonly PendingRating[];
  /** Primary concepts of the set items that are still `pending`. */
  readonly remainingItemConcepts: readonly ConceptId[];
  readonly setFinished: boolean;
}): ConceptId[] {
  const remaining = new Set(input.remainingItemConcepts);
  return unique(input.pending.map((p) => p.conceptId))
    .filter((conceptId) => input.setFinished || !remaining.has(conceptId))
    .sort();
}
