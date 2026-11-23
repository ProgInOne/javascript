/* eslint-disable @typescript-eslint/prefer-for-of --
   Index loops on purpose: learner code may replace Array iterators
   (docs/design/code-execution-sandbox.md#하네스-무결성). */
import type {
  ConsoleEntry,
  DomItem,
  Observation,
  ObservationOf,
  ObservationOp,
  ObservationStep,
  SerializedValue,
} from '@proginone/run-contract';
import { apply, PromiseCtor, promiseThen, push, strSlice } from './intrinsics.ts';
import { deserialize } from './serialize.ts';

/**
 * Observation steps (docs/design/code-execution-sandbox.md#관측-모델), producing the shared
 * `Observation` shapes from `@proginone/shared`. Each step returns what it saw; none of them
 * knows an expected value.
 */

export type Settled<T> = { timedOut: true } | { value: T } | { rejected: unknown };

export interface Lookup {
  status: 'found' | 'missing' | 'tdz';
  value?: unknown;
}

export interface StepContext {
  serialize: (v: unknown) => SerializedValue;
  lookup: (name: string) => Lookup;
  /** The `argsExpr` reader for a step, from the expose script. */
  argsReader: (stepId: string) => (() => unknown) | undefined;
  /** Console entries recorded so far and whether any were dropped. */
  consoleEntries: () => { entries: ConsoleEntry[]; truncated: boolean };
  consoleSeq: () => number;
  errorCount: () => number;
  /** Name and message of the most recently recorded error. */
  lastError: () => { name: string; message: string } | undefined;
  isLoopLimit: (e: unknown) => boolean;
  settle: (maxMs: number) => Promise<boolean>;
  wait: (ms: number) => Promise<void>;
  withTimeout: <T>(p: Promise<T>, ms: number) => Promise<Settled<T>>;
  resizeViewport: (width: number, height: number) => Promise<void>;
  checkTimeoutMs: number;
  /** DOM mode only. */
  dom: DomApi | null;
}

/** DOM built-ins captured before learner code runs. */
export interface DomApi {
  win: Window;
  doc: Document;
  querySelectorAll: (selector: string) => Element[];
  computedStyle: (el: Element, pseudo: string | null) => CSSStyleDeclaration;
  rect: (el: Element) => DOMRect;
  dispatch: (target: EventTarget, event: Event) => boolean;
}

/** Op-specific part of an observation; the runner adds `op`, `id` and `status`. */
export type Payload<Op extends ObservationOp> = Omit<ObservationOf<Op>, 'op' | 'id' | 'status'>;

type StepOf<Op extends ObservationOp> = Extract<ObservationStep, { op: Op }>;
type StepFn<Op extends ObservationOp> = (
  step: StepOf<Op>,
  ctx: StepContext,
) => Payload<Op> | Promise<Payload<Op>>;

const MAX_ELEMENTS = 200;

/** Schema-valid payloads for observations whose step did not complete. */
export const EMPTY_PAYLOAD: { [Op in ObservationOp]: Payload<Op> } = {
  callFunction: { outcome: 'threw' },
  readGlobal: { outcome: 'missing' },
  consoleOutput: { entries: [], truncated: false },
  domQuery: { count: 0, items: [] },
  computedStyle: { count: 0, elements: [] },
  boxRect: { rects: [] },
  dispatch: { ok: false },
  setViewport: { width: 0, height: 0 },
  advance: {},
  waitSettled: { settled: false },
  a11y: { violations: [] },
};

/** Thrown by steps the v0.1 runner does not implement; reported as `status: 'skipped'`. */
export class UnsupportedStep extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedStep';
  }
}

/** A step that ran out of time on its own (e.g. a promise that never settles). */
export class StepTimeout extends Error {
  constructor() {
    super('step timed out');
    this.name = 'StepTimeout';
  }
}

function requireDom(ctx: StepContext): DomApi {
  if (!ctx.dom) throw new TypeError('이 단계는 DOM 모드에서만 쓸 수 있습니다.');
  return ctx.dom;
}

function shape(el: Element, depth: number): string {
  const tag = el.localName;
  if (depth >= 8 || el.children.length === 0) return tag;
  let joined = '';
  for (let i = 0; i < el.children.length && i < MAX_ELEMENTS; i++) {
    const child = el.children[i];
    if (child) joined += (i ? ',' : '') + shape(child, depth + 1);
  }
  return `${tag}(${joined})`;
}

