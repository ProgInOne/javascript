import {
  ExerciseKitError,
  getExerciseType,
  parseSpec,
  type RegisteredExerciseType,
} from '@proginone/exercise-kit';
import type { ContentExercise } from '../../db/content/repository.ts';
import { AppError } from '../../http/errors.ts';

/**
 * Maps exercise-kit boundary errors to API errors. Learner-side input problems become 400s;
 * anything about the stored spec or type is a content problem (500 `EXERCISE_UNSUPPORTED`).
 */
export function toAppError(e: unknown): unknown {
  if (!(e instanceof ExerciseKitError)) return e;
  const details = e.details.length > 0 ? { issues: e.details.slice(0, 20) } : undefined;
  const opts = { cause: e, ...(details ? { details } : {}) };
  switch (e.code) {
    case 'INVALID_ANSWER':
      return new AppError('VALIDATION_ANSWER_INVALID', 400, '답안 형식이 올바르지 않습니다.', opts);
    case 'INVALID_RUN_RESULT':
      return new AppError(
        'VALIDATION_RUN_RESULT_INVALID',
        400,
        '실행 결과 형식이 올바르지 않습니다.',
        opts,
      );
    case 'RUN_REQUIRED':
      return new AppError(
        'EXERCISE_RUN_REQUIRED',
        400,
        '이 문제는 코드를 실행한 결과가 있어야 채점할 수 있습니다.',
        opts,
      );
    default:
      return new AppError(
        'EXERCISE_UNSUPPORTED',
        500,
        '이 문제를 불러오지 못했습니다. 콘텐츠를 다시 빌드해 주세요.',
        opts,
      );
  }
}

/** Runs an exercise-kit call and rethrows its errors as {@link AppError}s. */
export function kit<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw toAppError(e);
  }
}

export interface LoadedSpec {
  def: RegisteredExerciseType;
  /** Validated spec with defaults applied (server only: holds answer keys). */
  spec: unknown;
}

/** The registered type and validated spec of a content exercise. */
export function loadSpec(exercise: ContentExercise): LoadedSpec {
  const def = getExerciseType(exercise.type);
  if (!def) {
    throw new AppError('EXERCISE_UNSUPPORTED', 500, '지원하지 않는 문제 유형입니다.', {
      details: { type: exercise.type },
    });
  }
  return { def, spec: kit(() => parseSpec(exercise.type, exercise.spec)) };
}
