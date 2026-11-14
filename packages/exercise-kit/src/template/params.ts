import { z } from 'zod';

import type { Rng } from '../common/prng.ts';
import { ExerciseKitError } from '../core/errors.ts';
import { evaluate, parseExpression, referencedNames, type TemplateValue } from './expr.ts';

/** Parameter kinds (docs/design/content-and-exercises.md#매개변수-종류). */

const INT_LIMIT = 1_000_000_000;
const intSchema = z.int().min(-INT_LIMIT).max(INT_LIMIT);
const identifierSchema = z.string().regex(/^[A-Za-z_$][\w$]{0,49}$/);
const lengthSchema = z.union([
  z.int().min(0).max(100),
  z
    .object({ min: z.int().min(0).max(100), max: z.int().min(0).max(100) })
    .refine((r) => r.min <= r.max, 'min > max'),
]);
const expressionSchema = z
  .string()
  .min(1)
  .refine((src) => {
    try {
      parseExpression(src);
      return true;
    } catch {
      return false;
    }
  }, 'invalid template expression');

/** Reserved words and confusing globals never produced by `identifier` params. */
export const RESERVED_IDENTIFIERS: ReadonlySet<string> = new Set(
  (
    'break case catch class const continue debugger default delete do else enum export extends false finally for ' +
    'function if import in instanceof new null return super switch this throw true try typeof var void while with ' +
    'yield let static implements interface package private protected public await arguments eval undefined NaN Infinity'
  ).split(' '),
);

const valueParamSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('int'),
      min: intSchema,
      max: intSchema,
      exclude: z.array(intSchema).max(100).optional(),
    })
    .refine((p) => p.min <= p.max, 'min > max'),
  z
    .object({
      kind: z.literal('float'),
      min: z.number(),
      max: z.number(),
      decimals: z.int().min(0).max(6).default(2),
    })
    .refine(
      (p) => p.min <= p.max && Math.abs(p.min) <= INT_LIMIT && Math.abs(p.max) <= INT_LIMIT,
      'invalid range',
    ),
  z.object({
    kind: z.literal('choice'),
    values: z
      .array(z.union([z.string().max(1_000), z.number(), z.boolean()]))
      .min(1)
      .max(100),
  }),
  z
    .object({
      kind: z.literal('string'),
      pool: z.array(z.string().max(1_000)).min(1).max(200).optional(),
      /** Mini pattern: literals, `\\x` escapes, `[a-z0-9]` classes, `{n}` / `{m,n}` quantifiers. */
      pattern: z.string().min(1).max(100).optional(),
    })
    .refine(
      (p) => (p.pool === undefined) !== (p.pattern === undefined),
      'string needs exactly one of pool or pattern',
    ),
]);
type ValueParam = z.infer<typeof valueParamSchema>;

export const paramSchema = z.discriminatedUnion('kind', [
  ...valueParamSchema.options,
  z.object({ kind: z.literal('identifier'), pool: z.array(identifierSchema).min(1).max(200) }),
  z
    .object({
      kind: z.literal('intArray'),
      length: lengthSchema,
      min: intSchema,
      max: intSchema,
      unique: z.boolean().default(false),
      sorted: z.enum(['asc', 'desc']).optional(),
    })
    .refine((p) => p.min <= p.max, 'min > max'),
  z.object({
    kind: z.literal('objectShape'),
    fields: z.object({
      /** Candidate property names; `count` distinct ones are picked. */
      names: z.array(identifierSchema).min(1).max(50),
      count: lengthSchema,
      value: valueParamSchema,
    }),
  }),
  z.object({ kind: z.literal('derived'), expr: expressionSchema }),
]);
export type ParamDef = z.infer<typeof paramSchema>;

export const paramsSchema = z
  .record(identifierSchema, paramSchema)
  .refine((p) => Object.keys(p).length <= 30, 'at most 30 params')
  .superRefine((params, ctx) => {
    for (const name of Object.keys(params)) {
      if (
        RESERVED_IDENTIFIERS.has(name) ||
        ['__proto__', 'constructor', 'prototype'].includes(name)
      )
        ctx.addIssue({ code: 'custom', message: `${name} is reserved`, path: [name] });
    }
    try {
      derivedOrder(params);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'invalid derived params',
      });
    }
    for (const [name, def] of Object.entries(params)) {
      if (def.kind === 'identifier' && def.pool.every((id) => RESERVED_IDENTIFIERS.has(id))) {
        ctx.addIssue({
          code: 'custom',
          message: 'identifier pool has only reserved words',
          path: [name],
        });
      }
      if (def.kind === 'intArray' && def.unique) {
        const maxLen = typeof def.length === 'number' ? def.length : def.length.max;
        if (def.max - def.min + 1 < maxLen)
          ctx.addIssue({ code: 'custom', message: 'range too small for unique', path: [name] });
      }
      if (def.kind === 'objectShape') {
        const maxCount =
          typeof def.fields.count === 'number' ? def.fields.count : def.fields.count.max;
        if (new Set(def.fields.names).size < maxCount)
          ctx.addIssue({ code: 'custom', message: 'not enough names', path: [name] });
      }
    }
  });