const callFunction: StepFn<'callFunction'> = async (step, ctx) => {
  const found = ctx.lookup(step.name);
  // A binding in its temporal dead zone cannot be called either; the grader reports it missing.
  if (found.status !== 'found') return { outcome: 'missing' };
  if (typeof found.value !== 'function') return { outcome: 'not_callable' };

  let args: unknown[];
  if (step.argsExpr !== undefined) {
    const reader = ctx.argsReader(step.id);
    if (!reader) throw new Error('argsExpr를 준비하지 못했습니다.');
    const produced = reader();
    if (!Array.isArray(produced)) throw new TypeError('argsExpr는 배열을 만들어야 합니다.');
    args = produced as unknown[];
  } else {
    args = [];
    for (let i = 0; i < step.args.length; i++) {
      const arg = step.args[i];
      if (arg) push(args, deserialize(arg));
    }
  }

  const before = ctx.consoleSeq();
  const during = (): Pick<Payload<'callFunction'>, 'console'> => {
    const out: ConsoleEntry[] = [];
    const { entries } = ctx.consoleEntries();
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e && e.seq > before) push(out, e);
    }
    return out.length > 0 ? { console: out } : {};
  };
  const afterCall = (returned: unknown, hasReturn: boolean) => {
    const out: Pick<Payload<'callFunction'>, 'argsAfter' | 'returnIsArg'> = {};
    if (step.observeArgsAfter) {
      const after: SerializedValue[] = [];
      for (let i = 0; i < args.length; i++) push(after, ctx.serialize(args[i]));
      out.argsAfter = after;
    }
    if (hasReturn) {
      const same: number[] = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a !== null && (typeof a === 'object' || typeof a === 'function') && a === returned) {
          push(same, i);
        }
      }
      out.returnIsArg = same;
    }
    return out;
  };

  let result: unknown;
  try {
    result = apply(found.value as (...a: unknown[]) => unknown, undefined, args);
  } catch (e) {
    return {
      outcome: 'threw',
      thrown: ctx.serialize(e),
      ...afterCall(undefined, false),
      ...during(),
    };
  }
  const thenable =
    result !== null &&
    (typeof result === 'object' || typeof result === 'function') &&
    typeof (result as { then?: unknown }).then === 'function';
  if (!thenable) {
    return {
      outcome: 'returned',
      value: ctx.serialize(result),
      ...afterCall(result, true),
      ...during(),
    };
  }
  // A native promise is awaited through the captured `then`; other thenables are learner code.
  const settled = await ctx.withTimeout(
    result instanceof PromiseCtor
      ? (result as Promise<unknown>)
      : new PromiseCtor<unknown>((resolve) => {
          resolve(result);
        }),
    step.timeoutMs ?? ctx.checkTimeoutMs,
  );
  if ('timedOut' in settled) throw new StepTimeout();
  if ('rejected' in settled) {
    return {
      outcome: 'threw',
      thrown: ctx.serialize(settled.rejected),
      ...afterCall(undefined, false),
      ...during(),
    };
  }
  return {
    outcome: 'returned',
    value: ctx.serialize(settled.value),
    ...afterCall(settled.value, true),
    ...during(),
  };
};

const readGlobal: StepFn<'readGlobal'> = (step, ctx) => {
  const found = ctx.lookup(step.name);
  return found.status === 'found'
    ? { outcome: 'ok', value: ctx.serialize(found.value) }
    : { outcome: 'missing' };
};

const consoleOutput: StepFn<'consoleOutput'> = (_step, ctx) => {
  const { entries, truncated } = ctx.consoleEntries();
  const copy: ConsoleEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e) push(copy, e);
  }
  return { entries: copy, truncated };
};

const domQuery: StepFn<'domQuery'> = (step, ctx) => {
  const dom = requireDom(ctx);
  const list = dom.querySelectorAll(step.selector);
  const reads = step.read.filter((r) => r !== 'count' && r !== 'exists');
  const items: DomItem[] = [];
  if (reads.length > 0) {
    for (let i = 0; i < list.length && i < MAX_ELEMENTS; i++) {
      const el = list[i];
      if (!el) continue;
      const item: DomItem = {};
      for (const read of reads) {
        if (read === 'text') item.text = strSlice(el.textContent, 0, 100_000);
        else if (read === 'tagName') item.tagName = el.localName;
        else if (read === 'value') {
          if ('value' in el) item.value = strSlice(String(el.value), 0, 100_000);
        } else if (read === 'checked') {
          if ('checked' in el) item.checked = Boolean(el.checked);
        } else if (read === 'outerHTMLShape') {
          item.outerHTMLShape = strSlice(shape(el, 0), 0, 2_000);
        } else if (read.startsWith('attr:')) {
          const name = strSlice(read, 5);
          item.attrs ??= {};
          item.attrs[name] = el.getAttribute(name);
        }
      }
      push(items, item);
    }
  }
  return { count: list.length, items };
};

const computedStyle: StepFn<'computedStyle'> = (step, ctx) => {
  const dom = requireDom(ctx);
  const list = dom.querySelectorAll(step.selector);
  const elements: Record<string, string>[] = [];
  for (let i = 0; i < list.length && i < MAX_ELEMENTS; i++) {
    const el = list[i];
    if (!el) continue;
    const cs = dom.computedStyle(el, step.pseudo ?? null);
    const values: Record<string, string> = {};
    for (const prop of step.properties) values[prop] = cs.getPropertyValue(prop);
    push(elements, values);
  }
  return { count: list.length, elements };
};

