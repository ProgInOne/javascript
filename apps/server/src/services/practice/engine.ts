import { getExerciseType, variantGroupKey } from '@proginone/exercise-kit';
import {
  createTsFsrsPort,
  defaultEngineConfig,
  type DayBoundary,
  type Difficulty,
  type EngineConfig,
  type EngineDeps,
  type ExerciseCandidate,
  type PassRule,
} from '@proginone/learning-engine';
import type { ContentExercise } from '../../db/content/repository.ts';
import type { UserDb } from '../../db/user/connection.ts';
import { ensureLearner } from '../../db/user/learners.ts';

/** Engine dependencies. The ts-fsrs scheduler is created once at startup (its only async step). */
export async function createEngine(
  config: EngineConfig = defaultEngineConfig,
): Promise<EngineDeps> {
  return { config, fsrs: await createTsFsrsPort(config.fsrs) };
}

/** The single learner and how their day is cut (time zone + 04:00 day start by default). */
export function learnerContext(userDb: UserDb): { learnerId: string; dayBoundary: DayBoundary } {
  const learner = ensureLearner(userDb);
  return {
    learnerId: learner.id,
    dayBoundary: { timeZone: learner.timezone, dayStartHour: learner.dayStartHour },
  };
}

/**
 * Engine facts of a content exercise, or null when it cannot be served (type not implemented in
 * this version, or no primary concept).
 */
export function candidateOf(exercise: ContentExercise): ExerciseCandidate | null {
  const def = getExerciseType(exercise.type);
  if (!def || !exercise.concepts.some((c) => c.isPrimary)) return null;
  return {
    id: exercise.id,
    type: exercise.type,
    category: def.category,
    ...(def.weightOverride === undefined ? {} : { typeWeightOverride: def.weightOverride }),
    // content.db enforces `difficulty BETWEEN 1 AND 5`.
    difficulty: Math.min(5, Math.max(1, Math.round(exercise.difficulty))) as Difficulty,
    estimatedSeconds: exercise.estimatedSeconds,
    variantGroupKey: variantGroupKey({ id: exercise.id, variantGroup: exercise.variantGroup }),
    concepts: exercise.concepts.map((c) => ({
      conceptId: c.conceptId,
      weight: c.weight,
      isPrimary: c.isPrimary,
    })),
    origin: exercise.origin,
  };
}

const PASS_RULE_KEYS = [
  'minCorrect',
  'minConceptScore',
  'minDistinctTypes',
  'minLevel3Correct',
] as const;

/** `lessons.pass_rule_json` overrides, keeping only known numeric fields. */
export function passRuleOverrides(raw: Record<string, unknown>): Partial<PassRule> {
  const out: Partial<Record<(typeof PASS_RULE_KEYS)[number], number>> = {};
  for (const key of PASS_RULE_KEYS) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out;
}