export type ParamDefs = z.infer<typeof paramsSchema>;

function invalid(message: string): never {
  throw new ExerciseKitError('INVALID_TEMPLATE', message);
}

/** Code-unit order: identical on every machine and locale. */
export function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Evaluation order of derived params: topological by references, ties broken by name.
 * Throws on unknown references or cycles.
 */
export function derivedOrder(params: Readonly<Record<string, ParamDef>>): string[] {
  const derived = Object.keys(params)
    .filter((n) => params[n]?.kind === 'derived')
    .sort(compareNames);
  const deps = new Map<string, Set<string>>();
  for (const name of derived) {
    const def = params[name];
    if (def?.kind !== 'derived') continue;
    const refs = referencedNames(def.expr);
    for (const ref of refs)
      if (!Object.hasOwn(params, ref)) invalid(`derived ${name} references unknown ${ref}`);
    deps.set(name, new Set([...refs].filter((r) => params[r]?.kind === 'derived')));
  }
  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < derived.length) {
    const next = derived.find(
      (n) => !done.has(n) && [...(deps.get(n) ?? [])].every((d) => done.has(d)),
    );
    if (next === undefined) invalid('derived params form a cycle');
    order.push(next);
    done.add(next);
  }
  return order;
}

function pickLength(length: z.infer<typeof lengthSchema>, rng: Rng): number {
  return typeof length === 'number' ? length : rng.int(length.min, length.max);
}

function sampleValue(def: ValueParam, rng: Rng): TemplateValue {
  switch (def.kind) {
    case 'int': {
      const excluded = [...new Set(def.exclude ?? [])]
        .filter((x) => x >= def.min && x <= def.max)
        .sort((a, b) => a - b);
      const count = def.max - def.min + 1 - excluded.length;
      if (count <= 0) invalid('int range is fully excluded');
      let value = def.min + rng.int(0, count - 1);
      for (const x of excluded) if (x <= value) value++;
      return value;
    }
    case 'float': {
      const scale = 10 ** def.decimals;
      const lo = Math.ceil(def.min * scale - 1e-9);
      const hi = Math.floor(def.max * scale + 1e-9);
      if (hi < lo) invalid('float range has no value at this precision');
      return rng.int(lo, hi) / scale;
    }
    case 'choice':
      return def.values[rng.int(0, def.values.length - 1)] ?? null;
    case 'string':
      return def.pool
        ? (def.pool[rng.int(0, def.pool.length - 1)] ?? '')
        : fromPattern(def.pattern ?? '', rng);
  }
}

/** Draws one parameter value. Derived params are evaluated by the caller. */
export function sampleParam(def: ParamDef, rng: Rng): TemplateValue {
  switch (def.kind) {
    case 'identifier': {
      const pool = def.pool.filter((id) => !RESERVED_IDENTIFIERS.has(id));
      return pool[rng.int(0, pool.length - 1)] ?? invalid('empty identifier pool');
    }
    case 'intArray': {
      const length = pickLength(def.length, rng);
      const out: number[] = [];
      const seen = new Set<number>();
      let guard = 0;
      while (out.length < length) {
        if (++guard > length * 1_000 + 1_000) invalid('could not draw unique values');
        const v = rng.int(def.min, def.max);
        if (def.unique && seen.has(v)) continue;
        seen.add(v);
        out.push(v);
      }
      if (def.sorted === 'asc') out.sort((a, b) => a - b);
      if (def.sorted === 'desc') out.sort((a, b) => b - a);
      return out;
    }
    case 'objectShape': {
      const count = pickLength(def.fields.count, rng);
      const names = rng.shuffle([...new Set(def.fields.names)]).slice(0, count);
      const obj: Record<string, TemplateValue> = {};
      for (const name of names) obj[name] = sampleValue(def.fields.value, rng);
      return obj;
    }
    case 'derived':
      return invalid('derived params are evaluated, not sampled');
    default:
      return sampleValue(def, rng);
  }
}

