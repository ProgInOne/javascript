import type { EngineConfig } from '../config.ts';
import type { EvidenceFact, MasteryStage, ReviewFact } from '../types.ts';
import { MASTERY_STAGES } from '../types.ts';
import type { DayBoundary } from '../util/time.ts';
import { daysBetween, localDateOf } from '../util/time.ts';

/** Stable codes for unmet gate conditions (`breakdown_json.gates.*.missing[].gate`). */
export type GateCode =
  | 'evidence_weight_sum'
  | 'effective'
  | 'distinct_types'
  | 'distinct_variant_groups'
  | 'level3_correct'
  | 'spaced_reviews'
  | 'independent_application'
  | 'recent_again';

export interface GateShortfall {
  readonly gate: GateCode;
  readonly required: number;
  readonly actual: number;
}

export interface GateResult {
  readonly met: boolean;
  readonly missing: readonly GateShortfall[];
}

export interface GateReport {
  readonly practicing: GateResult;
  readonly proficient: GateResult;
  readonly mastered: GateResult;
}

export interface GateInput {
  readonly effective: number;
  readonly evidenceWeightSum: number;
  readonly history: readonly EvidenceFact[];
  readonly reviews: readonly ReviewFact[];
  readonly dayBoundary: DayBoundary;
}

export type StageChangeReason =
  'promoted' | 'demoted_effective' | 'demoted_again' | 'introduced_by_reading' | 'unchanged';

function check(
  missing: GateShortfall[],
  gate: GateCode,
  actual: number,
  required: number,
  ok = actual >= required,
): void {
  if (!ok) missing.push({ gate, required, actual });
}

function result(missing: GateShortfall[]): GateResult {
  return { met: missing.length === 0, missing };
}

/** Primary correct answers whose credit (`W_hint × W_conf × W_try`) is at least 0.5. */
export function qualifyingFacts(
  config: EngineConfig,
  history: readonly EvidenceFact[],
): EvidenceFact[] {
  return history.filter(
    (fact) => fact.isPrimary && fact.correct && fact.credit >= config.gates.qualifyingCredit,
  );
}

/**
 * Successful reviews (`good`/`easy`) that came at least `spacedReviewMinDays` learner-local
 * calendar days after the previous review. Counted only when two of them can be backed by
 * different variant groups.
 */
export function countSpacedReviews(
  config: EngineConfig,
  reviews: readonly ReviewFact[],
  boundary: DayBoundary,
): number {
  const sorted = [...reviews].sort((a, b) => a.reviewedAt - b.reviewedAt);
  const qualifying: ReviewFact[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev === undefined || cur === undefined) continue;
    if (cur.rating !== 'good' && cur.rating !== 'easy') continue;
    const gap = daysBetween(
      localDateOf(prev.reviewedAt, boundary),
      localDateOf(cur.reviewedAt, boundary),
    );
    if (gap >= config.gates.mastered.spacedReviewMinDays) qualifying.push(cur);
  }
  const groups = new Set(qualifying.flatMap((review) => review.variantGroupKeys));
  // Two reviews can be backed by different groups iff there are ≥ 2 reviews and ≥ 2 groups.
  return groups.size >= 2 ? qualifying.length : Math.min(qualifying.length, 1);
}