const boxRect: StepFn<'boxRect'> = (step, ctx) => {
  const dom = requireDom(ctx);
  const rects: Payload<'boxRect'>['rects'] = [];
  for (const selector of step.selectors) {
    const list = dom.querySelectorAll(selector);
    const first = list[0];
    if (first) {
      const r = dom.rect(first);
      push(rects, {
        selector,
        count: list.length,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      });
    } else {
      push(rects, { selector, count: 0 });
    }
  }
  return { rects, viewport: { width: dom.win.innerWidth, height: dom.win.innerHeight } };
};

const dispatch: StepFn<'dispatch'> = (step, ctx) => {
  const dom = requireDom(ctx);
  const el = dom.querySelectorAll(step.selector)[0];
  if (!el) return { ok: false, reason: 'TARGET_NOT_FOUND' };
  const W = dom.win as Window & typeof globalThis;
  const errorsBefore = ctx.errorCount();
  switch (step.event) {
    case 'click':
    case 'dblclick':
      dom.dispatch(el, new W.MouseEvent(step.event, { bubbles: true, cancelable: true }));
      break;
    case 'submit': {
      const form = el instanceof W.HTMLFormElement ? el : el.closest('form');
      // requestSubmit runs validation and fires a real submit event; form-action 'none' stops
      // the navigation itself.
      if (form) form.requestSubmit();
      else dom.dispatch(el, new W.Event('submit', { bubbles: true, cancelable: true }));
      break;
    }
    case 'input':
    case 'change':
      if (step.value !== undefined && 'value' in el) (el as HTMLInputElement).value = step.value;
      dom.dispatch(el, new W.Event(step.event, { bubbles: true }));
      break;
    case 'keydown':
      dom.dispatch(
        el,
        new W.KeyboardEvent('keydown', { key: step.key ?? '', bubbles: true, cancelable: true }),
      );
      break;
    case 'focus':
    case 'blur':
      dom.dispatch(el, new W.FocusEvent(step.event));
      break;
  }
  if (ctx.errorCount() > errorsBefore) {
    const error = ctx.lastError();
    return { ok: false, reason: 'HANDLER_ERROR', ...(error ? { error } : {}) };
  }
  return { ok: true };
};

const setViewport: StepFn<'setViewport'> = async (step, ctx) => {
  const dom = requireDom(ctx);
  // A frame that is not painted (the hidden grading shell) may never get `resize`; the
  // measurements below do not depend on it, so it is awaited only briefly.
  const resized = new PromiseCtor<void>((resolve) => {
    const onResize = () => {
      dom.win.removeEventListener('resize', onResize);
      resolve();
    };
    dom.win.addEventListener('resize', onResize);
    promiseThen(
      ctx.wait(300),
      () => {
        dom.win.removeEventListener('resize', onResize);
        resolve();
      },
      () => undefined,
    );
  });
  await ctx.resizeViewport(step.width, step.height);
  await resized;
  // Not requestAnimationFrame: it can be delayed in a frame that is not visible.
  await ctx.wait(0);
  await ctx.wait(0);
  return { width: dom.win.innerWidth, height: dom.win.innerHeight };
};

const waitSettled: StepFn<'waitSettled'> = async (step, ctx) => ({
  settled: await ctx.settle(step.maxMs),
});

const advance: StepFn<'advance'> = () => {
  throw new UnsupportedStep('가상 타이머(advance)는 아직 지원하지 않습니다.');
};

const a11y: StepFn<'a11y'> = () => {
  throw new UnsupportedStep('접근성 검사(a11y)는 아직 지원하지 않습니다.');
};

const STEPS: { [Op in ObservationOp]: StepFn<Op> } = {
  callFunction,
  readGlobal,
  consoleOutput,
  domQuery,
  computedStyle,
  boxRect,
  dispatch,
  setViewport,
  advance,
  waitSettled,
  a11y,
};

/** Runs one step. Rejects with whatever the step throws; the caller sets the status. */
export function runStep(step: ObservationStep, ctx: StepContext): Promise<unknown> {
  const fn = STEPS[step.op] as StepFn<ObservationOp>;
  return new PromiseCtor<unknown>((resolve, reject) => {
    try {
      const out = fn(step, ctx);
      if (out instanceof PromiseCtor) promiseThen(out, resolve, reject);
      else resolve(out);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** Assembles a full observation from a step and its payload. */
export function observation(
  step: ObservationStep,
  status: Observation['status'],
  payload: unknown,
  error?: { name: string; message: string },
): Observation {
  const out = {
    ...(payload as object),
    op: step.op,
    id: step.id,
    status,
  } as Observation;
  if (error) out.error = error;
  return out;
}
