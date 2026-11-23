import type { ExerciseTypeDef as CoreExerciseTypeDef, RunOutcome } from '@proginone/exercise-core';
import type { RunPlan, RunResult, RunStatus } from '@proginone/run-contract';

// The JavaScript side of the exercise type system. The language-neutral types live in
// @proginone/exercise-core (D-096); this file narrows them to this repository's types and runner.

export type {
  CheckResult,
  ExerciseCategory,
  FeedbackItem,
  GradeOutcome,
  GradeResult,
  MilestoneResult,
  RedactOptions,
  RunPlanOptions,
  ServerFindings,
  VerifyIssue,
} from '@proginone/exercise-core';
export { EXERCISE_CATEGORIES } from '@proginone/exercise-core';

/** All type IDs from docs/design/content-and-exercises.md#유형-목록과-우선순위. */
export const EXERCISE_TYPE_IDS = [
  'mcq_single',
  'mcq_multi',
  'true_false',
  'fill_blank',
  'predict_output',
  'parsons',
  'find_bug_line',
  'implement_function',
  'fix_bug',
  'web_task',
  'matching',
  'trace_variables',
  'find_false_statement',
  'order_execution',
  'explain_code',
  'refactor',
] as const;
export type ExerciseTypeId = (typeof EXERCISE_TYPE_IDS)[number];

/**
 * Why a check failed in this repository's check language. `CheckResult.reason` is a string in
 * @proginone/exercise-core; the JS checks only produce these codes.
 */
export type CheckFailReason =
  | 'MISMATCH'
  | 'MISSING_IDENTIFIER'
  | 'NOT_CALLABLE'
  | 'THREW'
  | 'DID_NOT_THROW'
  | 'MUTATED_ARGS'
  | 'SAME_REFERENCE'
  | 'CIRCULAR_VALUE'
  | 'TRUNCATED_VALUE'
  | 'NOT_FOUND'
  | 'INVALID_SELECTOR'
  | 'NOT_OBSERVED'
  | 'STEP_TIMEOUT'
  | 'STEP_ERROR'
  | 'VIOLATION'
  | 'RUN_FAILED';

/** An exercise type of this repository: it runs in the JS runner (`RunResult`, `RunPlan`). */
export type ExerciseTypeDef<Spec, PublicSpec, Answer> = CoreExerciseTypeDef<
  Spec,
  PublicSpec,
  Answer,
  RunResult,
  RunPlan
> & { id: ExerciseTypeId };

/**
 * The JS runner's status read as a language-neutral run outcome: the learner's code failing
 * (`error`, `timeout`, `loop_limit`) is an answer; the sandbox failing (`crashed`, `aborted`) is not.
 */
export function runOutcomeOf(status: RunStatus): RunOutcome {
  switch (status) {
    case 'error':
    case 'timeout':
    case 'loop_limit':
      return 'learner_failure';
    case 'crashed':
    case 'aborted':
      return 'sandbox_failure';
    case 'completed':
      return 'ok';
  }
}
