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
}

export interface PassCheck {
  readonly met: boolean;
  readonly required: number;
  readonly actual: number;
}

export interface PassResult {
  readonly passed: boolean;
  readonly checks: {
    readonly allAnswered: boolean;
    readonly minCorrect: PassCheck;
    readonly minConceptScore: PassCheck & { readonly below: readonly ConceptId[] };
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
 * Lesson set pass rule (learning-engine.md#단원-연습-세트): every item answered or skipped,
 * credited correctness (`o × W_hint × W_try` mean over items, skipped = 0), every introduced
 * concept's score, distinct correct types, and L3+ first-try correct answers.
 */
export function evaluatePassRule(
  config: EngineConfig,
  rule: PassRule,
  input: {
    readonly items: readonly PassRuleItem[];
    /** Current `concept_mastery.score` of the lesson's introduced concepts. */
    readonly introducedScores: Readonly<Record<ConceptId, number>>;
  },
): PassResult {
  const { items } = input;
  const allAnswered = items.every((item) => item.status !== 'pending');
  const credit =
    items.length === 0
      ? 0
      : items.reduce((sum, item) => sum + itemCredit(config, item), 0) / items.length;
  const below = Object.entries(input.introducedScores)
    .filter(([, score]) => score < rule.minConceptScore)
    .map(([id]) => id)
    .sort();
  const lowest = Math.min(...Object.values(input.introducedScores), 100);
  const types = new Set(
    items
      .filter((item) => item.status === 'answered' && (item.finalAttempt?.o ?? 0) >= 0.5)
      .map((item) => item.type),
  ).size;
  const level3 = items.filter((item) => item.difficulty >= 3 && item.firstAttemptCorrect).length;

  const checks = {
    allAnswered,
    minCorrect: { met: credit >= rule.minCorrect, required: rule.minCorrect, actual: credit },
    minConceptScore: {
      met: below.length === 0,
      required: rule.minConceptScore,
      actual: lowest,
      below,
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
      checks.minConceptScore.met &&
      checks.minDistinctTypes.met &&
      checks.minLevel3Correct.met,
    checks,
  };
}
