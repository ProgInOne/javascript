import {
  COMMON_EXERCISE_TYPES,
  createExerciseRegistry,
  instantiateTemplate as instantiateTemplateWith,
  instantiateVariant as instantiateVariantWith,
  registerExerciseType,
  type TemplateInstance,
} from '@proginone/exercise-core';
import { parseRunResult, type RunPlan, type RunResult } from '@proginone/run-contract';

import { fillBlank } from '../types/fill-blank.ts';
import { findBugLine } from '../types/find-bug-line.ts';
import { fixBug } from '../types/fix-bug.ts';
import { implementFunction } from '../types/implement-function.ts';
import { parsons } from '../types/parsons.ts';
import { predictOutput } from '../types/predict-output.ts';
import { webTask } from '../types/web-task.ts';

/**
 * This repository's exercise registry: the common choice types from @proginone/exercise-core plus
 * the JavaScript types, with the JS runner's `RunResult` as the run contract (D-096).
 */
export const registry = createExerciseRegistry<RunResult, RunPlan>({
  types: [
    ...COMMON_EXERCISE_TYPES,
    registerExerciseType(fillBlank),
    registerExerciseType(predictOutput),
    registerExerciseType(parsons),
    registerExerciseType(findBugLine),
    registerExerciseType(implementFunction),
    registerExerciseType(fixBug),
    registerExerciseType(webTask),
  ],
  parseRun: parseRunResult,
});

// The boundary functions, bound to this registry (server, web and content-cli call these).
export const {
  buildRunPlan,
  checkSpec,
  getExerciseType,
  gradeSubmission,
  implementedExerciseTypes,
  isWritingExercise,
  leakFingerprints,
  parseAnswer,
  parseSpec,
  redactSpec,
  specMisconceptions,
  verifySpec,
} = registry;

/** Instantiates a template of one of this repository's types for one seed. */
export function instantiateTemplate(rawTemplate: unknown, seed: bigint): TemplateInstance {
  return instantiateTemplateWith(registry, rawTemplate, seed);
}

/** Instantiates `<templateId>@<seed>` with this repository's types. */
export function instantiateVariant(rawTemplate: unknown, variantId: string): TemplateInstance {
  return instantiateVariantWith(registry, rawTemplate, variantId);
}
