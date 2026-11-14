import type { CheckBundle, DomRead, ObservationStep } from '@proginone/shared';

import { fromJson } from '../common/values.ts';
import { isVisible, type Check, type CheckOf, type DomExpect, type EventStep } from './schema.ts';

/**
 * Compiles authored checks into sandbox observation steps
 * (docs/design/content-and-exercises.md#체크-종류와-관측-단계의-대응).
 * Steps carry inputs and procedures only — never expected values.
 *
 * Step order (one document, one run):
 * 1. `settle` (wait for async completion)
 * 2. read-only program state: `console`, `program`
 * 3. read-only DOM state: `dom`, `css`, `layout`, `a11y`, grouped by viewport (default first)
 * 4. `call` checks (may mutate globals)
 * 5. `event` checks in authored order (mutate the DOM; later event checks see earlier effects)
 *
 * Step IDs are `<checkId>#<suffix>`; graders find observations by these IDs.
 */

export interface CompileOptions {
  /** Function name `call` checks invoke. */
  entry?: string;
  /** Viewport width used when a check does not set one. */
  defaultViewport?: number;
  /** Viewport height for `setViewport` steps. */
  viewportHeight?: number;
  timers: 'real' | 'virtual';
  /** `interactive` keeps visible checks only. */
  purpose: 'interactive' | 'grading' | 'verification';
}

export interface CompiledChecks {
  bundle: CheckBundle;
  stdin?: string[];
  /** Checks that were compiled (after the interactive filter). */
  checks: Check[];
}

export const SETTLE_STEP_ID = 'settle';
const SETTLE_MS = 3_000;
const DEFAULT_HEIGHT = 800;

export function stepId(checkId: string, suffix: string | number): string {
  return `${checkId}#${suffix}`;
}

export function compileChecks(
  allChecks: readonly Check[],
  options: CompileOptions,
): CompiledChecks {
  const checks = allChecks.filter((c) => options.purpose !== 'interactive' || isVisible(c));
  const steps: ObservationStep[] = [{ op: 'waitSettled', id: SETTLE_STEP_ID, maxMs: SETTLE_MS }];
  const expose = new Set<string>();
  let stdin: string[] | undefined;

  // 2. Program state.
  for (const check of checks) {
    if (check.kind === 'console') {
      steps.push({ op: 'consoleOutput', id: stepId(check.id, 0) });
      stdin ??= check.promptInputs;
    } else if (check.kind === 'program') {
      for (const [index, name] of globalNames(check).entries()) {
        steps.push({ op: 'readGlobal', id: stepId(check.id, index), name });
        expose.add(name);
      }
    }
  }

  // 3. DOM state, grouped by viewport.
  const domChecks = checks.filter(
    (c) => c.kind === 'dom' || c.kind === 'css' || c.kind === 'layout' || c.kind === 'a11y',
  );
  const height = options.viewportHeight ?? DEFAULT_HEIGHT;
  const defaultWidth = options.defaultViewport;
  // Default viewport first (no resize), then the others in order of first appearance.
  const widths = [...new Set([defaultWidth, ...domChecks.map((c) => c.viewport ?? defaultWidth)])];
  let current = defaultWidth;
  for (const width of widths) {
    if (width !== undefined && width !== current) {
      steps.push({ op: 'setViewport', id: `viewport#${width}`, width, height });
      current = width;
    }
    for (const check of domChecks.filter((c) => (c.viewport ?? defaultWidth) === width)) {
      steps.push(...compileDomStateCheck(check));
    }
  }
  if (defaultWidth !== undefined && current !== defaultWidth) {
    steps.push({ op: 'setViewport', id: `viewport#${defaultWidth}`, width: defaultWidth, height });
  }

  // 4. Function calls.
  for (const check of checks) {
    if (check.kind !== 'call') continue;
    if (options.entry === undefined)
      throw new Error(`call check ${check.id} needs an entry function`);
    expose.add(options.entry);
    const step: ObservationStep = {
      op: 'callFunction',
      id: stepId(check.id, 0),
      name: options.entry,
      args: check.args.map(fromJson),
    };
    if (check.argsExpr !== undefined) step.argsExpr = check.argsExpr;
    if ('argsUnchanged' in check.expect || 'returnsNewReference' in check.expect)
      step.observeArgsAfter = true;
    steps.push(step);
  }

  // 5. Event scenarios.
  for (const check of checks) {
    if (check.kind === 'event') steps.push(...compileEventCheck(check, options.timers));
  }

  const compiled: CompiledChecks = { bundle: { v: 1, expose: [...expose], steps }, checks };
  if (stdin !== undefined) compiled.stdin = stdin;
  return compiled;
}

