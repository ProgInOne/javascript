import { hasProtoKey, withinDepth } from '@proginone/run-contract';
import { z } from 'zod';

import { createRng, deriveSeed, seedFromString } from '../common/prng.ts';
import { ExerciseKitError } from '../core/errors.ts';
import { formatVariantId, isTemplateId, parseVariantId } from '../core/ids.ts';
import { parseSpec } from '../core/registry.ts';
import {
  evaluate,
  parseExpression,
  toText,
  truthy,
  type Scope,
  type TemplateValue,
} from './expr.ts';
import { drawParams, paramsSchema } from './params.ts';

/**
 * Parametric template engine (docs/design/content-and-exercises.md#파라메트릭-템플릿).
 *
 * `<templateId>@<seed>` always yields the same variant:
 * 1. attempt 0 uses `seed`; attempt k uses `deriveSeed` of attempt k-1's seed
 * 2. each attempt seeds `xoshiro128**` and draws params in name order, then derived params
 * 3. the first attempt that satisfies every constraint wins (at most 100 attempts)
 * 4. every string in `render`, `spec`, `hints`, `explanation` (and spec object keys) is rendered:
 *    `{{ expr }}` → template expression; `{{blank:id}}` (fill_blank placeholders) stays as is
 */

export const MAX_CONSTRAINT_ATTEMPTS = 100;
const PLACEHOLDER = /\{\{([\s\S]*?)\}\}/g;
const BLANK_PLACEHOLDER = /^blank:[a-z0-9][a-z0-9_-]{0,47}$/;
const MAX_RENDER_NODES = 20_000;

const templateStringSchema = z.string().max(20_000);

/** Fields the engine needs. Other top-level fields (difficulty, concepts, …) belong to content-schema. */
export const templateSchema = z.looseObject({
  id: z.string().refine(isTemplateId, 'template id must be <lesson-slug>.t.<name>'),
  type: z.string().min(1).max(50),
  params: paramsSchema,
  constraints: z
    .array(
      z.string().refine((src) => {
        try {
          parseExpression(src);
          return true;
        } catch {
          return false;
        }
      }, 'invalid constraint expression'),
    )
    .max(30)
    .default([]),
  render: z.record(z.string().max(50), templateStringSchema).default({}),
  spec: z.unknown(),
  hints: z.array(templateStringSchema).max(10).optional(),
  explanation: templateStringSchema.optional(),
  variantPolicy: z
    .object({
      maxVariants: z.int().min(1).max(1_000_000).optional(),
      minDistinctFromRecent: z.int().min(0).max(100).optional(),
    })
    .optional(),
});
export type ExerciseTemplate = z.infer<typeof templateSchema>;

export interface TemplateInstance {
  variantId: string;
  templateId: string;
  type: string;
  seed: bigint;
  /** Which constraint attempt produced the params (0 = the seed itself). */
  attempt: number;
  params: Record<string, TemplateValue>;
  /** Rendered `render` fields (e.g. `prompt`, `code`). */
  render: Record<string, string>;
  /** Rendered spec, validated with the type's spec schema. */
  spec: unknown;
  hints?: string[];
  explanation?: string;
  /** Default variant group: the template ID (glossary `variantGroupKey`). */
  variantGroup: string;
}

