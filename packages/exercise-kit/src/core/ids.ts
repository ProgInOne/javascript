import { z } from 'zod';

/**
 * Identifier formats from docs/design/data-model.md#식별자-전략 and
 * docs/design/content-and-exercises.md#slug-규칙.
 */

/** One slug segment: lowercase letters, digits, single hyphens. */
export const SLUG_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Full dotted slug (data-model.md). */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
export const SLUG_MAX_LENGTH = 120;

/** Canonical seed: lowercase hex of a 64-bit value, no leading zeros (`0` for zero). */
export const SEED_PATTERN = /^(?:0|[1-9a-f][0-9a-f]{0,15})$/;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const UINT64_MAX = (1n << 64n) - 1n;

export const slugSchema = z.string().max(SLUG_MAX_LENGTH).regex(SLUG_PATTERN);
/** `<lang>.mc.<name>`, e.g. `js.mc.log-is-return`. */
export const misconceptionIdSchema = slugSchema.regex(/^[a-z0-9-]+\.mc\.[a-z0-9-]+$/);
/** `<lang>.<area>.<concept>`, e.g. `js.fn.return`. */
export const conceptIdSchema = slugSchema.regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+){2,}$/);

export function isSlug(value: string): boolean {
  return value.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(value);
}

/** `<lesson-slug>.t.<name>`. */
export function isTemplateId(value: string): boolean {
  if (!isSlug(value)) return false;
  const parts = value.split('.');
  return parts.length >= 3 && parts[parts.length - 2] === 't';
}

export function formatSeed(seed: bigint): string {
  if (seed < 0n || seed > UINT64_MAX) throw new RangeError('seed must be an unsigned 64-bit value');
  return seed.toString(16);
}

/** Parses a canonical seed string. Returns null for anything else (no leading zeros, ≤ 16 hex). */
export function parseSeed(value: string): bigint | null {
  return SEED_PATTERN.test(value) ? BigInt(`0x${value}`) : null;
}

export function formatVariantId(templateId: string, seed: bigint): string {
  return `${templateId}@${formatSeed(seed)}`;
}

/** Splits `<template-id>@<seed>`. Returns null when either part is malformed. */
export function parseVariantId(value: string): { templateId: string; seed: bigint } | null {
  const at = value.lastIndexOf('@');
  if (at <= 0) return null;
  const templateId = value.slice(0, at);
  const seed = parseSeed(value.slice(at + 1));
  if (seed === null || !isTemplateId(templateId)) return null;
  return { templateId, seed };
}

export type ExerciseOrigin = 'authored' | 'template' | 'generated';

/** Infers the origin of an exercise ID, or null when it matches no known format. */
export function exerciseOriginOf(id: string): ExerciseOrigin | null {
  if (id.startsWith('gen.')) return ULID_PATTERN.test(id.slice(4)) ? 'generated' : null;
  if (id.includes('@')) return parseVariantId(id) ? 'template' : null;
  return isSlug(id) && id.split('.').length >= 4 && !isTemplateId(id) ? 'authored' : null;
}

/**
 * Variant group key (glossary `variantGroupKey`): explicit `variantGroup`, else the template ID
 * for template variants, else the exercise ID.
 */
export function variantGroupKey(exercise: { id: string; variantGroup?: string | null }): string {
  if (exercise.variantGroup) return exercise.variantGroup;
  return parseVariantId(exercise.id)?.templateId ?? exercise.id;
}