/** Draws every parameter: random ones in name order, then derived ones in dependency order. */
export function drawParams(
  params: Readonly<Record<string, ParamDef>>,
  rng: Rng,
): Map<string, TemplateValue> {
  const scope = new Map<string, TemplateValue>();
  for (const name of Object.keys(params).sort(compareNames)) {
    const def = params[name];
    if (def && def.kind !== 'derived') scope.set(name, sampleParam(def, rng));
  }
  for (const name of derivedOrder(params)) {
    const def = params[name];
    if (def?.kind === 'derived') scope.set(name, evaluate(def.expr, scope));
  }
  return scope;
}

const MAX_PATTERN_OUTPUT = 200;

/** Generates a string from the mini pattern language. */
export function fromPattern(pattern: string, rng: Rng): string {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    let chars: string[];
    const ch = pattern.charAt(i);
    if (ch === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end < 0) invalid('unterminated [ in pattern');
      chars = expandClass(pattern.slice(i + 1, end));
      i = end + 1;
    } else if (ch === '\\') {
      chars = [pattern.charAt(i + 1)];
      i += 2;
    } else {
      chars = [ch];
      i++;
    }
    let times = 1;
    const quant = /^\{(\d{1,3})(?:,(\d{1,3}))?\}/.exec(pattern.slice(i));
    if (quant) {
      const min = Number(quant[1]);
      const max = quant[2] === undefined ? min : Number(quant[2]);
      if (max < min) invalid('bad quantifier in pattern');
      times = rng.int(min, max);
      i += quant[0].length;
    }
    for (let k = 0; k < times; k++) out += chars[rng.int(0, chars.length - 1)] ?? '';
    if (out.length > MAX_PATTERN_OUTPUT) invalid('pattern output is too long');
  }
  return out;
}

function expandClass(body: string): string[] {
  const chars: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const start = body.charCodeAt(i);
    if (body.charAt(i + 1) === '-' && i + 2 < body.length) {
      const end = body.charCodeAt(i + 2);
      if (end < start || end - start > 256) invalid('bad range in pattern');
      for (let c = start; c <= end; c++) chars.push(String.fromCharCode(c));
      i += 2;
    } else chars.push(body.charAt(i));
  }
  if (chars.length === 0) invalid('empty class in pattern');
  return chars;
}

/**
 * Upper bound of distinct parameter combinations (before constraints). `Infinity` when it does
 * not fit a safe integer. Used to compare with `variantPolicy.maxVariants`.
 */
export function paramSpaceSize(params: Readonly<Record<string, ParamDef>>): number {
  let total = 1;
  for (const def of Object.values(params)) {
    total *= paramSize(def);
    if (!Number.isSafeInteger(total)) return Infinity;
  }
  return total;
}

function lengths(length: z.infer<typeof lengthSchema>): number[] {
  if (typeof length === 'number') return [length];
  return Array.from({ length: length.max - length.min + 1 }, (_, i) => length.min + i);
}

function valueSize(def: ValueParam): number {
  switch (def.kind) {
    case 'int':
      return (
        def.max -
        def.min +
        1 -
        new Set((def.exclude ?? []).filter((x) => x >= def.min && x <= def.max)).size
      );
    case 'float':
      return Math.max(
        0,
        Math.floor(def.max * 10 ** def.decimals + 1e-9) -
          Math.ceil(def.min * 10 ** def.decimals - 1e-9) +
          1,
      );
    case 'choice':
      return new Set(def.values).size;
    case 'string':
      return def.pool ? new Set(def.pool).size : Infinity;
  }
}

function paramSize(def: ParamDef): number {
  switch (def.kind) {
    case 'identifier':
      return new Set(def.pool.filter((id) => !RESERVED_IDENTIFIERS.has(id))).size;
    case 'derived':
      return 1;
    case 'intArray': {
      const range = def.max - def.min + 1;
      return lengths(def.length).reduce((sum, n) => {
        if (!def.unique) return sum + range ** n;
        // Unique: permutations, or combinations when sorted.
        let perms = 1;
        for (let k = 0; k < n; k++) perms *= range - k;
        let fact = 1;
        for (let k = 2; k <= n; k++) fact *= k;
        return sum + (def.sorted ? perms / fact : perms);
      }, 0);
    }
    case 'objectShape': {
      const names = new Set(def.fields.names).size;
      const values = valueSize(def.fields.value);
      return lengths(def.fields.count).reduce((sum, n) => {
        let perms = 1;
        for (let k = 0; k < n; k++) perms *= names - k;
        return sum + perms * values ** n;
      }, 0);
    }
    default:
      return valueSize(def);
  }
}
