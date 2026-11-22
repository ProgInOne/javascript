import { A11Y_IMPACTS } from '@proginone/run-contract';
import { z } from 'zod';

import { parseLiteral } from '../common/literal.ts';
import { jsonValueSchema, localIdSchema, uniqueIds } from '../common/schemas.ts';
import { misconceptionIdSchema } from '../core/ids.ts';

/**
 * Check specification language (docs/design/content-and-exercises.md#체크-명세-언어).
 * Checks are data: AI-generated content cannot smuggle code in, and every field has a limit.
 */

export const identifierSchema = z.string().regex(/^[A-Za-z_$][\w$]{0,99}$/);
const selectorSchema = z.string().min(1).max(500);
const literalSchema = z
  .string()
  .max(10_000)
  .refine((text) => parseLiteral(text) !== null, 'must be a JavaScript literal');

const checkBase = {
  id: localIdSchema,
  /** Shown to the learner even for hidden checks. */
  description: z.string().max(500).optional(),
  /** Expectation visible to the learner. Default: `call`/`console` true, others false. */
  visible: z.boolean().optional(),
  /** Counts for the verdict. Default true (`static` false: "추가 도전"). */
  required: z.boolean().optional(),
  /** Partial-score weight. */
  weight: z.number().positive().max(100).default(1),
  /** Which requirement of the prompt this check verifies (feedback groups failures by it). */
  requirement: z.string().min(1).max(100).optional(),
  misconceptionIfFail: misconceptionIdSchema.optional(),
  /** Viewport width for web checks (default: the exercise's first viewport). */
  viewport: z.int().min(200).max(3_840).optional(),
};

/** Value expectations shared by `call` and `program` checks. Exactly one key. */
const valueExpectSchema = z.union([
  z.strictObject({ equals: jsonValueSchema }),
  z.strictObject({ equalsLiteral: literalSchema }),
  z.strictObject({ strictEquals: jsonValueSchema }),
  z.strictObject({ strictEqualsLiteral: literalSchema }),
  z.strictObject({
    closeTo: z.object({ value: z.number(), epsilon: z.number().positive().max(1).default(1e-9) }),
  }),
  z.strictObject({
    matches: z
      .object({
        type: z
          .enum(['array', 'object', 'string', 'number', 'boolean', 'null', 'undefined'])
          .optional(),
        length: z.int().min(0).optional(),
        contains: z.array(jsonValueSchema).max(50).optional(),
      })
      .refine((m) => Object.keys(m).length > 0, 'matches needs at least one condition'),
  }),
]);
export type ValueExpect = z.infer<typeof valueExpectSchema>;

const callExpectSchema = z.union([
  valueExpectSchema,
  z.strictObject({
    throws: z.object({
      name: z.string().max(100).optional(),
      messageIncludes: z.string().max(500).optional(),
    }),
  }),
  z.strictObject({ argsUnchanged: z.literal(true) }),
  z.strictObject({ returnsNewReference: z.literal(true) }),
]);
export type CallExpect = z.infer<typeof callExpectSchema>;

const callCheckSchema = z
  .object({
    ...checkBase,
    kind: z.literal('call'),
    args: z.array(jsonValueSchema).max(20).default([]),
    /** JS expression for arguments JSON cannot express; the Prepare Worker runs it as a classic script. */
    argsExpr: z.string().max(2_000).optional(),
    expect: callExpectSchema,
  })
  .refine(
    (c) =>
      !(
        c.argsExpr !== undefined &&
        ('argsUnchanged' in c.expect || 'returnsNewReference' in c.expect)
      ),
    'argsUnchanged/returnsNewReference need JSON args (not argsExpr) to compare with',
  );

const consoleCheckSchema = z.object({
  ...checkBase,
  kind: z.literal('console'),
  /** Values returned by successive `prompt()` calls (RunPlan.stdin). */
  promptInputs: z.array(z.string().max(1_000)).max(100).optional(),
  expect: z.object({
    lines: z.array(z.string().max(10_000)).max(1_000),
    mode: z.enum(['exact', 'contains', 'ordered-subset']).default('exact'),
    allowExtraTrailing: z.boolean().default(false),
  }),
});

const programCheckSchema = z.object({
  ...checkBase,
  kind: z.literal('program'),
  expect: z
    .object({
      globals: z
        .record(identifierSchema, valueExpectSchema)
        .refine((g) => Object.keys(g).length <= 20, 'at most 20 globals')
        .optional(),
      /** No uncaught runtime error during the program. */
      noError: z.boolean().optional(),
    })
    .refine((e) => e.globals !== undefined || e.noError !== undefined, 'program expect is empty'),
});

const rangeSchema = z
  .object({ min: z.int().min(0).optional(), max: z.int().min(0).optional() })
  .refine((r) => r.min !== undefined || r.max !== undefined, 'range needs min or max');