/** Validates a raw template. Throws `INVALID_TEMPLATE` with issue paths. */
export function parseTemplate(raw: unknown): ExerciseTemplate {
  if (!withinDepth(raw) || hasProtoKey(raw)) {
    throw new ExerciseKitError(
      'INVALID_TEMPLATE',
      'template nests too deeply or has a __proto__ key',
    );
  }
  const parsed = templateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ExerciseKitError(
      'INVALID_TEMPLATE',
      'invalid template',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  return parsed.data;
}

/** Renders `{{ }}` expressions in one string. */
export function renderString(text: string, scope: Scope): string {
  return text.replace(PLACEHOLDER, (whole, inner: string) => {
    if (BLANK_PLACEHOLDER.test(inner.trim())) return whole;
    return toText(evaluate(inner.trim(), scope));
  });
}

/** Renders every string (and object key) in a JSON-like value. */
export function renderValue(value: unknown, scope: Scope): unknown {
  let nodes = 0;
  const walk = (v: unknown): unknown => {
    if (++nodes > MAX_RENDER_NODES)
      throw new ExerciseKitError('INVALID_TEMPLATE', 'template is too large');
    if (typeof v === 'string') return renderString(v, scope);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(v)) {
        const renderedKey = renderString(key, scope);
        if (renderedKey === '__proto__')
          throw new ExerciseKitError('INVALID_TEMPLATE', 'key __proto__ is not allowed');
        if (Object.hasOwn(out, renderedKey)) {
          throw new ExerciseKitError('INVALID_TEMPLATE', `rendered key collides: ${renderedKey}`);
        }
        out[renderedKey] = walk(child);
      }
      return out;
    }
    return v;
  };
  return walk(value);
}

/** Draws params for a seed, retrying derived seeds until the constraints hold. */
export function resolveParams(
  template: Pick<ExerciseTemplate, 'params' | 'constraints'>,
  seed: bigint,
): { params: Map<string, TemplateValue>; attempt: number } {
  let current = seed;
  for (let attempt = 0; attempt < MAX_CONSTRAINT_ATTEMPTS; attempt++) {
    const params = drawParams(template.params, createRng(current));
    if (template.constraints.every((c) => truthy(evaluate(c, params)))) return { params, attempt };
    current = deriveSeed(current);
  }
  throw new ExerciseKitError(
    'TEMPLATE_CONSTRAINTS_UNSATISFIABLE',
    `no params satisfy the constraints within ${MAX_CONSTRAINT_ATTEMPTS} attempts`,
  );
}

/**
 * Instantiates a template for one seed. Pure and deterministic: the same template and seed give
 * a deep-equal result on every machine. The rendered spec is validated with the type's schema
 * (`INVALID_SPEC` means the template renders an invalid spec for this seed).
 */
export function instantiateTemplate(rawTemplate: unknown, seed: bigint): TemplateInstance {
  const template = parseTemplate(rawTemplate);
  const { params, attempt } = resolveParams(template, seed);
  const render: Record<string, string> = {};
  for (const [key, text] of Object.entries(template.render))
    render[key] = renderString(text, params);
  const instance: TemplateInstance = {
    variantId: formatVariantId(template.id, seed),
    templateId: template.id,
    type: template.type,
    seed,
    attempt,
    params: Object.fromEntries(params),
    render,
    spec: parseSpec(template.type, renderValue(template.spec, params)),
    variantGroup: template.id,
  };
  if (template.hints) instance.hints = template.hints.map((h) => renderString(h, params));
  if (template.explanation !== undefined)
    instance.explanation = renderString(template.explanation, params);
  return instance;
}

/** Instantiates `<templateId>@<seed>`; the ID must match the template. */
export function instantiateVariant(rawTemplate: unknown, variantId: string): TemplateInstance {
  const parsed = parseVariantId(variantId);
  if (!parsed) throw new ExerciseKitError('INVALID_ID', `invalid variant id ${variantId}`);
  const template = parseTemplate(rawTemplate);
  if (template.id !== parsed.templateId) {
    throw new ExerciseKitError(
      'INVALID_ID',
      `variant ${variantId} does not belong to ${template.id}`,
    );
  }
  return instantiateTemplate(template, parsed.seed);
}

/**
 * Deterministic sample seeds for build-time verification (`content-cli` runs N of them):
 * seed i = `seedFromString("<templateId>#<i>")`.
 */
export function sampleSeeds(templateId: string, count: number): bigint[] {
  return Array.from({ length: count }, (_, i) => seedFromString(`${templateId}#${i}`));
}
