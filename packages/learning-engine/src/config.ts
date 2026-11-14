import type { ExerciseCategory, FsrsPort, Importance } from './types.ts';

/**
 * Version of the formulas and coefficients. Bump it (and record it in CHANGELOG.md) whenever a
 * coefficient or rule changes; every stored result carries the version that computed it.
 */
export const ENGINE_VERSION = '1.0.0';

/** Weights for the correct (`o ≥ 0.5`) and incorrect branch of a factor. */
export interface BranchWeights {
  readonly correct: number;
  readonly incorrect: number;
}

/** All coefficients of the engine. Values follow docs/design/learning-engine.md. */
export interface EngineConfig {
  readonly mastery: {
    /** Base learning rate `α`. */
    readonly alpha: number;
    /** Largest fraction of the gap one attempt can close (`STEP_MAX`). */
    readonly stepMax: number;
    readonly typeWeight: Readonly<Record<ExerciseCategory, number>>;
    /** Index = difficulty − 1 (L1…L5). */
    readonly difficultyWeight: readonly [number, number, number, number, number];
    /** Index = attempt in item − 1; the last entry applies to every later attempt. */
    readonly tryWeight: readonly BranchWeights[];
    /** Index = hint level 0…3. */
    readonly hintWeight: readonly [BranchWeights, BranchWeights, BranchWeights, BranchWeights];
    readonly solutionViewedWeight: BranchWeights;
    /** Extra multiplier after a tutor conversation (correct branch only). */
    readonly tutorAssistedCorrect: number;
    readonly confidenceWeight: {
      readonly sure: BranchWeights;
      readonly unsure: BranchWeights;
      readonly guess: BranchWeights;
      readonly none: BranchWeights;
    };
    /** Production exercises only: `active_ms > slowFactor × estimated` → `slowCorrect`. */
    readonly time: { readonly slowFactor: number; readonly slowCorrect: number };
    /** `W_rep` by `k` (index; last entry for larger k) inside `windowMs`, correct branch only. */
    readonly repetition: { readonly windowMs: number; readonly weights: readonly number[] };
    /** `W_ctx` for assessment sets; other contexts are 1.0. */
    readonly assessmentContext: BranchWeights;
    /** Extra multiplier for a wrong answer on a secondary concept. */
    readonly secondaryIncorrect: number;
  };
  readonly gates: {
    readonly practicingEvidenceSum: number;
    readonly qualifyingCredit: number;
    readonly proficient: {
      readonly effective: number;
      readonly distinctTypes: number;
      readonly distinctVariantGroups: number;
      readonly minDifficulty: number;
      readonly evidenceSum: number;
    };
    readonly mastered: {
      readonly effective: number;
      readonly spacedReviews: number;
      /** Local calendar days between a successful review and the review before it. */
      readonly spacedReviewMinDays: number;
      readonly independentMinDifficulty: number;
      readonly recentReviewsWithoutAgain: number;
    };
    /** Demotion when `effective` drops this far below the stage's entry threshold. */
    readonly demotionMargin: number;
  };
  readonly effective: {
    readonly floor: number;
    readonly needsReviewBelowR: number;
  };
  readonly fsrs: {
    readonly version: 'FSRS-7';
    readonly desiredRetention: number;
    readonly maximumInterval: number;
    readonly enableFuzz: boolean;
    readonly enableShortTerm: boolean;
  };
  readonly importanceFactor: Readonly<Record<Importance, number>>;
  readonly review: {
    /** Daily cap on concepts in the review queue (`maxDailyReviews`). */
    readonly maxDailyReviews: number;
    /** Seconds per review item when the server gives no estimate. */
    readonly defaultItemSeconds: number;
    /** A second item is planned when `effective` is below this (or the last rating was again). */
    readonly extraItemBelowEffective: number;
    /** Target difficulty of review items: `clamp(maxDifficultyCorrect, min, max)`. */
    readonly minDifficulty: number;
    readonly maxDifficulty: number;
  };
}

const DAY_MS = 86_400_000;

export const defaultEngineConfig: EngineConfig = {
  mastery: {
    alpha: 0.25,
    stepMax: 0.5,
    typeWeight: { recognition: 0.7, recall: 1.0, production: 1.3 },
    difficultyWeight: [0.6, 0.8, 1.0, 1.2, 1.4],
    tryWeight: [
      { correct: 1.0, incorrect: 1.0 },
      { correct: 0.7, incorrect: 0.6 },
      { correct: 0.5, incorrect: 0.4 },
    ],
    hintWeight: [
      { correct: 1.0, incorrect: 1.0 },
      { correct: 0.8, incorrect: 1.0 },
      { correct: 0.55, incorrect: 1.0 },
      { correct: 0.3, incorrect: 1.0 },
    ],
    solutionViewedWeight: { correct: 0.1, incorrect: 0.5 },
    tutorAssistedCorrect: 0.8,
    confidenceWeight: {
      sure: { correct: 1.0, incorrect: 1.2 },
      unsure: { correct: 0.85, incorrect: 1.0 },
      guess: { correct: 0.5, incorrect: 0.7 },
      none: { correct: 0.9, incorrect: 1.0 },
    },
    time: { slowFactor: 3, slowCorrect: 0.85 },
    repetition: { windowMs: 14 * DAY_MS, weights: [1.0, 0.5, 0.25] },
    assessmentContext: { correct: 1.2, incorrect: 1.0 },
    secondaryIncorrect: 0.5,
  },
  gates: {
    practicingEvidenceSum: 1.0,
    qualifyingCredit: 0.5,
    proficient: {
      effective: 70,
      distinctTypes: 2,
      distinctVariantGroups: 3,
      minDifficulty: 3,
      evidenceSum: 3.0,
    },
    mastered: {
      effective: 85,
      spacedReviews: 2,
      spacedReviewMinDays: 7,
      independentMinDifficulty: 4,
      recentReviewsWithoutAgain: 3,
    },
    demotionMargin: 10,
  },
  effective: { floor: 0.6, needsReviewBelowR: 0.8 },
  fsrs: {
    version: 'FSRS-7',
    desiredRetention: 0.9,
    maximumInterval: 365,
    enableFuzz: true,
    enableShortTerm: false,
  },
  importanceFactor: { core: 1.3, standard: 1.0, minor: 0.8 },
  review: {
    maxDailyReviews: 20,
    defaultItemSeconds: 90,
    extraItemBelowEffective: 60,
    minDifficulty: 2,
    maxDifficulty: 4,
  },
};

/** Dependencies every engine function receives. The FSRS port is created once at server start. */
export interface EngineDeps {
  readonly config: EngineConfig;
  readonly fsrs: FsrsPort;
}
