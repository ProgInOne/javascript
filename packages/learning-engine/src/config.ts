import type { ExerciseCategory, ExerciseOrigin, FsrsPort, Importance } from './types.ts';

/**
 * Version of the formulas and coefficients. Bump it (and record it in CHANGELOG.md) whenever a
 * coefficient or rule changes; every stored result carries the version that computed it.
 */
export const ENGINE_VERSION = '1.3.0';

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
  readonly practice: {
    /** First lesson set size by lesson importance. */
    readonly lessonSetSize: Readonly<Record<Importance, number>>;
    readonly minPerConcept: number;
    /** Share of the remaining slots by concept importance. */
    readonly importanceWeight: Readonly<Record<Importance, number>>;
    /** Difficulty bands of a lesson set, in order. */
    readonly bands: readonly PracticeBand[];
    /** Reviewed concepts below this effective mastery get one interleaved item. */
    readonly interleaveBelowEffective: number;
    readonly selectWeights: {
      readonly freshness: number;
      readonly difficultyFit: number;
      readonly typeNovelty: number;
      readonly misconceptionTarget: number;
      readonly originPreference: number;
    };
    readonly originPreference: Readonly<Record<ExerciseOrigin, number>>;
    /** Freshness by days since the variant group was last served. */
    readonly freshness: {
      readonly blockDays: number;
      readonly oldDays: number;
      readonly mid: number;
      readonly old: number;
    };
    /** Number of recent types per concept that `typeNovelty` avoids. */
    readonly typeNoveltyWindow: number;
    readonly passRule: PassRule;
  };
  /** Weakness sets (learning-engine.md#약점-집중-세트). */
  readonly weakness: {
    /** Automatic target count: at least `minConcepts`, up to `maxConcepts` while ≥ keepRatio × top. */
    readonly minConcepts: number;
    readonly maxConcepts: number;
    readonly keepRatio: number;
    /** Items per concept: `itemsMax` with a confirmed misconception or below the effective bar. */
    readonly itemsMin: number;
    readonly itemsMax: number;
    readonly extraItemBelowEffective: number;
  };
  /** Unit assessment sets (learning-engine.md#단원-평가-세트). */
  readonly assessment: {
    /** Pass bar when the content gives no `assessment.passRatio`. */
    readonly defaultPassRatio: number;
    /** Set size when the content gives no `assessment.itemCount` (and the upper bound). */
    readonly maxItems: number;
    /** Share of L1…L5 items (content-and-exercises.md 단원 평가 분포). */
    readonly difficultyMix: readonly [number, number, number, number, number];
  };
  /** Active time (learning-engine.md#학습-시간-측정). */
  readonly activity: {
    /** Input older than this ends the active stretch (FR-GOAL-05: 2 minutes). */
    readonly idleThresholdMs: number;
    /** A longer gap between heartbeats counts as nothing (app closed, asleep). */
    readonly maxHeartbeatGapMs: number;
    /** A "studied day" has at least this much active time. */
    readonly studyDayMinMs: number;
  };
  /** Goals and pace (learning-engine.md#목표-페이스-계산-computepace). */
  readonly goals: {
    readonly defaultDailyMinutes: number;
    readonly defaultWeeklyDays: number;
    /** Share of the daily goal assumed for new lessons (the rest: reviews and weakness). */
    readonly newLearningShare: number;
    /** `on_track` while `requiredPerDay ≤ budget × onTrackRatio`. */
    readonly onTrackRatio: number;
    /** Completed lessons needed before estimates are calibrated with actual time. */
    readonly calibrationMinLessons: number;
    readonly calibrationMin: number;
    readonly calibrationMax: number;
  };
  /** Today's plan (learning-engine.md#오늘의-학습-구성-builddailyplan). */
  readonly dailyPlan: {
    readonly minBudgetMinutes: number;
    readonly reviewShare: number;
    /** Review share when the overdue reviews add up to `backlogDays` days of reviews. */
    readonly reviewShareBacklog: number;
    readonly backlogDays: number;
    readonly newLessonMinMinutes: number;
    /** A lesson is planned in part when at least this much time is left. */
    readonly minPartialMinutes: number;
    readonly weaknessMinMinutes: number;
    readonly weaknessBelowEffective: number;
    readonly weaknessConcepts: number;
    readonly weaknessItemsPerConcept: number;
  };
  /** Misconception observations (learning-engine.md#오개념-상태-전이). */
  readonly misconception: {
    /** A second piece of evidence from another exercise within this window confirms. */
    readonly confirmWindowMs: number;
    /** A suspicion without new evidence for this long is dismissed. */
    readonly dismissAfterMs: number;
    /** First-try correct targeted answers that resolve a confirmed misconception. */
    readonly resolveCorrect: number;
    /** Local days between those answers. */
    readonly resolveMinDays: number;
    /** First-try correct targeted answers that dismiss a suspicion. */
    readonly dismissCorrect: number;
  };
  /** Relearning (learning-engine.md#재학습-규칙). */
  readonly remediation: {
    /** `consecutive_failures` within `recentWindowMs` that triggers outside a single set. */
    readonly recentFailures: number;
    readonly recentWindowMs: number;
    /** Wrong answers in a row on items of the same concept inside one set. */
    readonly setFailures: number;
    /** A prerequisite is weak below this effective mastery (or below `practicing`). */
    readonly weakPrerequisiteBelow: number;
    /** Breadth-first search depth over `required` prerequisite edges. */
    readonly prerequisiteDepth: number;
    /** Prerequisite check set: items, difficulty range and pass threshold. */
    readonly checkItems: number;
    readonly checkMinDifficulty: number;
    readonly checkMaxDifficulty: number;
    readonly checkPassCorrect: number;
    /** Earlier suggestions inside this window shape the next step (no repeated checks). */
    readonly historyWindowMs: number;
  };
}

