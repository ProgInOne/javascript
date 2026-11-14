import {
  fillBlankPublicSpecSchema,
  fixBugPublicSpecSchema,
  implementFunctionPublicSpecSchema,
  mcqSinglePublicSpecSchema,
  predictOutputPublicSpecSchema,
  webTaskPublicSpecSchema,
  type CodeAnswer,
  type FillBlankAnswer,
  type FillBlankPublicSpec,
  type FixBugPublicSpec,
  type ImplementFunctionPublicSpec,
  type McqSingleAnswer,
  type McqSinglePublicSpec,
  type PredictOutputAnswer,
  type PredictOutputPublicSpec,
  type WebTaskPublicSpec,
} from '@proginone/exercise-kit';
import type { z } from 'zod';

/** Exercise types with a v0.1 renderer (roadmap M4). */
export const RENDERABLE_TYPE_IDS = [
  'mcq_single',
  'fill_blank',
  'predict_output',
  'implement_function',
  'fix_bug',
  'web_task',
] as const;
export type RenderableTypeId = (typeof RENDERABLE_TYPE_IDS)[number];

export interface PublicSpecByType {
  mcq_single: McqSinglePublicSpec;
  fill_blank: FillBlankPublicSpec;
  predict_output: PredictOutputPublicSpec;
  implement_function: ImplementFunctionPublicSpec;
  fix_bug: FixBugPublicSpec;
  web_task: WebTaskPublicSpec;
}

/**
 * Answer value a renderer holds. `null` means "nothing chosen yet" for choice-like types;
 * submit only when {@link isAnswerReady} is true.
 */
export interface AnswerByType {
  mcq_single: McqSingleAnswer | null;
  fill_blank: FillBlankAnswer;
  predict_output: PredictOutputAnswer | null;
  implement_function: CodeAnswer;
  fix_bug: CodeAnswer;
  web_task: CodeAnswer;
}

/** A renderable exercise: type ID plus its public spec (discriminated by `typeId`). */
export type RenderableExercise = {
  [T in RenderableTypeId]: { typeId: T; spec: PublicSpecByType[T] };
}[RenderableTypeId];

const PUBLIC_SPEC_SCHEMAS: { [T in RenderableTypeId]: z.ZodType<PublicSpecByType[T]> } = {
  mcq_single: mcqSinglePublicSpecSchema,
  fill_blank: fillBlankPublicSpecSchema,
  predict_output: predictOutputPublicSpecSchema,
  implement_function: implementFunctionPublicSpecSchema,
  fix_bug: fixBugPublicSpecSchema,
  web_task: webTaskPublicSpecSchema,
};

export function isRenderableType(typeId: string): typeId is RenderableTypeId {
  return (RENDERABLE_TYPE_IDS as readonly string[]).includes(typeId);
}

/**
 * Validates a public spec from the API with exercise-kit's public schema. Returns `null` for an
 * unknown type or an invalid spec (show an error state instead of rendering a broken exercise).
 */
export function parsePublicSpec(typeId: string, raw: unknown): RenderableExercise | null {
  if (!isRenderableType(typeId)) return null;
  const parsed = PUBLIC_SPEC_SCHEMAS[typeId].safeParse(raw);
  if (!parsed.success) return null;
  return { typeId, spec: parsed.data } as RenderableExercise;
}

/** Initial (empty) answer: nothing chosen, empty blanks, or the starter / buggy files. */
export function initialAnswer<E extends RenderableExercise>(
  exercise: E,
): AnswerByType[E['typeId']] {
  return initialAnswerOf(exercise) as AnswerByType[E['typeId']];
}

function initialAnswerOf(exercise: RenderableExercise): AnswerByType[RenderableTypeId] {
  switch (exercise.typeId) {
    case 'mcq_single':
    case 'predict_output':
      return null;
    case 'fill_blank':
      return { blanks: {} };
    case 'implement_function':
    case 'web_task':
      return { files: exercise.spec.starter.files.map((f) => ({ ...f })) };
    case 'fix_bug':
      return { files: exercise.spec.buggy.files.map((f) => ({ ...f })) };
  }
}

/**
 * Whether the answer can be submitted: an option is chosen, every blank has text, the prediction
 * is not empty. Code answers are always submittable (the checks decide).
 */
export function isAnswerReady(
  exercise: RenderableExercise,
  answer: AnswerByType[RenderableTypeId],
): boolean {
  if (answer === null) return false;
  switch (exercise.typeId) {
    case 'mcq_single':
      return 'optionId' in answer && answer.optionId !== '';
    case 'fill_blank':
      return (
        'blanks' in answer &&
        exercise.spec.blanks.every((b) => (answer.blanks[b.id] ?? '').trim() !== '')
      );
    case 'predict_output':
      if ('console' in answer) return answer.console.trim() !== '';
      if ('value' in answer) return answer.value.trim() !== '';
      if ('choiceId' in answer) return answer.choiceId !== '';
      return 'error' in answer;
    case 'implement_function':
    case 'fix_bug':
    case 'web_task':
      return 'files' in answer;
  }
}

/** Reason shown by the confidence picker while the answer is not ready. */
export function notReadyReason(exercise: RenderableExercise): string {
  switch (exercise.typeId) {
    case 'mcq_single':
      return '답을 먼저 골라 주세요.';
    case 'fill_blank':
      return '빈칸을 모두 채워 주세요.';
    case 'predict_output':
      return exercise.spec.answerKind === 'choice' || exercise.spec.answerKind === 'error'
        ? '답을 먼저 골라 주세요.'
        : '예측한 결과를 먼저 적어 주세요.';
    default:
      return '코드를 작성해 주세요.';
  }
}
