import { z } from 'zod';

/**
 * Wire contract between the server-side grader (`@proginone/exercise-kit`) and the browser
 * sandbox (`@proginone/runner`). Shapes follow docs/design/code-execution-sandbox.md
 * (#메시지-프로토콜, #직렬화-형식-serializedvalue, #관측-모델).
 *
 * It lives in its own package, which both depend on: it is this repository's JavaScript runner
 * contract, so it stays out of the language-neutral `@proginone/shared` (D-090,
 * docs/design/system-architecture.md#의존-방향-규칙). The runner adds the transport-only
 * pieces (`RunRequest`, `Limits`, `PreparedCode`, `RunEvent`) on top of these.
 *
 * Everything here is produced by untrusted code (the learner's program runs in the harness), so
 * the server must parse it with {@link parseRunResult} before grading.
 */

/** Hard ceiling for nesting in any value received from the sandbox (harness default is 6). */
export const MAX_WIRE_DEPTH = 64;

// ── SerializedValue ──────────────────────────────────────────────────────────

export const sourcePositionSchema = z.object({
  file: z.string().max(256),
  line: z.int().min(0),
  column: z.int().min(0).optional(),
});
export type SourcePosition = z.infer<typeof sourcePositionSchema>;

export const FUNCTION_KINDS = [
  'function',
  'arrow',
  'class',
  'async',
  'generator',
  'native',
] as const;
export type FunctionKind = (typeof FUNCTION_KINDS)[number];

/** Number payload. Values JSON cannot carry are kept as string tags. */
export type SerializedNumber = number | 'NaN' | 'Infinity' | '-Infinity' | '-0';

/**
 * Tagged, JSON-safe representation of any JavaScript value observed in the sandbox.
 * Optional members are typed `| undefined` to match zod's output under
 * `exactOptionalPropertyTypes`.
 */
export type SerializedValue =
  | { t: 'undefined' }
  | { t: 'null' }
  | { t: 'boolean'; v: boolean }
  | { t: 'number'; v: SerializedNumber }
  | { t: 'bigint'; v: string }
  | { t: 'string'; v: string; truncated?: boolean | undefined }
  | { t: 'symbol'; description?: string | undefined }
  | {
      t: 'function';
      name: string;
      kind: FunctionKind;
      preview?: string | undefined;
    }
  | {
      t: 'array';
      items: SerializedValue[];
      length: number;
      holes?: number | undefined;
      truncated?: boolean | undefined;
      refId?: number | undefined;
    }
  | {
      t: 'object';
      className: string | null;
      entries: [string, SerializedValue][];
      truncated?: boolean | undefined;
      collapsed?: boolean | undefined;
      refId?: number | undefined;
    }
  | {
      t: 'map';
      entries: [SerializedValue, SerializedValue][];
      size?: number | undefined;
      truncated?: boolean | undefined;
      refId?: number | undefined;
    }
  | {
      t: 'set';
      items: SerializedValue[];
      size?: number | undefined;
      truncated?: boolean | undefined;
      refId?: number | undefined;
    }
  | { t: 'date'; iso: string }
  | { t: 'regexp'; source: string; flags: string }
  | { t: 'error'; name: string; message: string; position?: SourcePosition | undefined }
  | { t: 'promise' }
  | { t: 'getter' }
  | {
      t: 'dom';
      nodeName: string;
      id?: string | undefined;
      classes?: string[] | undefined;
      preview: string;
    }
  | { t: 'circular'; refId: number }
  | { t: 'unserializable'; reason: string };

const str = (max: number) => z.string().max(max);
const COLLECTION_MAX = 10_000;
const STRING_MAX = 100_000;