export type BandName = 'warmup' | 'core' | 'challenge';

export interface PracticeBand {
  readonly name: BandName;
  readonly minDifficulty: number;
  readonly maxDifficulty: number;
  readonly share: number;
}

/** `practice_sets.pass_rule_json` (lesson sets). */
export interface PassRule {
  /** Mean credited correctness (`o × W_hint × W_try` per item). */
  readonly minCorrect: number;
  /**
   * Credited correctness each introduced concept's items must reach within the set (with at
   * least one correct item). Replaced `minConceptScore`, the long-term mastery score (D-081).
   */
  readonly minConceptCredit: number;
  /** Distinct exercise types answered correctly. */
  readonly minDistinctTypes: number;
  /** L3+ items answered correctly on the first attempt. */
  readonly minLevel3Correct: number;
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
  practice: {
    lessonSetSize: { minor: 8, standard: 14, core: 22 },
    minPerConcept: 3,
    importanceWeight: { minor: 1, standard: 2, core: 3 },
    bands: [
      { name: 'warmup', minDifficulty: 1, maxDifficulty: 2, share: 0.3 },
      { name: 'core', minDifficulty: 2, maxDifficulty: 3, share: 0.5 },
      { name: 'challenge', minDifficulty: 3, maxDifficulty: 4, share: 0.2 },
    ],
    interleaveBelowEffective: 70,
    selectWeights: {
      freshness: 3,
      difficultyFit: 2,
      typeNovelty: 1,
      misconceptionTarget: 2,
      originPreference: 0.5,
    },
    originPreference: { authored: 1, template: 0.8, generated: 0.5 },
    freshness: { blockDays: 7, oldDays: 30, mid: 0.4, old: 0.7 },
    typeNoveltyWindow: 3,
    passRule: { minCorrect: 0.7, minConceptCredit: 0.6, minDistinctTypes: 2, minLevel3Correct: 0 },
  },
  weakness: {
    minConcepts: 3,
    maxConcepts: 5,
    keepRatio: 0.5,
    itemsMin: 3,
    itemsMax: 4,
    extraItemBelowEffective: 40,
  },
  assessment: {
    defaultPassRatio: 0.8,
    maxItems: 20,
    difficultyMix: [0.1, 0.3, 0.35, 0.2, 0.05],
  },
  activity: {
    idleThresholdMs: 2 * 60_000,
    maxHeartbeatGapMs: 90_000,
    studyDayMinMs: 5 * 60_000,
  },
  goals: {
    defaultDailyMinutes: 30,
    defaultWeeklyDays: 5,
    newLearningShare: 0.6,
    onTrackRatio: 0.85,
    calibrationMinLessons: 5,
    calibrationMin: 0.5,
    calibrationMax: 2.0,
  },
  dailyPlan: {
    minBudgetMinutes: 10,
    reviewShare: 0.5,
    reviewShareBacklog: 0.6,
    backlogDays: 3,
    newLessonMinMinutes: 10,
    minPartialMinutes: 5,
    weaknessMinMinutes: 8,
    weaknessBelowEffective: 60,
    weaknessConcepts: 3,
    weaknessItemsPerConcept: 3,
  },
  misconception: {
    confirmWindowMs: 30 * DAY_MS,
    dismissAfterMs: 30 * DAY_MS,
    resolveCorrect: 2,
    resolveMinDays: 1,
    dismissCorrect: 2,
  },
  remediation: {
    recentFailures: 3,
    recentWindowMs: 7 * DAY_MS,
    setFailures: 2,
    weakPrerequisiteBelow: 60,
    prerequisiteDepth: 2,
    checkItems: 3,
    checkMinDifficulty: 1,
    checkMaxDifficulty: 2,
    checkPassCorrect: 2,
    historyWindowMs: 7 * DAY_MS,
  },
};

/** Dependencies every engine function receives. The FSRS port is created once at server start. */
export interface EngineDeps {
  readonly config: EngineConfig;
  readonly fsrs: FsrsPort;
}
