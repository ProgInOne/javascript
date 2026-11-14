import type { ExerciseId } from './types.ts';

/**
 * Variant group key of an exercise: its `variant_group`, else the template ID for template
 * variants, else the exercise ID. Same key = "practically the same question" for `W_rep`, the
 * variant-group gates and set de-duplication.
 */
export function resolveVariantGroupKey(exercise: {
  readonly id: ExerciseId;
  readonly variantGroup?: string | null;
  readonly templateId?: string | null;
}): string {
  if (
    exercise.variantGroup !== undefined &&
    exercise.variantGroup !== null &&
    exercise.variantGroup !== ''
  ) {
    return exercise.variantGroup;
  }
  if (
    exercise.templateId !== undefined &&
    exercise.templateId !== null &&
    exercise.templateId !== ''
  ) {
    return exercise.templateId;
  }
  // Template variant IDs are `<template ID>@<seed>`.
  const at = exercise.id.lastIndexOf('@');
  return at > 0 ? exercise.id.slice(0, at) : exercise.id;
}