export const serializedValueSchema: z.ZodType<SerializedValue> = z.lazy(() =>
  z.discriminatedUnion('t', [
    z.object({ t: z.literal('undefined') }),
    z.object({ t: z.literal('null') }),
    z.object({ t: z.literal('boolean'), v: z.boolean() }),
    z.object({
      t: z.literal('number'),
      v: z.union([z.number(), z.enum(['NaN', 'Infinity', '-Infinity', '-0'])]),
    }),
    z.object({ t: z.literal('bigint'), v: z.string().regex(/^-?\d{1,4096}$/) }),
    z.object({ t: z.literal('string'), v: str(STRING_MAX), truncated: z.boolean().optional() }),
    z.object({ t: z.literal('symbol'), description: str(1_000).optional() }),
    z.object({
      t: z.literal('function'),
      name: str(1_000),
      kind: z.enum(FUNCTION_KINDS),
      preview: str(1_000).optional(),
    }),
    z.object({
      t: z.literal('array'),
      items: z.array(serializedValueSchema).max(COLLECTION_MAX),
      length: z.int().min(0),
      holes: z.int().min(0).optional(),
      truncated: z.boolean().optional(),
      refId: z.int().min(0).optional(),
    }),
    z.object({
      t: z.literal('object'),
      className: str(1_000).nullable(),
      entries: z.array(z.tuple([str(10_000), serializedValueSchema])).max(COLLECTION_MAX),
      truncated: z.boolean().optional(),
      collapsed: z.boolean().optional(),
      refId: z.int().min(0).optional(),
    }),
    z.object({
      t: z.literal('map'),
      entries: z.array(z.tuple([serializedValueSchema, serializedValueSchema])).max(COLLECTION_MAX),
      size: z.int().min(0).optional(),
      truncated: z.boolean().optional(),
      refId: z.int().min(0).optional(),
    }),
    z.object({
      t: z.literal('set'),
      items: z.array(serializedValueSchema).max(COLLECTION_MAX),
      size: z.int().min(0).optional(),
      truncated: z.boolean().optional(),
      refId: z.int().min(0).optional(),
    }),
    z.object({ t: z.literal('date'), iso: str(100) }),
    z.object({ t: z.literal('regexp'), source: str(10_000), flags: str(20) }),
    z.object({
      t: z.literal('error'),
      name: str(1_000),
      message: str(10_000),
      position: sourcePositionSchema.optional(),
    }),
    z.object({ t: z.literal('promise') }),
    z.object({ t: z.literal('getter') }),
    z.object({
      t: z.literal('dom'),
      nodeName: str(200),
      id: str(1_000).optional(),
      classes: z.array(str(1_000)).max(200).optional(),
      preview: str(1_000),
    }),
    z.object({ t: z.literal('circular'), refId: z.int().min(0) }),
    z.object({ t: z.literal('unserializable'), reason: str(1_000) }),
  ]),
);

// ── Run result ───────────────────────────────────────────────────────────────

export const CONSOLE_LEVELS = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'table',
  'dir',
  'alert',
  'confirm',
  'prompt',
] as const;
export type ConsoleLevel = (typeof CONSOLE_LEVELS)[number];

export const consoleEntrySchema = z.object({
  seq: z.int().min(0),
  level: z.enum(CONSOLE_LEVELS),
  args: z.array(serializedValueSchema).max(1_000),
  at: z.number(),
  source: sourcePositionSchema.optional(),
});
export type ConsoleEntry = z.infer<typeof consoleEntrySchema>;

export const RUN_ERROR_PHASES = [
  'syntax',
  'runtime',
  'unhandled_rejection',
  'loop_limit',
  'harness',
] as const;

export const runErrorSchema = z.object({
  phase: z.enum(RUN_ERROR_PHASES),
  name: str(1_000),
  message: str(10_000),
  position: sourcePositionSchema.optional(),
  stack: z.array(sourcePositionSchema).max(100).optional(),
});
export type RunError = z.infer<typeof runErrorSchema>;

export const RUN_STATUSES = [
  'completed',
  'error',
  'timeout',
  'loop_limit',
  'crashed',
  'aborted',
] as const;
export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof runStatusSchema>;

// ── Observation steps (CheckBundle) ──────────────────────────────────────────

/** Step IDs are `<checkId>#<n>` or a reserved name such as `settle`. */
export const stepIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._:#-]{0,159}$/i);

const selector = str(500).min(1);
const identifier = z.string().regex(/^[A-Za-z_$][\w$]{0,99}$/);

/**
 * What a `domQuery` step reads from each matched element.
 * `attr:<name>` reads one attribute (null when absent).
 */
export const domReadSchema = z.union([
  z.enum(['count', 'exists', 'text', 'value', 'checked', 'tagName', 'outerHTMLShape']),
  z.string().regex(/^attr:[a-z][a-z0-9_:.-]{0,99}$/i),
]);
export type DomRead = z.infer<typeof domReadSchema>;

export const DISPATCH_EVENTS = [
  'click',
  'dblclick',
  'input',
  'change',
  'submit',
  'keydown',
  'focus',
  'blur',
] as const;