const textExpectSchema = z
  .object({
    equals: z.string().max(10_000).optional(),
    includes: z.string().max(10_000).optional(),
    /** Collapse whitespace and trim before comparing (default true). */
    trim: z.boolean().default(true),
    caseSensitive: z.boolean().default(true),
    /** Apply to every matched element (default: first). */
    all: z.boolean().default(false),
  })
  .refine(
    (t) => t.equals !== undefined || t.includes !== undefined,
    'text needs equals or includes',
  );

/** DOM state expectation (dom checks and event check outcomes). */
const domExpectFields = {
  exists: z.boolean().optional(),
  count: z.union([z.int().min(0), rangeSchema]).optional(),
  text: textExpectSchema.optional(),
  attr: z
    .object({
      name: z.string().regex(/^[a-z][a-z0-9_:.-]{0,99}$/i),
      present: z.boolean().optional(),
      notEmpty: z.boolean().optional(),
      equals: z.string().max(10_000).optional(),
    })
    .optional(),
  tag: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,49}$/i)
    .optional(),
  value: z.string().max(10_000).optional(),
  checked: z.boolean().optional(),
  /** Every matched element's parent matches this selector. */
  parentSelector: selectorSchema.optional(),
  /** Tag names of the matched element's children appear in this order. */
  order: z
    .array(z.string().regex(/^[a-z][a-z0-9-]{0,49}$/i))
    .min(2)
    .max(20)
    .optional(),
  /** Apply attr/tag/value/checked to every matched element (default: first). */
  all: z.boolean().default(false),
};
const hasDomExpectation = (e: Record<string, unknown>) =>
  ['exists', 'count', 'text', 'attr', 'tag', 'value', 'checked', 'parentSelector', 'order'].some(
    (k) => e[k] !== undefined,
  );

const domExpectSchema = z.object(domExpectFields).refine(hasDomExpectation, 'dom expect is empty');
export type DomExpect = z.infer<typeof domExpectSchema>;

const domCheckSchema = z.object({
  ...checkBase,
  kind: z.literal('dom'),
  selector: selectorSchema,
  expect: domExpectSchema,
});

const eventStepSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.enum(['click', 'dblclick', 'submit', 'focus', 'blur']),
    selector: selectorSchema,
  }),
  z.object({ action: z.literal('type'), selector: selectorSchema, value: z.string().max(10_000) }),
  z.object({
    action: z.literal('change'),
    selector: selectorSchema,
    value: z.string().max(10_000).optional(),
  }),
  z.object({
    action: z.literal('keydown'),
    selector: selectorSchema,
    key: z.string().min(1).max(50),
  }),
  z.object({ action: z.literal('wait'), ms: z.int().min(0).max(60_000).default(0) }),
]);
export type EventStep = z.infer<typeof eventStepSchema>;

const eventCheckSchema = z.object({
  ...checkBase,
  kind: z.literal('event'),
  steps: z.array(eventStepSchema).min(1).max(30),
  expect: z
    .array(
      z.object({ selector: selectorSchema, ...domExpectFields }).refine(hasDomExpectation, 'empty'),
    )
    .min(1)
    .max(20),
});

const cssComparatorSchema = z.union([
  z.strictObject({ equals: z.string().max(500) }),
  z.strictObject({ oneOf: z.array(z.string().max(500)).min(1).max(20) }),
  z.strictObject({
    px: z
      .object({
        value: z.number().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        tolerance: z.number().min(0).max(50).default(0.5),
      })
      .refine(
        (p) => p.value !== undefined || p.min !== undefined || p.max !== undefined,
        'px needs a bound',
      ),
  }),
  z.strictObject({
    numeric: z
      .object({
        value: z.number().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      })
      .refine(
        (n) => n.value !== undefined || n.min !== undefined || n.max !== undefined,
        'numeric needs a bound',
      ),
  }),
  z.strictObject({ color: z.string().max(100), deltaE: z.number().min(0).max(100).default(3) }),
]);
export type CssComparator = z.infer<typeof cssComparatorSchema>;

const cssCheckSchema = z.object({
  ...checkBase,
  kind: z.literal('css'),
  selector: selectorSchema,
  all: z.boolean().default(false),
  pseudo: z.enum(['::before', '::after', '::marker', '::placeholder']).optional(),
  expect: z.object({
    computed: z
      .record(z.string().regex(/^-?[a-z][a-z0-9-]{0,99}$/), cssComparatorSchema)
      .refine((c) => Object.keys(c).length >= 1 && Object.keys(c).length <= 30, '1..30 properties'),
  }),
});

export const LAYOUT_RELATIONS = [
  'left-of',
  'right-of',
  'above',
  'below',
  'inside',
  'same-row',
  'same-column',
  'centered-horizontally',
  'centered-vertically',
  'fills-width',
] as const;
const CONTAINER_RELATIONS = new Set([
  'centered-horizontally',
  'centered-vertically',
  'fills-width',
]);

