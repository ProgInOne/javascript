/**
 * Domain types of the learning engine.
 *
 * Inputs are plain data the server reads from content.db / user.db; outputs are plain data the
 * server writes back in one transaction. Field names follow docs/design/data-model.md (camelCase
 * of the column names) so the mapping stays mechanical. Times are epoch milliseconds (UTC);
 * calendar days are `LocalDate` strings in the learner's time zone (see util/time.ts).
 */

export type ConceptId = string;
export type ExerciseId = string;
export type AttemptId = string;
/** `YYYY-MM-DD` in the learner's time zone, with the day starting at `dayStartHour`. */
export type LocalDate = string;

export const MASTERY_STAGES = [
  'not_started',
  'introduced',
  'practicing',
  'proficient',
  'mastered',
] as const;
export type MasteryStage = (typeof MASTERY_STAGES)[number];

export type Outcome = 'correct' | 'partial' | 'incorrect' | 'error';
export type Confidence = 'sure' | 'unsure' | 'guess';
export type ExerciseCategory = 'recognition' | 'recall' | 'production';
export type Importance = 'core' | 'standard' | 'minor';
export type ExerciseOrigin = 'authored' | 'template' | 'generated';
/** `practice_sets.kind`. Decides the learning context (`W_ctx`). */
export type PracticeSetKind =
  'lesson' | 'review' | 'weakness' | 'assessment' | 'remedial' | 'extra' | 'custom' | 'diagnostic';
export type Difficulty = 1 | 2 | 3 | 4 | 5;
export type HintLevel = 0 | 1 | 2 | 3;

/** `exercise_concepts` row (or a template's `concepts_json` entry). */
export interface ExerciseConceptTag {
  readonly conceptId: ConceptId;
  /** 1.0 for the primary concept, 0.3–0.5 for secondary concepts. */
  readonly weight: number;
  readonly isPrimary: boolean;
}

/**
 * Exercise metadata the engine needs. The server builds it from `exercises` (or a template
 * variant) plus the exercise-kit type registry (`category`, `weightOverride`).
 */
export interface ExerciseFacts {
  readonly id: ExerciseId;
  /** `ExerciseType` id, e.g. `predict_output`. */
  readonly type: string;
  readonly category: ExerciseCategory;
  /** `ExerciseTypeDef.weightOverride` (e.g. `true_false` 0.5). Replaces the category weight. */
  readonly typeWeightOverride?: number;
  readonly difficulty: Difficulty;
  readonly estimatedSeconds: number;
  /** Resolved with {@link resolveVariantGroupKey}; stored as `attempts.variant_group_key`. */
  readonly variantGroupKey: string;
  readonly concepts: readonly ExerciseConceptTag[];
}

/**
 * The part of a graded attempt the engine reads. This is deliberately a minimal shape so the
 * engine does not depend on exercise-kit: the server maps the grader result onto it.
 *
 * Attempts whose run did not finish for sandbox reasons (`crashed`/`aborted`) are stored with
 * `engine_applied = 0` and must not be passed to the engine at all.
 */
export interface AttemptFacts {
  readonly attemptId: AttemptId;
  readonly outcome: Outcome;
  /** Grader score 0–1. Used as the observation for `partial`. */
  readonly score: number;
  /** `null` when the learner was not asked (setting off, or a later submission of a task). */
  readonly confidence: Confidence | null;
  /** Highest hint level opened before this attempt. */
  readonly hintLevelMax: HintLevel;
  readonly solutionViewed: boolean;
  readonly tutorAssisted: boolean;
  /** Attempt number inside the same practice set item, starting at 1. */
  readonly attemptInItem: number;
  readonly activeMs: number;
  /** Kind of the practice set the attempt belongs to; `null` outside a set. */
  readonly setKind: PracticeSetKind | null;
  /**
   * Concepts that the chosen wrong option's misconceptions point to. A wrong answer on a
   * secondary concept is only halved when that concept is not listed here.
   */
  readonly misconceptionConceptIds?: readonly ConceptId[];
  readonly submittedAt: number;
}

