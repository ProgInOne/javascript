import type { EngineConfig, PassRule } from '../config.ts';
import type { ConceptId, HintLevel, Importance } from '../types.ts';

/** Default pass rule with `lesson.yaml` overrides; `core` lessons need one L3 first-try correct. */
export function lessonPassRule(
  config: EngineConfig,
  importance: Importance,
  overrides: Partial<PassRule> = {},
): PassRule {
  const base = config.practice.passRule;
  return {
    ...base,
    minLevel3Correct:
      importance === 'core' ? Math.max(1, base.minLevel3Correct) : base.minLevel3Correct,
    ...overrides,
  };
}

/** Final state of one `practice_set_items` row for pass evaluation. */
export interface PassRuleItem {
  readonly status: 'pending' | 'answered' | 'skipped';
  readonly type: string;
  readonly difficulty: number;
  /** The item's last attempt; `null` when skipped or not answered. */
  readonly finalAttempt: {
    /** Observation 0–1. */
    readonly o: number;
    readonly hintLevelMax: HintLevel;
    readonly solutionViewed: boolean;
    readonly tutorAssisted: boolean;
    readonly attemptInItem: number;
  } | null;
  /** The first attempt of the item had `o ≥ 0.5`. */
  readonly firstAttemptCorrect: boolean;
  /** Primary concepts of the item (`weight = 1`); omitted = none (D-081). */
  readonly primaryConceptIds?: readonly ConceptId[];
}

export interface PassCheck {
  readonly met: boolean;
  readonly required: number;
  readonly actual: number;
}

/** One introduced concept's items in the set (D-081). */
export interface ConceptCredit {
  readonly conceptId: ConceptId;
  /** Credited correctness of the concept's items (`o × W_hint × W_try` mean, skipped = 0). */
  readonly credit: number;
  /** Items answered correctly (last attempt `o ≥ 0.5`). */
  readonly correct: number;
  /** Items with the concept as a primary concept. */
  readonly total: number;
  readonly met: boolean;
}

/**
 * `minConceptCredit` check: `actual` is the lowest concept credit (1 when no concept is judged).
 * Introduced concepts without an item in the set are left out (`concepts` lacks them).
 */
export interface ConceptCreditCheck extends PassCheck {
  /** Concepts under the bar, sorted. */
  readonly below: readonly ConceptId[];
  /** Every judged concept, sorted by ID. */
  readonly concepts: readonly ConceptCredit[];
}

export interface PassResult {
  readonly passed: boolean;
  readonly checks: {
    readonly allAnswered: boolean;
    readonly minCorrect: PassCheck;
    readonly minConceptCredit: ConceptCreditCheck;
    readonly minDistinctTypes: PassCheck;
    readonly minLevel3Correct: PassCheck;
  };
}

function itemCredit(config: EngineConfig, item: PassRuleItem): number {
  const attempt = item.finalAttempt;
  if (item.status !== 'answered' || attempt === null) return 0;
  const m = config.mastery;
  let hint = attempt.solutionViewed
    ? m.solutionViewedWeight.correct
    : m.hintWeight[attempt.hintLevelMax].correct;
  if (attempt.tutorAssisted) hint *= m.tutorAssistedCorrect;
  const table = m.tryWeight;
  const tryWeight =
    table[Math.min(Math.max(attempt.attemptInItem, 1), table.length) - 1]?.correct ?? 1;
  return attempt.o * hint * tryWeight;
}

/**
 * Per-concept performance in the set (D-081): for each introduced concept with at least one
 * primary item, the credited correctness of those items and how many were answered correctly.
 * A concept meets the bar with `credit ≥ minConceptCredit` and at least one correct item.
 */
export function conceptCredits(
  config: EngineConfig,
  rule: PassRule,
  items: readonly PassRuleItem[],
  introducedConceptIds: readonly ConceptId[],
): ConceptCredit[] {
  return [...new Set(introducedConceptIds)].sort().flatMap((conceptId) => {
    const mine = items.filter((item) => item.primaryConceptIds?.includes(conceptId) ?? false);
    if (mine.length === 0) return [];
    const credit = mine.reduce((sum, item) => sum + itemCredit(config, item), 0) / mine.length;
    const correct = mine.filter(
      (item) => item.status === 'answered' && (item.finalAttempt?.o ?? 0) >= 0.5,
    ).length;
    return [
      {
        conceptId,
        credit,
        correct,
        total: mine.length,
        met: credit >= rule.minConceptCredit - 1e-9 && correct >= 1,
      },
    ];
  });
}

/**
 * Lesson set pass rule (learning-engine.md#단원-연습-세트): every item answered or skipped,
 * credited correctness (`o × W_hint × W_try` mean over items, skipped = 0), each introduced
 * concept's credited correctness within the set (`conceptCredits`), distinct correct types, and
 * L3+ first-try correct answers. The long-term `concept_mastery.score` is not used (D-081).
 */
export function evaluatePassRule(
  config: EngineConfig,
  rule: PassRule,
  input: {
    readonly items: readonly PassRuleItem[];
    /** Concepts the lesson introduces. */
    readonly introducedConceptIds: readonly ConceptId[];
  },
): PassResult {
  const { items } = input;
  const allAnswered = items.every((item) => item.status !== 'pending');
  const credit =
    items.length === 0
      ? 0
      : items.reduce((sum, item) => sum + itemCredit(config, item), 0) / items.length;
  const concepts = conceptCredits(config, rule, items, input.introducedConceptIds);
  const below = concepts.filter((c) => !c.met).map((c) => c.conceptId);
  const lowest = Math.min(...concepts.map((c) => c.credit), 1);
  const types = new Set(
    items
      .filter((item) => item.status === 'answered' && (item.finalAttempt?.o ?? 0) >= 0.5)
      .map((item) => item.type),
  ).size;
  const level3 = items.filter((item) => item.difficulty >= 3 && item.firstAttemptCorrect).length;

  const checks = {
    allAnswered,
    minCorrect: { met: credit >= rule.minCorrect, required: rule.minCorrect, actual: credit },
    minConceptCredit: {
      met: below.length === 0,
      required: rule.minConceptCredit,
      actual: lowest,
      below,
      concepts,
    },
    minDistinctTypes: {
      met: types >= rule.minDistinctTypes,
      required: rule.minDistinctTypes,
      actual: types,
    },
    minLevel3Correct: {
      met: level3 >= rule.minLevel3Correct,
      required: rule.minLevel3Correct,
      actual: level3,
    },
  };
  return {
    passed:
      allAnswered &&
      checks.minCorrect.met &&
      checks.minConceptCredit.met &&
      checks.minDistinctTypes.met &&
      checks.minLevel3Correct.met,
    checks,
  };
}
