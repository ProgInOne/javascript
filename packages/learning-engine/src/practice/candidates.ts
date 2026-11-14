import type { BandName, EngineConfig } from '../config.ts';
import type {
  ConceptId,
  ConceptState,
  ExerciseFacts,
  ExerciseId,
  ExerciseOrigin,
} from '../types.ts';
import { DAY_MS } from '../util/time.ts';

/**
 * An exercise the server may serve: authored exercises, template variants and verified
 * generated exercises whose primary concept is a target concept.
 */
export interface ExerciseCandidate extends ExerciseFacts {
  readonly origin: ExerciseOrigin;
}

/** Inputs shared by every set builder for scoring candidates. */
export interface SelectionContext {
  /**
   * Last time each variant group was served to the learner (max of `exercise_stats.last_seen_at`
   * over the group's exercises). Freshness is per variant group, not per exercise.
   */
  readonly lastSeenAtByGroup: Readonly<Record<string, number>>;
  /** Exercises that target an active misconception (`misconceptions.remedial_exercise_ids_json`). */
  readonly misconceptionTargetIds?: readonly ExerciseId[];
  readonly now: number;
}

export interface SelectFactors {
  readonly freshness: number;
  readonly difficultyFit: number;
  readonly typeNovelty: number;
  readonly misconceptionTarget: number;
  readonly originPreference: number;
}

/** Stable reason codes stored in `practice_set_items.reason`. */
export type PracticeItemReason =
  | 'lesson_practice'
  | 'production_required'
  | 'interleave_review'
  | 'review_due'
  | 'review_reinforce'
  // Weakness sets (practice/weakness-set.ts).
  | 'weak_concept'
  | 'misconception_target'
  // Adaptive changes during a set (practice/adaptive.ts).
  | 'difficulty_step_up'
  | 'remedial_prereq'
  | 'remedial_worked_example'
  | 'remedial_easier'
  | 'solution_followup'
  | 'skip_followup';

/** Reasons of items added by relearning; they do not count towards a lesson pass rule. */
export const REMEDIAL_REASONS: readonly PracticeItemReason[] = [
  'remedial_prereq',
  'remedial_worked_example',
  'remedial_easier',
];

/** One planned `practice_set_items` row (the server adds `id`, `practice_set_id`, `status`). */
export interface PlannedItem {
  readonly position: number;
  readonly exerciseId: ExerciseId;
  readonly exerciseOrigin: ExerciseOrigin;
  readonly reason: PracticeItemReason;
  readonly targetConceptId: ConceptId;
  readonly type: string;
  readonly difficulty: number;
  readonly variantGroupKey: string;
  readonly estimatedSeconds: number;
  /** Lesson sets only. */
  readonly band: BandName | null;
  readonly selectScore: number;
  readonly factors: SelectFactors;
}

export function primaryConceptOf(exercise: ExerciseFacts): ConceptId | null {
  return exercise.concepts.find((tag) => tag.isPrimary)?.conceptId ?? null;
}

/**
 * Freshness of a variant group: never seen 1.0 · ≥ 30 days 0.7 · 7–30 days 0.4 · < 7 days 0
 * (allowed only when nothing else is left).
 */
export function freshnessOf(
  config: EngineConfig,
  lastSeenAt: number | undefined,
  now: number,
): number {
  if (lastSeenAt === undefined) return 1;
  const { blockDays, oldDays, mid, old } = config.practice.freshness;
  const days = (now - lastSeenAt) / DAY_MS;
  if (days >= oldDays) return old;
  if (days >= blockDays) return mid;
  return 0;
}

/** Last `typeNoveltyWindow` exercise types the learner saw for a concept (oldest first). */
export function recentTypesOf(config: EngineConfig, state: ConceptState | undefined): string[] {
  if (state === undefined) return [];
  return [...state.history]
    .filter((fact) => fact.isPrimary)
    .sort((a, b) => a.at - b.at)
    .slice(-config.practice.typeNoveltyWindow)
    .map((fact) => fact.exerciseType);
}

