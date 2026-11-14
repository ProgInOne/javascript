import type { ExerciseKitHooks } from './build.ts';

/**
 * Exercise-type operations for the CLI. Wired to `@proginone/exercise-kit` once that package is
 * merged; until then any exercise is rejected so no unredacted spec can reach content.db.
 */
export const exerciseKit: ExerciseKitHooks = {
  validateSpec: (type) => ({
    ok: false,
    errors: [`exercise-kit이 아직 연결되지 않아 ${type} 스펙을 검증할 수 없습니다`],
  }),
  redact: () => {
    throw new Error('exercise-kit is not wired');
  },
  leakFingerprints: () => {
    throw new Error('exercise-kit is not wired');
  },
};