/** `concept_mastery` row. */
export interface ConceptMasteryState {
  readonly conceptId: ConceptId;
  /** 0–100. */
  readonly score: number;
  readonly stage: MasteryStage;
  readonly evidenceWeightSum: number;
  /** `distinct_types_correct_json`: types with a qualifying primary correct answer. */
  readonly distinctTypesCorrect: readonly string[];
  /** Highest difficulty with a qualifying primary correct answer (0 = none). */
  readonly maxDifficultyCorrect: number;
  readonly consecutiveFailures: number;
  readonly lastAttemptAt: number | null;
  readonly stageChangedAt: number | null;
}

/**
 * Gate-relevant summary of one attempt for one concept. The engine returns it inside the
 * evidence breakdown (`breakdown_json.fact`); the server passes the stored facts back as
 * {@link ConceptState.history} so gates and `W_rep` can be evaluated without re-reading attempts.
 */
export interface EvidenceFact {
  readonly attemptId: AttemptId;
  readonly at: number;
  readonly exerciseId: ExerciseId;
  readonly exerciseType: string;
  readonly difficulty: Difficulty;
  readonly variantGroupKey: string;
  readonly isPrimary: boolean;
  /** Observation `o ≥ 0.5`. */
  readonly correct: boolean;
  /** `W_hint × W_conf × W_try` for the correct branch (only meaningful when `correct`). */
  readonly credit: number;
  /** First attempt in the item, no hint, no solution, no tutor. */
  readonly unassisted: boolean;
  readonly setKind: PracticeSetKind | null;
  /** Final evidence weight `w`. */
  readonly weight: number;
}

/** A `review_logs` row joined with the variant group keys of its source attempts. */
export interface ReviewFact {
  readonly reviewedAt: number;
  readonly rating: FsrsRating;
  readonly variantGroupKeys: readonly string[];
}

/** Everything the engine needs to know about one concept for the learner. */
export interface ConceptState {
  readonly mastery: ConceptMasteryState;
  /** Stored evidence facts for this concept (any order; all time). */
  readonly history: readonly EvidenceFact[];
  /** FSRS reviews for this concept (any order; all time). */
  readonly reviews: readonly ReviewFact[];
  /** `concept_memory` row, or `null` before the first card exists. */
  readonly memory: ConceptMemoryState | null;
}

/** `concept_memory` row with its card restored through {@link FsrsPort.fromRaw}. */
export interface ConceptMemoryState {
  readonly conceptId: ConceptId;
  readonly card: FsrsCard;
  readonly fsrsVersion: string;
  readonly suspended: boolean;
}

// ── FSRS port ─────────────────────────────────────────────────────────────

export type FsrsRating = 'again' | 'hard' | 'good' | 'easy';
export type FsrsCardState = 'new' | 'learning' | 'review' | 'relearning';

export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = Readonly<Record<string, JsonValue>>;

export interface FsrsCard {
  /** Library card in a JSON-safe form (dates as epoch ms). Stored as `concept_memory.card_json`. */
  readonly raw: JsonObject;
  readonly dueAt: number;
  /** Days. */
  readonly stability: number;
  /** FSRS difficulty (not the exercise difficulty). */
  readonly difficulty: number;
  readonly state: FsrsCardState;
  readonly lastReviewAt: number | null;
  readonly reps: number;
  readonly lapses: number;
}

export interface FsrsLog {
  /** Library review log in a JSON-safe form. Stored as `review_logs.revlog_json`. */
  readonly raw: JsonObject;
  /** Fractional days since the previous review (0 for the first). */
  readonly elapsedDays: number;
  /** Interval that was scheduled before this review, in days. */
  readonly scheduledDays: number;
  readonly stateBefore: FsrsCardState;
}

/** What the engine expects from FSRS. `fsrs-adapter.ts` implements it with ts-fsrs. */
export interface FsrsPort {
  /** e.g. `FSRS-7`. Stored as `concept_memory.fsrs_version`. */
  readonly modelVersion: string;
  /** `cardId` seeds the library's fuzz, so the concept ID keeps scheduling deterministic. */
  newCard(cardId: string, now: number): FsrsCard;
  review(card: FsrsCard, rating: FsrsRating, now: number): { card: FsrsCard; log: FsrsLog };
  /** Recall probability 0–1 at `now`. */
  retrievability(card: FsrsCard, now: number): number;
  /** Rebuilds a card from `concept_memory.card_json`. Throws on malformed input. */
  fromRaw(raw: unknown): FsrsCard;
}
