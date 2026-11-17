import {
  consoleEntrySchema,
  observationSchema,
  type ObservationOp,
  observationStepSchema,
  type ObservationStep,
  RUN_MODES,
  RUN_PURPOSES,
  runErrorSchema,
  runPlanSchema,
  type RunPlan,
} from '@proginone/shared';
import { z } from 'zod';
import { PREVIEW_TITLE_MAX_LENGTH, PROTOCOL_VERSION } from './constants.ts';
import { type Limits, limitsSchema } from './limits.ts';

/**
 * Runner transport messages. The sandbox contract itself (`RunPlan`, `CheckBundle`,
 * `ObservationStep`, `Observation`, `RunResult`, `SerializedValue`) lives in `@proginone/shared`
 * so the grader (`exercise-kit`) and the runner share one definition. This module adds only what
 * travels between host, shell and harness.
 */

export {
  HARNESS_CONFIG_GLOBAL,
  normalizePreviewTitle,
  PREVIEW_TITLE_MAX_LENGTH,
  PROTOCOL_VERSION,
} from './constants.ts';
const v = z.literal(PROTOCOL_VERSION);

export type RunMode = (typeof RUN_MODES)[number];
export type RunPurpose = (typeof RUN_PURPOSES)[number];

/** Steps that only make sense with a document. */
export const DOM_ONLY_OPS: ReadonlySet<ObservationOp> = new Set([
  'domQuery',
  'computedStyle',
  'boxRect',
  'dispatch',
  'setViewport',
  'a11y',
]);

/**
 * The shared `RunPlan` plus checks the runner needs before it can run anything safely:
 * unique paths without `..`, an `entry` that exists and suits the mode, DOM-only steps only in
 * DOM modes.
 */
export const runnablePlanSchema = runPlanSchema.superRefine((plan, ctx) => {
  const files = new Map<string, string>();
  for (const f of plan.files) {
    if (files.has(f.path)) ctx.addIssue({ code: 'custom', message: `중복된 파일: ${f.path}` });
    if (f.path.split('/').includes('..')) {
      ctx.addIssue({ code: 'custom', message: `상위 경로는 쓸 수 없습니다: ${f.path}` });
    }
    files.set(f.path, f.language);
  }
  const entryLanguage = files.get(plan.entry);
  if (entryLanguage === undefined) {
    ctx.addIssue({ code: 'custom', message: `entry 파일이 없습니다: ${plan.entry}` });
  } else if (plan.mode === 'js-console' ? entryLanguage !== 'js' : entryLanguage !== 'html') {
    ctx.addIssue({ code: 'custom', message: `${plan.mode} 모드에 맞지 않는 entry: ${plan.entry}` });
  }
  if (plan.mode === 'js-console') {
    for (const s of plan.checks.steps) {
      if (DOM_ONLY_OPS.has(s.op)) {
        ctx.addIssue({ code: 'custom', message: `${s.op} 단계는 DOM 모드에서만 씁니다.` });
      }
    }
  }
});

export type { RunPlan };
export type RunPlanInput = z.input<typeof runPlanSchema>;

export const preparedScriptSchema = z.object({
  id: z.number().int().nonnegative(),
  code: z.string().max(1_000_000),
});
export type PreparedScript = z.infer<typeof preparedScriptSchema>;

const viewportSchema = z.object({
  width: z.number().int().min(200).max(3_840),
  height: z.number().int().min(200).max(3_840),
});

/**
 * Host → shell. Carries prepared (instrumented) code only; original files and the position map
 * stay in the host, which maps error positions back after the run.
 *
 * - `js-console`: `scripts` are the learner JS files in run order (entry first).
 * - `dom`/`preview`: `document` is the rewritten HTML; `scripts[i]` is the body of its i-th inline
 *   script, written back by the harness as a `blob:` script (blob delivery). The shell inserts the
 *   harness at `harnessAt`.
 * - `expose`: the classic script that hands learner bindings (and `argsExpr` arguments) to the
 *   harness after the learner's scripts.
 *
 * - `syntaxOnly`: an engine syntax check (D-030) in `dom` mode. The shell runs it in a hidden
 *   frame and keeps a finished preview on screen.
 *
 * Positions the harness reports use `src:<id>` (instrumented coordinates) or `orig:<id>`
 * (original coordinates, from loop guards) as the file name; the host maps both back.
 */
export const runRequestSchema = z.object({
  v,
  type: z.literal('run'),
  runId: z.uuid(),
  mode: z.enum(RUN_MODES),
  purpose: z.enum(RUN_PURPOSES),
  limits: limitsSchema,
  viewport: viewportSchema.optional(),
  stdin: z.array(z.string().max(10_000)).max(100),
  steps: z.array(observationStepSchema).max(500),
  scripts: z.array(preparedScriptSchema).max(64),
  expose: z.string().max(200_000).nullable(),
  document: z.string().max(2_000_000).optional(),
  harnessAt: z.number().int().nonnegative().optional(),
  syntaxOnly: z.literal(true).optional(),
});
export type RunRequest = z.infer<typeof runRequestSchema>;

/** A request the shell CSP blocked. Lets the UI explain "네트워크 요청은 차단됩니다". */
export const blockedRequestSchema = z.object({
  directive: z.string().max(100),
  uri: z.string().max(500),
});
export type BlockedRequest = z.infer<typeof blockedRequestSchema>;