/**
 * `selectScore = 3·freshness + 2·difficultyFit + 1·typeNovelty + 2·misconceptionTarget
 * + 0.5·originPreference`.
 */
export function scoreCandidate(
  config: EngineConfig,
  candidate: ExerciseCandidate,
  input: {
    readonly targetDifficulty: number;
    readonly recentTypes: readonly string[];
    readonly context: SelectionContext;
  },
): { score: number; factors: SelectFactors } {
  const w = config.practice.selectWeights;
  const factors: SelectFactors = {
    freshness: freshnessOf(
      config,
      input.context.lastSeenAtByGroup[candidate.variantGroupKey],
      input.context.now,
    ),
    difficultyFit: Math.max(0, 1 - Math.abs(candidate.difficulty - input.targetDifficulty) / 2),
    typeNovelty: input.recentTypes.includes(candidate.type) ? 0 : 1,
    misconceptionTarget: input.context.misconceptionTargetIds?.includes(candidate.id) ? 1 : 0,
    originPreference: config.practice.originPreference[candidate.origin],
  };
  const score =
    w.freshness * factors.freshness +
    w.difficultyFit * factors.difficultyFit +
    w.typeNovelty * factors.typeNovelty +
    w.misconceptionTarget * factors.misconceptionTarget +
    w.originPreference * factors.originPreference;
  return { score, factors };
}

/** Builds a {@link PlannedItem} (position assigned later). */
export function plan(
  candidate: ExerciseCandidate,
  scored: { score: number; factors: SelectFactors },
  reason: PracticeItemReason,
  targetConceptId: ConceptId,
  band: BandName | null,
): PlannedItem {
  return {
    position: 0,
    exerciseId: candidate.id,
    exerciseOrigin: candidate.origin,
    reason,
    targetConceptId,
    type: candidate.type,
    difficulty: candidate.difficulty,
    variantGroupKey: candidate.variantGroupKey,
    estimatedSeconds: candidate.estimatedSeconds,
    band,
    selectScore: scored.score,
    factors: scored.factors,
  };
}

/**
 * Picks the best candidate. Tiers: fresh in-range, fresh any, recent (freshness 0) in-range,
 * recent any. Inside a tier: highest score, then the seeded tie-break key, then the ID.
 */
export function pickBest(
  config: EngineConfig,
  pool: readonly ExerciseCandidate[],
  input: {
    readonly targetDifficulty: number;
    readonly inRange: (candidate: ExerciseCandidate) => boolean;
    readonly recentTypes: readonly string[];
    readonly context: SelectionContext;
    readonly tieBreak: ReadonlyMap<string, number>;
  },
): { candidate: ExerciseCandidate; scored: { score: number; factors: SelectFactors } } | null {
  let best: {
    candidate: ExerciseCandidate;
    scored: { score: number; factors: SelectFactors };
    tier: number;
  } | null = null;
  for (const candidate of pool) {
    const scored = scoreCandidate(config, candidate, input);
    const tier = (scored.factors.freshness > 0 ? 0 : 2) + (input.inRange(candidate) ? 0 : 1);
    if (best === null || isBetter(candidate, scored.score, tier, best, input.tieBreak)) {
      best = { candidate, scored, tier };
    }
  }
  return best === null ? null : { candidate: best.candidate, scored: best.scored };
}

function isBetter(
  candidate: ExerciseCandidate,
  score: number,
  tier: number,
  best: { candidate: ExerciseCandidate; scored: { score: number }; tier: number },
  tieBreak: ReadonlyMap<string, number>,
): boolean {
  if (tier !== best.tier) return tier < best.tier;
  if (score !== best.scored.score) return score > best.scored.score;
  const a = tieBreak.get(candidate.id) ?? 0;
  const b = tieBreak.get(best.candidate.id) ?? 0;
  if (a !== b) return a < b;
  return candidate.id < best.candidate.id;
}