export function globalNames(check: CheckOf<'program'>): string[] {
  return Object.keys(check.expect.globals ?? {}).sort();
}

function compileDomStateCheck(check: Check): ObservationStep[] {
  switch (check.kind) {
    case 'dom':
      return compileDomExpect(stepId(check.id, 'q'), check.selector, check.expect);
    case 'css':
      return [
        {
          op: 'computedStyle',
          id: stepId(check.id, 0),
          selector: check.selector,
          properties: Object.keys(check.expect.computed),
          ...(check.pseudo === undefined ? {} : { pseudo: check.pseudo }),
        },
      ];
    case 'layout':
      return [
        {
          op: 'boxRect',
          id: stepId(check.id, 0),
          selectors: [
            check.a,
            ...(check.b === undefined ? [] : [check.b]),
            ...(check.container === undefined ? [] : [check.container]),
          ],
        },
      ];
    case 'a11y':
      return [
        {
          op: 'a11y',
          id: stepId(check.id, 0),
          ...(check.rules === undefined ? {} : { rules: check.rules }),
        },
      ];
    default:
      return [];
  }
}

/**
 * One DOM expectation → `domQuery` steps:
 * `<prefix>` (main query), `<prefix>.parent` (parentSelector), `<prefix>.order` (child order).
 */
export function compileDomExpect(
  prefix: string,
  selector: string,
  expect: DomExpect,
): ObservationStep[] {
  const read = new Set<DomRead>(['count']);
  if (expect.text) read.add('text');
  if (expect.attr) read.add(`attr:${expect.attr.name}`);
  if (expect.tag !== undefined) read.add('tagName');
  if (expect.value !== undefined) read.add('value');
  if (expect.checked !== undefined) read.add('checked');
  const steps: ObservationStep[] = [{ op: 'domQuery', id: prefix, selector, read: [...read] }];
  if (expect.parentSelector !== undefined) {
    steps.push({
      op: 'domQuery',
      id: `${prefix}.parent`,
      selector: `:is(${expect.parentSelector}) > :is(${selector})`,
      read: ['count'],
    });
  }
  if (expect.order !== undefined) {
    steps.push({
      op: 'domQuery',
      id: `${prefix}.order`,
      selector: `:is(${selector}) > *`,
      read: ['tagName'],
    });
  }
  return steps;
}

function compileEventCheck(check: CheckOf<'event'>, timers: 'real' | 'virtual'): ObservationStep[] {
  const steps: ObservationStep[] = [];
  check.steps.forEach((step, index) => {
    steps.push(...compileEventStep(step, stepId(check.id, `s${index}`), timers));
  });
  steps.push({ op: 'waitSettled', id: stepId(check.id, 'settle'), maxMs: SETTLE_MS });
  check.expect.forEach((expect, index) => {
    steps.push(...compileDomExpect(stepId(check.id, `e${index}`), expect.selector, expect));
  });
  return steps;
}

function compileEventStep(
  step: EventStep,
  id: string,
  timers: 'real' | 'virtual',
): ObservationStep[] {
  switch (step.action) {
    case 'wait':
      return timers === 'virtual'
        ? [
            { op: 'advance', id, ms: step.ms },
            { op: 'waitSettled', id: `${id}.settle`, maxMs: SETTLE_MS },
          ]
        : [{ op: 'waitSettled', id, maxMs: Math.min(SETTLE_MS, step.ms + 100) }];
    case 'type':
      return [{ op: 'dispatch', id, selector: step.selector, event: 'input', value: step.value }];
    case 'change':
      return [
        {
          op: 'dispatch',
          id,
          selector: step.selector,
          event: 'change',
          ...(step.value === undefined ? {} : { value: step.value }),
        },
      ];
    case 'keydown':
      return [{ op: 'dispatch', id, selector: step.selector, event: 'keydown', key: step.key }];
    default:
      return [{ op: 'dispatch', id, selector: step.selector, event: step.action }];
  }
}
