import type { BranchWeights, EngineConfig } from '../config.ts';
import type {
  AttemptFacts,
  EvidenceFact,
  ExerciseConceptTag,
  ExerciseFacts,
  Outcome,
} from '../types.ts';

/** Stable keys of the weight factors in `breakdown_json.factors`. */
export type FactorKey =
  | 'concept'
  | 'type'
  | 'difficulty'
  | 'try'
  | 'hint'
  | 'confidence'
  | 'time'
  | 'repetition'
  | 'context'
  | 'secondary';

/** One factor with a machine-readable reason code the UI turns into a sentence. */
export interface Factor {
  readonly value: number;
  readonly why: string;
}

export interface Evidence {
  readonly outcome: Outcome;
  /** Observation 0–1. */
  readonly o: number;
  /** `o ≥ 0.5`. Decides which branch of the factor tables applies. */
  readonly correct: boolean;
  readonly factors: Readonly<Record<FactorKey, Factor>>;
  /** Product of all factors. */
  readonly weight: number;
  /** `W_hint × W_conf × W_try` with correct-branch values (gate qualification). */
  readonly credit: number;
  /** First try in the item without hints, solution or tutor. */
  readonly unassisted: boolean;
}

/** Observation `o` of an attempt (`partial` uses the grader score). */
export function observationOf(attempt: Pick<AttemptFacts, 'outcome' | 'score'>): number {
  switch (attempt.outcome) {
    case 'correct':
      return 1;
    case 'partial':
      return Math.min(1, Math.max(0, attempt.score));
    case 'incorrect':
    case 'error':
      return 0;
  }
}

export function isUnassisted(
  attempt: Pick<
    AttemptFacts,
    'attemptInItem' | 'hintLevelMax' | 'solutionViewed' | 'tutorAssisted'
  >,
): boolean {
  return (
    attempt.attemptInItem <= 1 &&
    attempt.hintLevelMax === 0 &&
    !attempt.solutionViewed &&
    !attempt.tutorAssisted
  );
}

function pick(weights: BranchWeights, correct: boolean): number {
  return correct ? weights.correct : weights.incorrect;
}

function tryWeights(config: EngineConfig, attemptInItem: number): BranchWeights {
  const table = config.mastery.tryWeight;
  const index = Math.min(Math.max(attemptInItem, 1), table.length) - 1;
  const weights = table[index];
  if (weights === undefined) throw new Error('tryWeight table is empty');
  return weights;
}

function hintFactor(config: EngineConfig, attempt: AttemptFacts, correct: boolean): Factor {
  const m = config.mastery;
  let value: number;
  let why: string;
  if (attempt.solutionViewed) {
    value = pick(m.solutionViewedWeight, correct);
    why = 'solution viewed';
  } else {
    value = pick(m.hintWeight[attempt.hintLevelMax], correct);
    why = attempt.hintLevelMax === 0 ? 'no hint' : `hint ${attempt.hintLevelMax}`;
  }
  if (attempt.tutorAssisted && correct) {
    value *= m.tutorAssistedCorrect;
    why += ' +tutor';
  }
  return { value, why };
}

/**
 * Number of correct answers for this concept from the same variant group inside the repetition
 * window before `now` (the current attempt excluded).
 */
export function countRecentGroupCorrect(
  config: EngineConfig,
  history: readonly EvidenceFact[],
  variantGroupKey: string,
  attemptId: string,
  now: number,
): number {
  const since = now - config.mastery.repetition.windowMs;
  return history.filter(
    (fact) =>
      fact.correct &&
      fact.variantGroupKey === variantGroupKey &&
      fact.attemptId !== attemptId &&
      fact.at > since &&
      fact.at <= now,
  ).length;
}

/**
 * Evidence weight `w` an attempt gives one tagged concept:
 * `W_concept × W_type × W_diff × W_try × W_hint × W_conf × W_time × W_rep × W_ctx`
 * (× the secondary-concept penalty for wrong answers).
 */
export function computeEvidence(
  config: EngineConfig,
  input: {
    readonly attempt: AttemptFacts;
    readonly exercise: ExerciseFacts;
    readonly tag: ExerciseConceptTag;
    /** Stored facts of this concept, used for `W_rep`. */
    readonly history: readonly EvidenceFact[];
    readonly now: number;
  },
): Evidence {
  const { attempt, exercise, tag, history, now } = input;
  const m = config.mastery;
  const o = observationOf(attempt);
  const correct = o >= 0.5;

  const concept: Factor = { value: tag.weight, why: tag.isPrimary ? 'primary' : 'secondary' };
  const type: Factor = {
    value: exercise.typeWeightOverride ?? m.typeWeight[exercise.category],
    why: `${exercise.category}:${exercise.type}`,
  };
  const difficulty: Factor = {
    value: m.difficultyWeight[exercise.difficulty - 1] ?? 1,
    why: `L${exercise.difficulty}`,
  };
  const tryW = tryWeights(config, attempt.attemptInItem);
  const tryF: Factor = { value: pick(tryW, correct), why: `attempt ${attempt.attemptInItem}` };
  const hint = hintFactor(config, attempt, correct);
  const confidenceKey = attempt.confidence ?? 'none';
  const confidence: Factor = {
    value: pick(m.confidenceWeight[confidenceKey], correct),
    why: confidenceKey,
  };

  let time: Factor = { value: 1, why: 'not production' };
  if (exercise.category === 'production') {
    const slow = attempt.activeMs > m.time.slowFactor * exercise.estimatedSeconds * 1000;
    time =
      slow && correct
        ? { value: m.time.slowCorrect, why: 'over 3x estimate' }
        : { value: 1, why: slow ? 'over 3x estimate, incorrect' : 'within 3x estimate' };
  }

  let repetition: Factor = { value: 1, why: 'incorrect' };
  if (correct) {
    const k = countRecentGroupCorrect(
      config,
      history,
      exercise.variantGroupKey,
      attempt.attemptId,
      now,
    );
    const weights = m.repetition.weights;
    repetition = { value: weights[Math.min(k, weights.length - 1)] ?? 1, why: `k=${k}` };
  }

  const context: Factor =
    attempt.setKind === 'assessment'
      ? { value: pick(m.assessmentContext, correct), why: 'assessment' }
      : { value: 1, why: attempt.setKind ?? 'no set' };

  let secondary: Factor = { value: 1, why: tag.isPrimary ? 'primary' : 'secondary correct' };
  if (!tag.isPrimary && !correct) {
    const pointed = attempt.misconceptionConceptIds?.includes(tag.conceptId) ?? false;
    secondary = pointed
      ? { value: 1, why: 'misconception points here' }
      : { value: m.secondaryIncorrect, why: 'secondary incorrect' };
  }

  const factors: Record<FactorKey, Factor> = {
    concept,
    type,
    difficulty,
    try: tryF,
    hint,
    confidence,
    time,
    repetition,
    context,
    secondary,
  };
  const weight = Object.values(factors).reduce((product, factor) => product * factor.value, 1);

  const correctHint = hintFactor(config, attempt, true).value;
  const credit = correctHint * m.confidenceWeight[confidenceKey].correct * tryW.correct;

  return {
    outcome: attempt.outcome,
    o,
    correct,
    factors,
    weight,
    credit,
    unassisted: isUnassisted(attempt),
  };
}