/** Evaluates the entry gates of `practicing`, `proficient` and `mastered`. */
export function evaluateGates(config: EngineConfig, input: GateInput): GateReport {
  const g = config.gates;

  const practicingMissing: GateShortfall[] = [];
  check(practicingMissing, 'evidence_weight_sum', input.evidenceWeightSum, g.practicingEvidenceSum);

  const qualifying = qualifyingFacts(config, input.history);
  const proficientMissing: GateShortfall[] = [];
  check(proficientMissing, 'effective', input.effective, g.proficient.effective);
  check(
    proficientMissing,
    'distinct_types',
    new Set(qualifying.map((fact) => fact.exerciseType)).size,
    g.proficient.distinctTypes,
  );
  check(
    proficientMissing,
    'distinct_variant_groups',
    new Set(qualifying.map((fact) => fact.variantGroupKey)).size,
    g.proficient.distinctVariantGroups,
  );
  check(
    proficientMissing,
    'level3_correct',
    qualifying.filter((fact) => fact.difficulty >= g.proficient.minDifficulty).length,
    1,
  );
  check(
    proficientMissing,
    'evidence_weight_sum',
    input.evidenceWeightSum,
    g.proficient.evidenceSum,
  );

  // `mastered` keeps every `proficient` condition (its higher effective bar replaces 70).
  const masteredMissing: GateShortfall[] = proficientMissing.filter(
    (shortfall) => shortfall.gate !== 'effective',
  );
  check(masteredMissing, 'effective', input.effective, g.mastered.effective);
  check(
    masteredMissing,
    'spaced_reviews',
    countSpacedReviews(config, input.reviews, input.dayBoundary),
    g.mastered.spacedReviews,
  );
  check(
    masteredMissing,
    'independent_application',
    input.history.filter(
      (fact) =>
        fact.isPrimary &&
        fact.correct &&
        fact.unassisted &&
        (fact.setKind === 'assessment' || fact.difficulty >= g.mastered.independentMinDifficulty),
    ).length,
    1,
  );
  const recent = [...input.reviews]
    .sort((a, b) => a.reviewedAt - b.reviewedAt)
    .slice(-g.mastered.recentReviewsWithoutAgain);
  const agains = recent.filter((review) => review.rating === 'again').length;
  check(masteredMissing, 'recent_again', agains, 0, agains === 0);

  return {
    practicing: result(practicingMissing),
    proficient: result(proficientMissing),
    mastered: result(masteredMissing),
  };
}

export function stageIndex(stage: MasteryStage): number {
  return MASTERY_STAGES.indexOf(stage);
}

/**
 * Next stage after an attempt or a review. Stages move at most one step at a time.
 * Demotion uses hysteresis: only when `effective` falls `demotionMargin` below the entry bar,
 * and only when the caller allows it (an attempt that lowered the score). Time alone and correct
 * answers never demote.
 */
export function decideStage(
  config: EngineConfig,
  current: MasteryStage,
  effective: number,
  gates: GateReport,
  options: { readonly allowDemotion: boolean },
): { stage: MasteryStage; reason: StageChangeReason } {
  const g = config.gates;
  switch (current) {
    case 'mastered':
      return options.allowDemotion && effective < g.mastered.effective - g.demotionMargin
        ? { stage: 'proficient', reason: 'demoted_effective' }
        : { stage: 'mastered', reason: 'unchanged' };
    case 'proficient':
      if (options.allowDemotion && effective < g.proficient.effective - g.demotionMargin) {
        return { stage: 'practicing', reason: 'demoted_effective' };
      }
      return gates.mastered.met
        ? { stage: 'mastered', reason: 'promoted' }
        : { stage: 'proficient', reason: 'unchanged' };
    case 'practicing':
      return gates.proficient.met
        ? { stage: 'proficient', reason: 'promoted' }
        : { stage: 'practicing', reason: 'unchanged' };
    case 'introduced':
      return gates.practicing.met
        ? { stage: 'practicing', reason: 'promoted' }
        : { stage: 'introduced', reason: 'unchanged' };
    case 'not_started':
      // Any attempt introduces the concept.
      return { stage: 'introduced', reason: 'promoted' };
  }
}

/** The gate the learner is working towards (for the breakdown), or `null` at `mastered`. */
export function nextGateStage(
  stage: MasteryStage,
): 'practicing' | 'proficient' | 'mastered' | null {
  switch (stage) {
    case 'not_started':
    case 'introduced':
      return 'practicing';
    case 'practicing':
      return 'proficient';
    case 'proficient':
      return 'mastered';
    case 'mastered':
      return null;
  }
}