const layoutCheckSchema = z
  .object({
    ...checkBase,
    kind: z.literal('layout'),
    a: selectorSchema,
    b: selectorSchema.optional(),
    container: selectorSchema.optional(),
    relation: z.enum(LAYOUT_RELATIONS).optional(),
    gap: z
      .object({ axis: z.enum(['x', 'y']), min: z.number().optional(), max: z.number().optional() })
      .optional(),
    tolerancePx: z.number().min(0).max(100).default(2),
  })
  .superRefine((c, ctx) => {
    if ((c.relation === undefined) === (c.gap === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'layout needs exactly one of relation or gap' });
    }
    const needsContainer = c.relation !== undefined && CONTAINER_RELATIONS.has(c.relation);
    if (needsContainer && c.container === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `${c.relation ?? ''} needs container`,
        path: ['container'],
      });
    }
    const needsB =
      c.gap !== undefined ||
      (c.relation !== undefined && !needsContainer && c.relation !== 'inside');
    if (needsB && c.b === undefined)
      ctx.addIssue({ code: 'custom', message: 'needs b', path: ['b'] });
    if (c.relation === 'inside' && c.b === undefined && c.container === undefined) {
      ctx.addIssue({ code: 'custom', message: 'inside needs b or container', path: ['container'] });
    }
  });

const a11yCheckSchema = z.object({
  ...checkBase,
  kind: z.literal('a11y'),
  rules: z.array(z.string().max(100)).max(100).optional(),
  /** Fail on violations at or above this impact. */
  impact: z.enum(A11Y_IMPACTS).default('serious'),
});

const htmlValidCheckSchema = z.object({
  ...checkBase,
  kind: z.literal('html-valid'),
  rules: z.array(z.string().max(100)).min(1).max(50),
});

const staticCheckSchema = z.object({
  ...checkBase,
  kind: z.literal('static'),
  rule: z.enum(['forbid-identifier', 'require-call', 'forbid-call', 'require-syntax', 'max-loops']),
  value: z.string().max(200).optional(),
  message: z.string().max(500).optional(),
});

export const checkSchema = z.discriminatedUnion('kind', [
  callCheckSchema,
  consoleCheckSchema,
  programCheckSchema,
  domCheckSchema,
  eventCheckSchema,
  cssCheckSchema,
  layoutCheckSchema,
  a11yCheckSchema,
  htmlValidCheckSchema,
  staticCheckSchema,
]);
export type Check = z.infer<typeof checkSchema>;
export type CheckKind = Check['kind'];
export type CheckOf<K extends CheckKind> = Extract<Check, { kind: K }>;

/** Kinds evaluated in the sandbox (the rest are computed by the server: `serverFindings`). */
export const SANDBOX_CHECK_KINDS: ReadonlySet<CheckKind> = new Set([
  'call',
  'console',
  'program',
  'dom',
  'event',
  'css',
  'layout',
  'a11y',
]);
/** Kinds that need a DOM (`dom` run mode). */
export const DOM_CHECK_KINDS: ReadonlySet<CheckKind> = new Set([
  'dom',
  'event',
  'css',
  'layout',
  'a11y',
]);

/** Check list with unique IDs. */
export const checkListSchema = z
  .array(checkSchema)
  .min(1)
  .max(50)
  .superRefine((checks, ctx) => {
    uniqueIds(
      checks.map((c) => c.id),
      ctx,
      [],
      'check',
    );
  });

export function isVisible(check: Check): boolean {
  return check.visible ?? (check.kind === 'call' || check.kind === 'console');
}

export function isRequired(check: Check): boolean {
  return check.required ?? check.kind !== 'static';
}

/** Public form of a check: visible checks keep their inputs and expectations, hidden ones only metadata. */
export type PublicCheck = Record<string, unknown> & {
  id: string;
  kind: CheckKind;
  visible: boolean;
  required: boolean;
  weight: number;
};

export function redactCheck(check: Check): PublicCheck {
  const visible = isVisible(check);
  const required = isRequired(check);
  if (visible) {
    const { misconceptionIfFail: _omit, ...rest } = check;
    return { ...rest, visible, required };
  }
  const out: PublicCheck = {
    id: check.id,
    kind: check.kind,
    visible,
    required,
    weight: check.weight,
  };
  if (check.description !== undefined) out['description'] = check.description;
  if (check.requirement !== undefined) out['requirement'] = check.requirement;
  return out;
}

export const publicCheckSchema = z.looseObject({
  id: localIdSchema,
  kind: z.enum([
    'call',
    'console',
    'program',
    'dom',
    'event',
    'css',
    'layout',
    'a11y',
    'html-valid',
    'static',
  ]),
  visible: z.boolean(),
  required: z.boolean(),
  weight: z.number(),
  description: z.string().optional(),
  requirement: z.string().optional(),
});
