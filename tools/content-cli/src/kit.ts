import { checkSpec, leakFingerprints, redactSpec } from '@proginone/exercise-kit';
import type { ExerciseKitHooks } from './build.ts';

/** Exercise-type operations for the CLI, backed by `@proginone/exercise-kit`. */
export const exerciseKit: ExerciseKitHooks = {
  validateSpec: (type, spec) => checkSpec(type, spec),
  redact: (type, spec) => redactSpec(type, spec) as Record<string, unknown>,
  leakFingerprints: (type, spec) => leakFingerprints(type, spec),
};