/** Live events for the console panel. Grading uses only the final `RunResult`. */
export const runEventSchema = z.discriminatedUnion('kind', [
  z.object({ v, type: z.literal('event'), runId: z.uuid(), kind: z.literal('started') }),
  z.object({
    v,
    type: z.literal('event'),
    runId: z.uuid(),
    kind: z.literal('console'),
    entries: z.array(consoleEntrySchema).max(5_000),
  }),
  z.object({ v, type: z.literal('event'), runId: z.uuid(), kind: z.literal('settled') }),
  z.object({
    v,
    type: z.literal('event'),
    runId: z.uuid(),
    kind: z.literal('blocked'),
    requests: z.array(blockedRequestSchema).max(50),
  }),
]);
export type RunEvent = z.infer<typeof runEventSchema>;

// ---------------------------------------------------------------------------------------------
// Channel messages

/** Shell → host over `window.postMessage` (the only window message the host accepts). */
export const shellHelloSchema = z.object({ v, type: z.literal('shell-hello') });
/** Host → shell over `window.postMessage`, transferring the host port. */
export const connectSchema = z.object({ v, type: z.literal('connect') });

export const abortRequestSchema = z.object({ v, type: z.literal('abort'), runId: z.uuid() });

export const hostToShellSchema = z.discriminatedUnion('type', [
  runRequestSchema,
  abortRequestSchema,
]);
export type HostToShell = z.infer<typeof hostToShellSchema>;

/**
 * Something the preview UI should tell the learner, independent of any run (the preview document
 * stays interactive after its run has finished).
 *
 * - `navigation-blocked`: the learner followed a link or submitted a form in the preview. The
 *   harness cancelled it, because the sandbox would only show the browser's error page.
 *
 * Learner code can make the shell send this too; it only ever shows a notice.
 */
export const RUNNER_NOTICES = ['navigation-blocked'] as const;
export type RunnerNotice = (typeof RUNNER_NOTICES)[number];

/**
 * Shell → host over the port, except results: those are checked with the shared
 * `parseRunResult` (depth and `__proto__` guards first).
 */
export const shellControlSchema = z.union([
  z.object({ v, type: z.literal('ready') }),
  z.object({ v, type: z.literal('heartbeat'), runId: z.uuid(), at: z.number().nonnegative() }),
  runEventSchema,
  z.object({ v, type: z.literal('notice'), notice: z.enum(RUNNER_NOTICES) }),
  /**
   * The title of the preview document on screen (D-082), for the tab bar above the preview. Sent
   * when the document has parsed, has loaded and whenever its title changes, also after its run
   * has finished. Learner code can make the shell send any string here; show it as text only.
   */
  z.object({ v, type: z.literal('title'), title: z.string().max(PREVIEW_TITLE_MAX_LENGTH) }),
]);
export type ShellControl = z.infer<typeof shellControlSchema>;

/** Harness → shell over the harness port. */
export const harnessToShellSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('console'), entries: z.array(consoleEntrySchema).max(5_000) }),
  z.object({ type: z.literal('settled') }),
  z.object({
    type: z.literal('viewport'),
    reqId: z.number().int().positive(),
    width: z.number().int().min(200).max(3_840),
    height: z.number().int().min(200).max(3_840),
  }),
  z.object({
    type: z.literal('done'),
    status: z.enum(['completed', 'error', 'loop_limit']),
    errors: z.array(runErrorSchema).max(100),
    observations: z.array(observationSchema).max(2_000),
    droppedConsoleEntries: z.number().int().nonnegative(),
    pendingAtEnd: z.object({
      timers: z.number().int().nonnegative(),
      intervals: z.number().int().nonnegative(),
    }),
    blocked: z.array(blockedRequestSchema).max(50),
  }),
]);
export type HarnessToShell = z.infer<typeof harnessToShellSchema>;

/** Shell → harness. */
export type ShellToHarness =
  | { type: 'start'; scripts: string[]; expose: string | null }
  | { type: 'viewport-done'; reqId: number };

/** Configuration the shell hands to the harness. */
export interface HarnessConfig {
  limits: Limits;
  steps: ObservationStep[];
  stdin: string[];
  /** DOM mode: instrumented inline script bodies for `__pg.w(i)`. */
  scripts: PreparedScript[];
  /** Learner-visible file id per blob URL, filled in by whoever creates the blob. */
  sourceIds: Record<string, string>;
  /**
   * `preview` only: cancel link navigation and form submission in the learner document and tell
   * the shell (`pg-notice`), instead of letting the sandbox swap in an error page.
   */
  interceptNavigation?: boolean;
  /** `preview` only: report the document title to the shell (`pg-title`, D-082). */
  reportTitle?: boolean;
}

/** Learner document → shell over `window.postMessage` (see `RunnerNotice`). */
export interface HarnessNoticeMessage {
  type: 'pg-notice';
  notice: RunnerNotice;
}

/**
 * Preview document → shell over `window.postMessage` on `pagehide`: the document is leaving
 * through a navigation the harness cannot cancel (`location` assignment, `form.submit()`,
 * `<meta refresh>`). The shell CSP blocks it and the browser would show its error page, so the
 * shell swaps in a short explanation instead (D-074). Learner code can send this too; it only
 * ever replaces its own preview with that explanation.
 */
export interface HarnessLeftMessage {
  type: 'pg-left';
}

/**
 * Preview document → shell over `window.postMessage`: the document title (`document.title`), at
 * `DOMContentLoaded`, at `load` and after it changes (D-082). Learner code can send this too; the
 * shell accepts it only from the preview document on screen and only as a string, so it only
 * ever changes the title shown above that preview.
 */
export interface HarnessTitleMessage {
  type: 'pg-title';
  title: string;
}