export const observationStepSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('callFunction'),
    id: stepIdSchema,
    name: identifier,
    args: z.array(serializedValueSchema).max(20),
    /** Classic-script source producing the argument array (Prepare Worker builds it, no eval). */
    argsExpr: str(2_000).optional(),
    observeArgsAfter: z.boolean().optional(),
    timeoutMs: z.int().min(1).max(10_000).optional(),
  }),
  z.object({ op: z.literal('readGlobal'), id: stepIdSchema, name: identifier }),
  z.object({ op: z.literal('consoleOutput'), id: stepIdSchema }),
  z.object({
    op: z.literal('domQuery'),
    id: stepIdSchema,
    selector,
    read: z.array(domReadSchema).min(1).max(20),
  }),
  z.object({
    op: z.literal('computedStyle'),
    id: stepIdSchema,
    selector,
    properties: z.array(str(100).min(1)).min(1).max(50),
    pseudo: z.enum(['::before', '::after', '::marker', '::placeholder']).optional(),
  }),
  z.object({
    op: z.literal('boxRect'),
    id: stepIdSchema,
    selectors: z.array(selector).min(1).max(10),
  }),
  z.object({
    op: z.literal('dispatch'),
    id: stepIdSchema,
    selector,
    event: z.enum(DISPATCH_EVENTS),
    value: str(10_000).optional(),
    key: str(50).optional(),
  }),
  z.object({
    op: z.literal('setViewport'),
    id: stepIdSchema,
    width: z.int().min(200).max(3_840),
    height: z.int().min(200).max(3_840),
  }),
  z.object({ op: z.literal('advance'), id: stepIdSchema, ms: z.int().min(0).max(600_000) }),
  z.object({ op: z.literal('waitSettled'), id: stepIdSchema, maxMs: z.int().min(0).max(10_000) }),
  z.object({
    op: z.literal('a11y'),
    id: stepIdSchema,
    rules: z.array(str(100)).max(100).optional(),
  }),
]);
export type ObservationStep = z.infer<typeof observationStepSchema>;
export type ObservationOp = ObservationStep['op'];

/** Observation steps sent to the sandbox. Contains inputs and procedures only, never expectations. */
export const checkBundleSchema = z.object({
  v: z.literal(1),
  /** Learner identifiers the exposure script must hand to the harness. */
  expose: z.array(identifier).max(50),
  steps: z.array(observationStepSchema).max(500),
});
export type CheckBundle = z.infer<typeof checkBundleSchema>;

// ── Observations ─────────────────────────────────────────────────────────────

/** Common envelope. `status` other than `ok` means the step itself did not complete. */
const obsBase = {
  id: stepIdSchema,
  status: z.enum(['ok', 'timeout', 'error', 'skipped']).default('ok'),
  error: z.object({ name: str(1_000), message: str(10_000) }).optional(),
};

const domItemSchema = z.object({
  tagName: str(100).optional(),
  text: str(STRING_MAX).optional(),
  value: str(STRING_MAX).optional(),
  checked: z.boolean().optional(),
  outerHTMLShape: str(STRING_MAX).optional(),
  attrs: z.record(str(100), str(STRING_MAX).nullable()).optional(),
});
export type DomItem = z.infer<typeof domItemSchema>;

export const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type Rect = z.infer<typeof rectSchema>;

export const A11Y_IMPACTS = ['minor', 'moderate', 'serious', 'critical'] as const;
export type A11yImpact = (typeof A11Y_IMPACTS)[number];

export const observationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('callFunction'),
    ...obsBase,
    /** `missing`: identifier not defined; `not_callable`: defined but not a function. */
    outcome: z.enum(['returned', 'threw', 'missing', 'not_callable']),
    value: serializedValueSchema.optional(),
    thrown: serializedValueSchema.optional(),
    /** Arguments re-serialized after the call (when `observeArgsAfter`). */
    argsAfter: z.array(serializedValueSchema).max(20).optional(),
    /** Indices of arguments that are the very same reference as the return value. */
    returnIsArg: z.array(z.int().min(0)).max(20).optional(),
    console: z.array(consoleEntrySchema).max(5_000).optional(),
  }),
  z.object({
    op: z.literal('readGlobal'),
    ...obsBase,
    outcome: z.enum(['ok', 'missing']),
    value: serializedValueSchema.optional(),
  }),
  z.object({
    op: z.literal('consoleOutput'),
    ...obsBase,
    entries: z.array(consoleEntrySchema).max(5_000),
    truncated: z.boolean().default(false),
  }),
  z.object({
    op: z.literal('domQuery'),
    ...obsBase,
    count: z.int().min(0),
    items: z.array(domItemSchema).max(1_000),
  }),
  z.object({
    op: z.literal('computedStyle'),
    ...obsBase,
    count: z.int().min(0),
    elements: z.array(z.record(str(100), str(10_000))).max(1_000),
  }),
  z.object({
    op: z.literal('boxRect'),
    ...obsBase,
    rects: z
      .array(z.object({ selector, count: z.int().min(0), rect: rectSchema.optional() }))
      .max(10),
    viewport: z.object({ width: z.number(), height: z.number() }).optional(),
  }),
  z.object({
    op: z.literal('dispatch'),
    ...obsBase,
    ok: z.boolean(),
    reason: z.enum(['TARGET_NOT_FOUND', 'HANDLER_ERROR']).optional(),
  }),
  z.object({
    op: z.literal('setViewport'),
    ...obsBase,
    width: z.number(),
    height: z.number(),
  }),
  z.object({ op: z.literal('advance'), ...obsBase }),
  z.object({ op: z.literal('waitSettled'), ...obsBase, settled: z.boolean() }),
  z.object({
    op: z.literal('a11y'),
    ...obsBase,
    violations: z
      .array(
        z.object({
          ruleId: str(200),
          impact: z.enum(A11Y_IMPACTS).nullable(),
          targets: z.array(str(1_000)).max(100),
        }),
      )
      .max(500),
  }),
]);
export type Observation = z.infer<typeof observationSchema>;
export type ObservationOf<Op extends ObservationOp> = Extract<Observation, { op: Op }>;

