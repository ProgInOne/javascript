import { getExerciseType, isWritingExercise, variantGroupKey } from '@proginone/exercise-kit';
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

/** `isWritingExercise` by exercise ID and content hash (a spec only changes with its hash). */
const writingCache = new Map<string, boolean>();

/**
 * Whether the learner writes the code from an empty starter (작성형, D-084). Only production
 * types can be; a spec that fails validation counts as not writing (serving it fails later
 * with the usual content error).
 */
export function isWriting(exercise: ContentExercise): boolean {
  if (getExerciseType(exercise.type)?.category !== 'production') return false;
  const key = `${exercise.id}\u0000${exercise.contentHash}`;
  const cached = writingCache.get(key);
  if (cached !== undefined) return cached;
  let writing: boolean;
  try {
    writing = isWritingExercise(exercise.type, exercise.spec);
  } catch {
    writing = false;
  }
  if (writingCache.size > 5_000) writingCache.clear();
  writingCache.set(key, writing);
  return writing;
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
    ...(isWriting(exercise) ? { writing: true } : {}),
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
  'minConceptCredit',
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
