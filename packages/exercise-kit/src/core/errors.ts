/**
 * Error codes thrown by exercise-kit. They signal a bad *input* (spec, answer, run result,
 * template) — never a wrong answer, which is a normal {@link GradeResult}. The server maps
 * `INVALID_ANSWER` / `INVALID_RUN_RESULT` to `VALIDATION_FAILED`, the rest to content errors.
 */
export const EXERCISE_KIT_ERROR_CODES = [
  'UNKNOWN_TYPE',
  'INVALID_SPEC',
  'INVALID_ANSWER',
  'INVALID_RUN_RESULT',
  'RUN_REQUIRED',
  'EXPECTED_MISSING',
  'INVALID_ID',
  'INVALID_TEMPLATE',
  'TEMPLATE_EXPRESSION',
  'TEMPLATE_CONSTRAINTS_UNSATISFIABLE',
] as const;
export type ExerciseKitErrorCode = (typeof EXERCISE_KIT_ERROR_CODES)[number];

export class ExerciseKitError extends Error {
  readonly code: ExerciseKitErrorCode;
  readonly details: readonly string[];

  constructor(code: ExerciseKitErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'ExerciseKitError';
    this.code = code;
    this.details = details;
  }
}