export const runResultSchema = z.object({
  v: z.literal(1),
  type: z.literal('result'),
  runId: z.string().max(100),
  status: runStatusSchema,
  durationMs: z.number().min(0),
  console: z.array(consoleEntrySchema).max(5_000),
  consoleTruncated: z.boolean(),
  droppedConsoleEntries: z.int().min(0),
  errors: z.array(runErrorSchema).max(100),
  observations: z.array(observationSchema).max(2_000),
  pendingAtEnd: z.object({ timers: z.int().min(0), intervals: z.int().min(0) }),
});
export type RunResult = z.infer<typeof runResultSchema>;

// ── Run plan (server → web app → runner) ─────────────────────────────────────

export const RUN_MODES = ['js-console', 'dom', 'preview'] as const;
export const RUN_PURPOSES = ['interactive', 'grading', 'verification'] as const;

export const runFileSchema = z.object({
  path: z.string().regex(/^[a-z0-9][a-z0-9._/-]{0,63}$/i),
  language: z.enum(['html', 'css', 'js']),
  content: z.string().max(200_000),
});
export type RunFile = z.infer<typeof runFileSchema>;

/**
 * What the server's `buildRunPlan` returns. The web app turns it into a runner `RunRequest`
 * by adding `runId`, full `limits` and the Prepare Worker output.
 */
export const runPlanSchema = z.object({
  v: z.literal(1),
  mode: z.enum(RUN_MODES),
  purpose: z.enum(RUN_PURPOSES),
  files: z.array(runFileSchema).min(1).max(20),
  entry: z.string().max(64),
  timers: z.enum(['real', 'virtual']),
  viewport: z.object({ width: z.int(), height: z.int() }).optional(),
  stdin: z.array(z.string().max(10_000)).max(100).optional(),
  limits: z
    .object({
      maxDurationMs: z.int().min(100).max(10_000).optional(),
      checkTimeoutMs: z.int().min(100).max(10_000).optional(),
    })
    .optional(),
  checks: checkBundleSchema,
});
export type RunPlan = z.infer<typeof runPlanSchema>;

// ── Boundary helpers ─────────────────────────────────────────────────────────

/**
 * Returns false when `value` nests deeper than `maxDepth`. Iterative, so hostile input cannot
 * overflow the stack before zod (which recurses) sees it.
 */
export function withinDepth(value: unknown, maxDepth = MAX_WIRE_DEPTH): boolean {
  const stack: [unknown, number][] = [[value, 0]];
  let visited = 0;
  while (stack.length > 0) {
    const top = stack.pop();
    if (top === undefined) break;
    const [current, depth] = top;
    if (depth > maxDepth) return false;
    if (++visited > 2_000_000) return false;
    if (current !== null && typeof current === 'object') {
      for (const child of Object.values(current)) stack.push([child, depth + 1]);
    }
  }
  return true;
}

/**
 * True when any object in `value` has an own `__proto__` key. `JSON.parse` creates such keys and
 * zod's record parser would turn them into a prototype assignment, so boundaries reject them.
 */
export function hasProtoKey(value: unknown): boolean {
  const stack: unknown[] = [value];
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (++visited > 2_000_000) return true;
    if (current !== null && typeof current === 'object') {
      if (Object.hasOwn(current, '__proto__')) return true;
      for (const child of Object.values(current)) stack.push(child);
    }
  }
  return false;
}

/** Parses an untrusted `RunResult` (depth and `__proto__` guards first, then the zod schema). */
export function parseRunResult(
  input: unknown,
): { success: true; data: RunResult } | { success: false; error: string } {
  if (!withinDepth(input)) return { success: false, error: 'RunResult nests too deeply' };
  if (hasProtoKey(input)) return { success: false, error: 'RunResult contains a __proto__ key' };
  const parsed = runResultSchema.safeParse(input);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, error: parsed.error.message };
}
