// This repository's registry (common types from @proginone/exercise-core plus the JS types, D-096)
// and its boundary functions (validate untrusted input, then call pure graders).
export {
  buildRunPlan,
  checkSpec,
  getExerciseType,
  gradeSubmission,
  implementedExerciseTypes,
  instantiateTemplate,
  instantiateVariant,
  isWritingExercise,
  leakFingerprints,
  parseAnswer,
  parseSpec,
  redactSpec,
  registry,
  specMisconceptions,
  verifySpec,
} from './core/registry.ts';
export * from './core/types.ts';

// Language-neutral pieces from @proginone/exercise-core, re-exported so the apps keep one import.
export {
  EXERCISE_KIT_ERROR_CODES,
  ExerciseKitError,
  type ExerciseKitErrorCode,
  type RegisteredExerciseType,
  // Identifiers
  SLUG_SEGMENT_PATTERN,
  SLUG_PATTERN,
  SLUG_MAX_LENGTH,
  SEED_PATTERN,
  slugSchema,
  misconceptionIdSchema,
  conceptIdSchema,
  isSlug,
  isTemplateId,
  formatSeed,
  parseSeed,
  formatVariantId,
  parseVariantId,
  exerciseOriginOf,
  variantGroupKey,
  type ExerciseOrigin,
  // Choice types
  MCQ_MULTI_MAX_OPTIONS,
  mcqMulti,
  mcqMultiAnswerSchema,
  mcqMultiPublicSpecSchema,
  mcqMultiSpecSchema,
  type McqMultiAnswer,
  type McqMultiPublicSpec,
  type McqMultiSpec,
  BANNED_OPTION_TEXT,
  mcqSingle,
  mcqSingleAnswerSchema,
  mcqSinglePublicSpecSchema,
  mcqSingleSpecSchema,
  type McqSingleAnswer,
  type McqSinglePublicSpec,
  type McqSingleSpec,
  TRUE_FALSE_VERDICT_ONLY_SCORE,
  TRUE_FALSE_WEIGHT,
  trueFalse,
  trueFalseAnswerSchema,
  trueFalsePublicSpecSchema,
  trueFalseSpecSchema,
  type TrueFalseAnswer,
  type TrueFalsePublicSpec,
  type TrueFalseSpec,
} from '@proginone/exercise-core';

// Per-type definitions and schemas.
export * from './types/fill-blank.ts';
export * from './types/predict-output.ts';
export * from './types/parsons.ts';
export * from './types/find-bug-line.ts';
export * from './types/implement-function.ts';
export * from './types/fix-bug.ts';
export * from './types/web-task.ts';
export {
  codeAnswerSchema,
  codeFileSchema,
  type CodeAnswer,
  type CodeFile,
} from './types/code-common.ts';

// Check specification language, compilation to observation steps, and check grading.
export {
  checkSchema,
  checkListSchema,
  isRequired,
  isVisible,
  publicCheckSchema,
  redactCheck,
  LAYOUT_RELATIONS,
  type Check,
  type CheckKind,
  type CheckOf,
  type CssComparator,
  type DomExpect,
  type PublicCheck,
  type ValueExpect,
} from './checks/schema.ts';
export {
  compileChecks,
  stepId,
  SETTLE_STEP_ID,
  type CompiledChecks,
  type CompileOptions,
} from './checks/compile.ts';
export { evaluateChecks } from './checks/evaluate.ts';
export { gradeChecks, runFeedback, type CheckGrade, type Milestone } from './checks/aggregate.ts';

// Parametric template engine (instantiateTemplate / instantiateVariant above use this registry).
export {
  parseTemplate,
  renderString,
  renderValue,
  resolveParams,
  sampleSeeds,
  templateSchema,
  MAX_CONSTRAINT_ATTEMPTS,
  evaluateTemplateExpression,
  toLiteral,
  TEMPLATE_FUNCTIONS,
  paramSchema,
  paramsSchema,
  paramSpaceSize,
  RESERVED_IDENTIFIERS,
  type ExerciseTemplate,
  type TemplateInstance,
  type TemplateValue,
  type ParamDef,
} from '@proginone/exercise-core';

// Reusable comparison helpers (e.g. client-side quick feedback).
export { parseLiteral } from './common/literal.ts';
export {
  diffValues,
  fromJson,
  valuesEqual,
  type JsonValue,
  type ValueDiff,
} from './common/values.ts';
export { compareOutput, outputLineEquals, type LineComparison } from './common/output.ts';
export {
  normalizeBlankText,
  normalizeLeakText,
  normalizeOutputLines,
} from '@proginone/exercise-core';
export {
  createRng,
  deriveSeed,
  seedFromString,
  splitmix64,
  type Rng,
} from '@proginone/exercise-core';
