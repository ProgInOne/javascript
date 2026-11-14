// Registry and boundary functions (validate untrusted input, then call pure graders).
export {
  buildRunPlan,
  checkSpec,
  getExerciseType,
  gradeSubmission,
  implementedExerciseTypes,
  leakFingerprints,
  parseAnswer,
  parseSpec,
  redactSpec,
  specMisconceptions,
  verifySpec,
  type RegisteredExerciseType,
} from './core/registry.ts';
export * from './core/types.ts';
export * from './core/errors.ts';
export * from './core/ids.ts';

// Per-type definitions and schemas.
export * from './types/mcq-single.ts';
export * from './types/mcq-multi.ts';
export * from './types/true-false.ts';
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

// Parametric template engine.
export {
  instantiateTemplate,
  instantiateVariant,
  parseTemplate,
  renderString,
  renderValue,
  resolveParams,
  sampleSeeds,
  templateSchema,
  MAX_CONSTRAINT_ATTEMPTS,
  type ExerciseTemplate,
  type TemplateInstance,
} from './template/engine.ts';
export {
  evaluate as evaluateTemplateExpression,
  toLiteral,
  TEMPLATE_FUNCTIONS,
  type TemplateValue,
} from './template/expr.ts';
export {
  paramSchema,
  paramsSchema,
  paramSpaceSize,
  RESERVED_IDENTIFIERS,
  type ParamDef,
} from './template/params.ts';

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
export { normalizeBlankText, normalizeLeakText, normalizeOutputLines } from './common/normalize.ts';
export { createRng, deriveSeed, seedFromString, splitmix64, type Rng } from './common/prng.ts';
