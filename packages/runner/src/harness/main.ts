/* eslint-disable @typescript-eslint/prefer-for-of, @typescript-eslint/unbound-method --
   Index loops and captured built-ins on purpose: learner code may replace Array iterators and
   prototype methods (docs/design/code-execution-sandbox.md#하네스-무결성). */
/**
 * Harness: runs inside the js-console Worker or the nested learner document, before any learner
 * code (docs/design/code-execution-sandbox.md#테스트-하네스와-체크-실행).
 *
 * It captures console output, tracks timers, guards loops, records errors and, once the program
 * has settled, runs the observation steps. It only observes: it never sees expected values.
 *
 * Bundled by `shell/build.ts` into a single line, so inserting it into a learner document does not
 * move learner line numbers.
 */
import { HARNESS_CONFIG_GLOBAL, PREVIEW_TITLE_MAX_LENGTH } from '../protocol/constants.ts';
import type { ConsoleEntry, ConsoleLevel } from '@proginone/shared';
import type {
  BlockedRequest,
  HarnessConfig,
  HarnessLeftMessage,
  HarnessNoticeMessage,
  HarnessTitleMessage,
  HarnessToShell,
} from '../protocol/messages.ts';
import type {
  Observation,
  ObservationStep,
  RunError,
  SerializedValue,
  SourcePosition,
} from '@proginone/shared';
import {
  apply,
  arraySlice,
  create,
  defineProperty,
  ErrorCtor,
  freeze,
  G,
  getOwnPropertyDescriptor,
  MapCtor,
  mapDelete,
  mapForEach,
  mapGet,
  mapSet,
  mapSize,
  MathMax,
  MathMin,
  now,
  PromiseCtor,
  promiseThen,
  push,
  reExec,
  StringCtor,
  strSlice,
} from './intrinsics.ts';
import { createSerializer, DEFAULT_SERIALIZE_OPTIONS, estimateSize } from './serialize.ts';
import {
  type DomApi,
  EMPTY_PAYLOAD,
  type Lookup,
  observation,
  runStep,
  type Settled,
  type StepContext,
  StepTimeout,
  UnsupportedStep,
} from './steps.ts';

declare const importScripts: ((...urls: string[]) => void) | undefined;

type Fn = (...args: unknown[]) => unknown;

/** Grading runs: a form submission no handler cancelled (detectUncancelledSubmit). */
const SUBMIT_NAVIGATION_MESSAGE =
  '실행 중에는 다른 페이지로 이동하거나 폼을 전송할 수 없습니다. submit 이벤트 처리기에서 event.preventDefault()로 폼 전송을 막았는지 확인하세요.';
/** Preview title reports (D-082): changes within this window are sent as one report. */
const TITLE_REPORT_MS = 100;

const cfg = (G as unknown as Record<string, HarnessConfig | undefined>)[HARNESS_CONFIG_GLOBAL];
try {
  Reflect.deleteProperty(G, HARNESS_CONFIG_GLOBAL);
} catch {
  // a non-configurable global would be a shell bug; the run still works
}

if (cfg) start(cfg);

function start(config: HarnessConfig) {
  const isWorker = typeof document === 'undefined';
  const { limits, steps, sourceIds } = config;
  const stdin = arraySlice(config.stdin);
  let stdinNext = 0;
  const t0 = now();

  // ---- captured platform functions -------------------------------------------------------
  const nativeSetTimeout = G.setTimeout as unknown as Fn;
  const nativeClearTimeout = G.clearTimeout as unknown as Fn;
  const nativeSetInterval = G.setInterval as unknown as Fn;
  const nativeClearInterval = G.clearInterval as unknown as Fn;
  const nativeRaf = isWorker ? undefined : (G.requestAnimationFrame as unknown as Fn);
  const nativeCancelRaf = isWorker ? undefined : (G.cancelAnimationFrame as unknown as Fn);
  const postToPort = MessagePort.prototype.postMessage as Fn;
  const nativeConsole = G.console as unknown as Record<string, Fn | undefined>;
  const nativeConsoleLog = nativeConsole['log'];
  const addListener = G.addEventListener.bind(G);
  const createObjectURL = URL.createObjectURL.bind(URL);
  const BlobCtor = Blob;
  const setTimeoutRaw = (fn: () => void, ms: number): unknown =>
    apply(nativeSetTimeout, G, [fn, ms]);

  // ---- transport ---------------------------------------------------------------------------
  let port: MessagePort | null = null;
  const outbox: HarnessToShell[] = [];
  const send = (msg: HarnessToShell) => {
    if (port) apply(postToPort, port, [msg]);
    else push(outbox, msg);
  };
  const attachPort = (p: MessagePort) => {
    port = p;
    p.onmessage = onShellMessage;
    for (let i = 0; i < outbox.length; i++) apply(postToPort, p, [outbox[i]]);
    outbox.length = 0;
  };

  // ---- output budget ---------------------------------------------------------------------
  let outputBytes = 0;
  const serialize = createSerializer({
    ...DEFAULT_SERIALIZE_OPTIONS,
    maxString: MathMin(DEFAULT_SERIALIZE_OPTIONS.maxString, limits.maxEntryBytes - 1_024),
    ...(isWorker ? {} : { nodeCtor: G.Node }),
  });

  // ---- console -----------------------------------------------------------------------------
  let consoleSeq = 0;
  let dropped = 0;
  let batch: ConsoleEntry[] = [];
  /** Everything recorded, for `consoleOutput` snapshots (bounded by maxConsoleEntries). */
  const allEntries: ConsoleEntry[] = [];
  let flushScheduled = false;
  let lastActivity = now();
  const flush = () => {
    flushScheduled = false;
    if (batch.length === 0) return;
    const entries = batch;
    batch = [];
    send({ type: 'console', entries });
  };
  const addEntry = (level: ConsoleLevel, args: ArrayLike<unknown>) => {
    lastActivity = now();
    if (consoleSeq >= limits.maxConsoleEntries || outputBytes >= limits.maxOutputBytes) {
      dropped++;
      return;
    }
    let sargs: SerializedValue[] = [];
    for (let i = 0; i < args.length && i < 100; i++) push(sargs, serialize(args[i]));
    let size = estimateSize(sargs);
    if (size > limits.maxEntryBytes) {
      sargs = [{ t: 'unserializable' as const, reason: 'entry exceeds maxEntryBytes' }];
      size = 64;
    }
    outputBytes += size;
    consoleSeq++;
    const entry: ConsoleEntry = { seq: consoleSeq, level, args: sargs, at: now() - t0 };
    push(batch, entry);
    push(allEntries, entry);
    // Developer tools still show the first entries; floods are not mirrored.
    if (consoleSeq <= 100 && nativeConsoleLog) {
      const native = nativeConsole[level] ?? nativeConsoleLog;
      try {
        apply(native, nativeConsole, arraySlice(args));
      } catch {
        // ignore
      }
    }
    if (!flushScheduled) {
      flushScheduled = true;
      setTimeoutRaw(flush, 16);
    }
  };

  const counts = new MapCtor<string, number>();
  const timers = new MapCtor<string, number>();
  const label = (v: unknown) => (v === undefined ? 'default' : StringCtor(v));
  const shimConsole: Record<string, Fn> = create(null) as Record<string, Fn>;
  // Setup runs before learner code, so plain iteration is fine here.
  const levels: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug', 'table', 'dir'];
  for (const level of levels) {
    shimConsole[level] = function (...args: unknown[]) {
      addEntry(level, args);
    };
  }
  const logLike = function (...args: unknown[]) {
    addEntry('log', args);
  };
  shimConsole['trace'] = logLike;
  shimConsole['group'] = logLike;
  shimConsole['groupCollapsed'] = logLike;
  shimConsole['groupEnd'] = () => undefined;
  shimConsole['clear'] = () => undefined;
  shimConsole['assert'] = function (cond: unknown, ...args: unknown[]) {
    if (!cond) addEntry('error', ['Assertion failed', ...args]);
  };
  shimConsole['count'] = function (name?: unknown) {
    const key = label(name);
    const n = (mapGet(counts, key) ?? 0) + 1;
    mapSet(counts, key, n);
    addEntry('log', [`${key}: ${n}`]);
  };
  shimConsole['countReset'] = function (name?: unknown) {
    mapSet(counts, label(name), 0);
  };
  shimConsole['time'] = function (name?: unknown) {
    mapSet(timers, label(name), now());
  };
  shimConsole['timeEnd'] = function (name?: unknown) {
    const key = label(name);
    const startedAt = mapGet(timers, key);
    if (startedAt === undefined) return;
    mapDelete(timers, key);
    addEntry('log', [`${key}: ${(now() - startedAt).toFixed(3)} ms`]);
  };
  defineProperty(G, 'console', { value: shimConsole, writable: true, configurable: true });

  // ---- dialogs (no allow-modals: native ones would be ignored) -------------------------------
  const nextInput = (): string | undefined => stdin[stdinNext++];
  const dialogs: Record<string, Fn> = {
    alert(message?: unknown) {
      addEntry('alert', [message === undefined ? '' : message]);
    },
    confirm(message?: unknown) {
      addEntry('confirm', [message === undefined ? '' : message]);
      const input = nextInput();
      return input === undefined ? true : !/^(false|no|n|0|아니오|취소)?$/i.test(input.trim());
    },
    prompt(message?: unknown, defaultValue?: unknown) {
      addEntry('prompt', [message === undefined ? '' : message]);
      const input = nextInput();
      if (input !== undefined) return input;
      return defaultValue === undefined ? null : StringCtor(defaultValue);
    },
  };
  for (const name of ['alert', 'confirm', 'prompt']) {
    defineProperty(G, name, { value: dialogs[name], writable: true, configurable: true });
  }

  // ---- storage (opaque origin: the real ones throw) ----------------------------------------
  if (!isWorker) {
    const memoryStorage = () => {
      const data = new MapCtor<string, string>();
      const keyList = () => {
        const out: string[] = [];
        mapForEach(data, (_v, k) => {
          push(out, k);
        });
        return out;
      };
      return freeze({
        getItem: (k: unknown) => mapGet(data, StringCtor(k)) ?? null,
        setItem: (k: unknown, v: unknown) => {
          mapSet(data, StringCtor(k), StringCtor(v));
        },
        removeItem: (k: unknown) => {
          mapDelete(data, StringCtor(k));
        },
        clear: () => {
          const keys = keyList();
          for (let i = 0; i < keys.length; i++) mapDelete(data, keys[i]);
        },
        key: (i: number) => keyList()[i] ?? null,
        get length() {
          return mapSize(data);
        },
      });
    };
    for (const name of ['localStorage', 'sessionStorage']) {
      try {
        defineProperty(G, name, { value: memoryStorage(), configurable: true });
      } catch {
        // keep going without the shim
      }
    }
  }

  // ---- timers ------------------------------------------------------------------------------
  const liveTimeouts = new MapCtor<unknown, true>();
  const liveIntervals = new MapCtor<unknown, true>();
  const liveFrames = new MapCtor<unknown, true>();
  defineProperty(G, 'setTimeout', {
    writable: true,
    configurable: true,
    value: function setTimeout(fn: unknown, ms?: unknown, ...rest: unknown[]) {
      // String timers are blocked by the CSP (no 'unsafe-eval'); let the browser ignore them.
      if (typeof fn !== 'function') return apply(nativeSetTimeout, G, [fn, ms, ...rest]);
      const id = apply(nativeSetTimeout, G, [
        () => {
          mapDelete(liveTimeouts, id);
          lastActivity = now();
          apply(fn as Fn, G, rest);
        },
        ms,
      ]);
      mapSet(liveTimeouts, id, true);
      return id;
    },
  });
  defineProperty(G, 'clearTimeout', {
    writable: true,
    configurable: true,
    value: function clearTimeout(id: unknown) {
      mapDelete(liveTimeouts, id);
      return apply(nativeClearTimeout, G, [id]);
    },
  });
  defineProperty(G, 'setInterval', {
    writable: true,
    configurable: true,
    value: function setInterval(fn: unknown, ms?: unknown, ...rest: unknown[]) {
      if (typeof fn !== 'function') return apply(nativeSetInterval, G, [fn, ms, ...rest]);
      const id = apply(nativeSetInterval, G, [
        () => {
          lastActivity = now();
          apply(fn as Fn, G, rest);
        },
        ms,
      ]);
      mapSet(liveIntervals, id, true);
      return id;
    },
  });
  defineProperty(G, 'clearInterval', {
    writable: true,
    configurable: true,
    value: function clearInterval(id: unknown) {
      mapDelete(liveIntervals, id);
      return apply(nativeClearInterval, G, [id]);
    },
  });
  if (nativeRaf && nativeCancelRaf) {
    defineProperty(G, 'requestAnimationFrame', {
      writable: true,
      configurable: true,
      value: function requestAnimationFrame(fn: unknown) {
        const id = apply(nativeRaf, G, [
          (t: number) => {
            mapDelete(liveFrames, id);
            lastActivity = now();
            apply(fn as Fn, G, [t]);
          },
        ]);
        mapSet(liveFrames, id, true);
        return id;
      },
    });
    defineProperty(G, 'cancelAnimationFrame', {
      writable: true,
      configurable: true,
      value: function cancelAnimationFrame(id: unknown) {
        mapDelete(liveFrames, id);
        return apply(nativeCancelRaf, G, [id]);
      },
    });
  }

  // ---- errors ------------------------------------------------------------------------------
  const errors: RunError[] = [];
  const blocked: BlockedRequest[] = [];
  let loopLimitHit = false;

  const loopMessage = `반복문이 ${limits.loopBudgetMs}ms 넘게 실행되어 멈췄습니다.`;
  class LoopLimitError extends ErrorCtor {
    constructor() {
      super(loopMessage);
      this.name = 'LoopLimitError';
    }
  }
  const isLoopLimit = (e: unknown) => e instanceof LoopLimitError;

  const BLOB_FRAME = /(blob:[^\s)]+?):(\d+):(\d+)/g;
  const positionOf = (url: string, line: number, column: number): SourcePosition | null => {
    const id = sourceIds[url];
    return id ? { file: id, line, column } : null;
  };
  const stackPositions = (stack: unknown): SourcePosition[] => {
    const out: SourcePosition[] = [];
    if (typeof stack !== 'string') return out;
    BLOB_FRAME.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = reExec(BLOB_FRAME, stack)) && out.length < 20) {
      const pos = positionOf(m[1] ?? '', Number(m[2]), Number(m[3]));
      if (pos) push(out, pos);
    }
    return out;
  };
  const record = (phase: RunError['phase'], error: unknown, position?: SourcePosition | null) => {
    if (errors.length >= 100) return;
    lastActivity = now();
    const e = (typeof error === 'object' && error !== null ? error : {}) as {
      name?: unknown;
      message?: unknown;
      stack?: unknown;
    };
    let name: string;
    let message: string;
    try {
      name = typeof e.name === 'string' ? e.name : 'Error';
      message = typeof e.message === 'string' ? e.message : StringCtor(error);
    } catch {
      name = 'Error';
      message = 'unknown error';
    }
    const rec: RunError = {
      phase,
      name: strSlice(name, 0, 200),
      message: strSlice(message, 0, 10_000),
    };
    let stack: SourcePosition[];
    try {
      stack = stackPositions(e.stack);
    } catch {
      stack = [];
    }
    const pos = position ?? stack[0];
    if (pos) rec.position = pos;
    if (stack.length > 0) rec.stack = stack;
    push(errors, rec);
  };

  addListener(
    'error',
    (ev: Event) => {
      if (!(ev instanceof (G as unknown as { ErrorEvent: typeof ErrorEvent }).ErrorEvent)) return; // resource errors
      if (isLoopLimit(ev.error)) {
        ev.preventDefault();
        return;
      }
      const pos =
        positionOf(ev.filename, ev.lineno, ev.colno) ??
        (ev.lineno ? { file: ev.filename || 'document', line: ev.lineno } : null);
      record('runtime', ev.error ?? { name: 'Error', message: ev.message }, pos);
    },
    true,
  );
  addListener(
    'unhandledrejection',
    (ev: Event) => {
      const reason = (ev as PromiseRejectionEvent).reason as unknown;
      if (isLoopLimit(reason)) return;
      record('unhandled_rejection', reason);
    },
    true,
  );
  addListener(
    'securitypolicyviolation',
    (ev: Event) => {
      const v = ev as SecurityPolicyViolationEvent;
      if (blocked.length < 50) {
        push(blocked, {
          directive: strSlice(v.effectiveDirective || v.violatedDirective, 0, 100),
          uri: strSlice(v.blockedURI, 0, 500),
        });
      }
    },
    true,
  );

  // ---- loop guard and the frozen __pg global -------------------------------------------------
  interface LoopHandle {
    source: number;
    line: number;
    column: number;
    start: number;
    n: number;
    tripped: boolean;
  }
  let exposed: Record<string, unknown> | null = null;
  let argsReaders: Record<string, unknown> | null = null;
  const pg = freeze({
    enter: (source: number, line: number, column: number): LoopHandle => ({
      source,
      line,
      column,
      start: now(),
      n: 0,
      tripped: false,
    }),
    tick: (h: LoopHandle) => {
      h.n++;
      // Once one loop ran out, the program has failed: any loop that runs afterwards (e.g. in
      // the `catch` that swallowed the error) stops at once instead of getting a new budget.
      if (h.tripped || loopLimitHit) throw new LoopLimitError();
      // Checking the clock every 256 iterations keeps tight loops cheap.
      if ((h.n & 255) === 0 && now() - h.start > limits.loopBudgetMs) {
        h.tripped = true;
        if (errors.length < 100) {
          push(errors, {
            phase: 'loop_limit',
            name: 'LoopLimitError',
            message: loopMessage,
            position: { file: `orig:${h.source}`, line: h.line, column: h.column + 1 },
          });
        }
        loopLimitHit = true;
        throw new LoopLimitError();
      }
    },
    expose: (readers: Record<string, unknown>, argReaders?: Record<string, unknown>) => {
      exposed ??= readers;
      argsReaders ??= argReaders ?? null;
    },
    /** Blob delivery: writes inline script `i` back as a parser-inserted `blob:` script. */
    w: (i: number) => {
      const script = config.scripts[i];
      if (!script || !documentWrite) return;
      const url = createObjectURL(new BlobCtor([script.code], { type: 'text/javascript' }));
      sourceIds[url] = `src:${script.id}`;
      apply(documentWrite, document, [`<script src="${url}"></scr` + 'ipt>']);
    },
  });
  // Blob delivery needs a parser-inserted script at the inline script's position, which only
  // document.write gives (PoC B6).
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const documentWrite = isWorker ? undefined : (Document.prototype.write as Fn);
  defineProperty(G, '__pg', { value: pg, writable: false, configurable: false, enumerable: false });

  const lookup = (name: string): Lookup => {
    const reader: unknown = exposed ? getOwnPropertyDescriptor(exposed, name)?.value : undefined;
    if (typeof reader === 'function') {
      const r = apply(reader as Fn, undefined, []) as { s: number; v?: unknown };
      if (r.s === 0) return { status: 'found', value: r.v };
      return { status: r.s === 2 ? 'tdz' : 'missing' };
    }
    const g = getOwnPropertyDescriptor(G, name);
    return g && 'value' in g
      ? { status: 'found', value: g.value as unknown }
      : { status: 'missing' };
  };

  // ---- settling ----------------------------------------------------------------------------
  const wait = (ms: number) =>
    new PromiseCtor<void>((resolve) => {
      setTimeoutRaw(resolve, ms);
    });
  const quiet = () =>
    mapSize(liveTimeouts) === 0 &&
    mapSize(liveIntervals) === 0 &&
    mapSize(liveFrames) === 0 &&
    now() - lastActivity >= limits.quietMs;
  /**
   * Resolves `true` once no timer, interval or frame is pending and nothing happened for
   * `quietMs`; `false` at the deadline. Checked from a timer callback, so earlier microtasks
   * have all run.
   */
  const settle = (maxMs: number) =>
    new PromiseCtor<boolean>((resolve) => {
      const deadline = now() + maxMs;
      const check = () => {
        if (quiet()) resolve(true);
        else if (now() >= deadline) resolve(false);
        else setTimeoutRaw(check, 10);
      };
      setTimeoutRaw(check, 0);
    });
  const withTimeout = <T>(p: Promise<T>, ms: number) =>
    new PromiseCtor<Settled<T>>((resolve) => {
      let done = false;
      setTimeoutRaw(() => {
        if (!done) {
          done = true;
          resolve({ timedOut: true });
        }
      }, ms);
      promiseThen(
        p,
        (value) => {
          if (!done) {
            done = true;
            resolve({ value });
          }
        },
        (rejected: unknown) => {
          if (!done) {
            done = true;
            resolve({ rejected });
          }
        },
      );
    });

  // ---- shell requests ------------------------------------------------------------------------
  let reqSeq = 0;
  const pendingReplies = new MapCtor<number, () => void>();
  function onShellMessage(e: MessageEvent) {
    const d = e.data as { type?: unknown; reqId?: unknown } | null;
    if (d?.type === 'viewport-done' && typeof d.reqId === 'number') {
      const resolve = mapGet(pendingReplies, d.reqId);
      if (resolve) {
        mapDelete(pendingReplies, d.reqId);
        resolve();
      }
    }
  }
  const resizeViewport = (width: number, height: number) =>
    new PromiseCtor<void>((resolve) => {
      const reqId = ++reqSeq;
      mapSet(pendingReplies, reqId, resolve);
      send({ type: 'viewport', reqId, width, height });
    });

  // ---- steps -------------------------------------------------------------------------------
  let dom: DomApi | null = null;
  if (!isWorker) {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- a deprecated overload, not the method
    const qsa = Document.prototype.querySelectorAll as Fn;
    const gcs = G.getComputedStyle as unknown as Fn;
    const rectOf = Element.prototype.getBoundingClientRect as Fn;
    const dispatchEv = EventTarget.prototype.dispatchEvent as Fn;
    dom = {
      win: G as unknown as Window,
      doc: document,
      querySelectorAll: (selector) =>
        arraySlice(apply(qsa, document, [selector]) as NodeListOf<Element>),
      computedStyle: (el, pseudo) => apply(gcs, G, [el, pseudo]) as CSSStyleDeclaration,
      rect: (el) => apply(rectOf, el, []) as DOMRect,
      dispatch: (target, event) => apply(dispatchEv, target, [event]) as boolean,
    };
  }
  const ctx: StepContext = {
    serialize,
    lookup,
    argsReader: (stepId) => {
      const reader: unknown = argsReaders
        ? getOwnPropertyDescriptor(argsReaders, stepId)?.value
        : undefined;
      return typeof reader === 'function' ? (reader as () => unknown) : undefined;
    },
    consoleEntries: () => ({ entries: allEntries, truncated: dropped > 0 }),
    consoleSeq: () => consoleSeq,
    errorCount: () => errors.length,
    lastError: () => {
      const last = errors[errors.length - 1];
      return last ? { name: last.name, message: last.message } : undefined;
    },
    isLoopLimit,
    settle,
    wait,
    withTimeout,
    resizeViewport,
    checkTimeoutMs: limits.checkTimeoutMs,
    dom,
  };

  const observations: Observation[] = [];
  const errorOf = (e: unknown) => {
    const x = (typeof e === 'object' && e !== null ? e : {}) as {
      name?: unknown;
      message?: unknown;
    };
    return {
      name: strSlice(typeof x.name === 'string' ? x.name : 'Error', 0, 1_000),
      message: strSlice(typeof x.message === 'string' ? x.message : StringCtor(e), 0, 10_000),
    };
  };
  /** Runs one step within `budgetMs` and records its observation with the shared envelope. */
  const observe = async (step: ObservationStep, budgetMs: number) => {
    const own =
      step.op === 'callFunction' && step.timeoutMs !== undefined ? step.timeoutMs + 100 : 0;
    const limit = MathMin(own > 0 ? own : limits.checkTimeoutMs, budgetMs);
    const settled = await withTimeout(runStep(step, ctx), limit);
    const empty = EMPTY_PAYLOAD[step.op];
    if ('timedOut' in settled) {
      push(observations, observation(step, 'timeout', empty));
    } else if ('rejected' in settled) {
      const e = settled.rejected;
      if (e instanceof StepTimeout) push(observations, observation(step, 'timeout', empty));
      else if (e instanceof UnsupportedStep) {
        push(observations, observation(step, 'skipped', empty, errorOf(e)));
      } else push(observations, observation(step, 'error', empty, errorOf(e)));
    } else {
      const size = estimateSize(settled.value);
      // Console snapshots are already bounded by the console limits.
      const tooLarge =
        step.op !== 'consoleOutput' &&
        (size > limits.maxObservationBytes || outputBytes + size > limits.maxOutputBytes);
      if (tooLarge) {
        push(
          observations,
          observation(step, 'error', empty, {
            name: 'ObservationTooLarge',
            message: '관측값이 크기 제한을 넘었습니다.',
          }),
        );
      } else {
        if (step.op !== 'consoleOutput') outputBytes += size;
        push(observations, observation(step, 'ok', settled.value));
      }
    }
  };

  // ---- finishing -------------------------------------------------------------------------
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    flush();
    send({
      type: 'done',
      status: loopLimitHit ? 'loop_limit' : errors.length > 0 ? 'error' : 'completed',
      errors,
      observations,
      droppedConsoleEntries: dropped,
      pendingAtEnd: {
        timers: mapSize(liveTimeouts) + mapSize(liveFrames),
        intervals: mapSize(liveIntervals),
      },
      blocked,
    });
  };

  const afterScripts = async () => {
    try {
      const deadline = t0 + limits.maxDurationMs - 250;
      // Without steps, wait for the program to settle. With steps, the bundle decides how long
      // to wait (it starts with `waitSettled`), so all of the time is left for the steps.
      if (steps.length === 0) await settle(MathMax(50, deadline - now()));
      send({ type: 'settled' });
      for (let i = 0; i < steps.length; i++) {
        // A navigation attempt ends the run early (detectUncancelledSubmit, pagehide).
        if (finished) return;
        const step = steps[i];
        if (!step) continue;
        const left = deadline - now();
        if (left < 50) {
          // Out of run time: report the rest instead of letting the shell's hard stop drop
          // every observation.
          push(
            observations,
            observation(step, 'skipped', EMPTY_PAYLOAD[step.op], {
              name: 'RunTimeExceeded',
              message: '실행 시간 제한 안에 이 단계를 실행하지 못했습니다.',
            }),
          );
          continue;
        }
        await observe(step, left);
      }
    } catch (e) {
      record('harness', e);
    }
    finish();
  };

  // ---- preview navigation ------------------------------------------------------------------
  /**
   * Preview only. Following a link or submitting a form would navigate the learner document,
   * which the shell CSP blocks (`frame-src`/`form-action 'none'`), so the learner would only see
   * the browser's error page. Cancel those navigations before the browser starts them and ask the
   * shell to show a notice. The sandbox itself is unchanged: this only stops navigations earlier.
   *
   * Fragment links (`#id`) are cancelled too: a `srcdoc` document resolves them against its
   * parent's URL, so even they would leave the document. They scroll to their target instead and
   * show no notice.
   *
   * Learner code keeps its usual view of the event: the listener runs first (window, capture,
   * registered before any learner code), cancels the default action with the captured
   * `preventDefault`, and shadows `preventDefault`/`defaultPrevented`/`returnValue` on that event
   * so learner handlers see only their own cancellation. The default (notice or scroll) happens
   * only when no learner handler cancelled the event (e.g. a submit handler that calls
   * `event.preventDefault()` gets no notice). Limitation: an inline handler's `return false`
   * cancels without calling `preventDefault`, so it still gets the notice.
   */
  function interceptNavigation(parentWindow: Window) {
    const ElementCtor = G.Element;
    const closest = ElementCtor.prototype.closest;
    const getAttribute = ElementCtor.prototype.getAttribute as Fn;
    const scrollIntoView = ElementCtor.prototype.scrollIntoView as Fn;
    const getElementById = Document.prototype.getElementById;
    const getElementsByName = Document.prototype.getElementsByName;
    const scrollTo = G.scrollTo as unknown as Fn;
    const decode = decodeURIComponent;
    const nativePreventDefault = Event.prototype.preventDefault;
    const notice: HarnessNoticeMessage = { type: 'pg-notice', notice: 'navigation-blocked' };
    const attr = (el: Element, name: string) => apply(getAttribute, el, [name]) as string | null;

    /** What following this event would do: `null` (nothing to stop), a fragment, or leave. */
    const navigation = (ev: Event): { fragment: string } | 'leave' | null => {
      const target = ev.target;
      if (!(target instanceof ElementCtor)) return null;
      if (ev.type === 'click') {
        const link = apply(closest, target, ['a[href], area[href]']) as Element | null;
        if (link === null) return null;
        const href = attr(link, 'href') ?? '';
        if (reExec(/^\s*javascript:/i, href)) return null; // runs script, stays
        const hash = reExec(/^\s*#(.*)$/, href);
        return hash ? { fragment: hash[1] ?? '' } : 'leave';
      }
      // `submit`: scripts dispatching a plain `Event('submit')` submit nothing; `<form
      // method="dialog">` closes its dialog instead of navigating.
      if (!ev.isTrusted) return null;
      const submitter = (ev as SubmitEvent).submitter;
      const method = (submitter && attr(submitter, 'formmethod')) ?? attr(target, 'method') ?? '';
      return reExec(/^\s*dialog\s*$/i, method) ? null : 'leave';
    };

    /** Scrolls like a same-document fragment navigation: `id`, then `name`, else `#top`. */
    const scrollToFragment = (raw: string) => {
      let id = raw;
      try {
        id = decode(raw);
      } catch {
        // keep it as written
      }
      let el: unknown = null;
      if (id !== '') {
        el =
          apply(getElementById, document, [id]) ??
          (apply(getElementsByName, document, [id]) as NodeList)[0];
      }
      if (el instanceof ElementCtor) apply(scrollIntoView, el, []);
      else if (id === '' || reExec(/^top$/i, id)) apply(scrollTo, G, [0, 0]);
    };

    const onNavigation = (ev: Event) => {
      const nav = ev.cancelable ? navigation(ev) : null;
      if (nav === null) return;
      apply(nativePreventDefault, ev, []);
      let cancelled = false;
      try {
        defineProperty(ev, 'preventDefault', {
          configurable: true,
          value: function preventDefault() {
            cancelled = true;
          },
        });
        defineProperty(ev, 'defaultPrevented', { configurable: true, get: () => cancelled });
        defineProperty(ev, 'returnValue', {
          configurable: true,
          get: () => !cancelled,
          set: (value: unknown) => {
            if (!value) cancelled = true;
          },
        });
      } catch {
        return; // learner handlers see the cancellation; acting on it could then be wrong
      }
      // The whole dispatch has finished by the time a timer runs.
      setTimeoutRaw(() => {
        if (cancelled) return;
        try {
          if (nav === 'leave') parentWindow.postMessage(notice, '*');
          else scrollToFragment(nav.fragment);
        } catch {
          // ignore
        }
      }, 0);
    };
    addListener('click', onNavigation, true);
    addListener('submit', onNavigation, true);
  }

  // ---- preview tab title ---------------------------------------------------------------------
  /**
   * Preview only (D-082). The preview has no browser tab, so the app shows the document title in
   * a tab bar above it. Reports `document.title` to the shell at `DOMContentLoaded` and `load`, and
   * after any change to the document (a `MutationObserver` on the whole document sees a `<title>`
   * edit, a `document.title = …` assignment and a `<title>` added or removed by script). Changes
   * are batched: one report at most every {@link TITLE_REPORT_MS} ms, with the title as it is
   * then, and only when it differs from the last report.
   *
   * The getter and the observer are captured before learner code runs, so redefining
   * `document.title` or `MutationObserver` cannot change what is reported. Learner code can still
   * post its own `pg-title`; that only changes the title shown above its own preview.
   */
  function reportTitle(parentWindow: Window) {
    const titleGetter = getOwnPropertyDescriptor(G.Document.prototype, 'title')?.get as
      Fn | undefined;
    const ObserverCtor = G.MutationObserver;
    const observe = ObserverCtor.prototype.observe as Fn;
    if (!titleGetter) return;
    const doc = document;
    let last: string | null = null;
    let scheduled = false;

    const sendTitle = () => {
      scheduled = false;
      let title: string;
      try {
        title = strSlice(
          StringCtor(apply(titleGetter, doc, [])),
          0,
          // Only bounds the message: the shell normalizes and makes the exact cut.
          PREVIEW_TITLE_MAX_LENGTH * 2,
        );
      } catch {
        return;
      }
      if (title === last) return;
      last = title;
      try {
        parentWindow.postMessage({ type: 'pg-title', title } satisfies HarnessTitleMessage, '*');
      } catch {
        // ignore
      }
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeoutRaw(sendTitle, TITLE_REPORT_MS);
    };

    try {
      const observer = new ObserverCtor(schedule);
      apply(observe, observer, [doc, { childList: true, subtree: true, characterData: true }]);
    } catch {
      // without the observer the title is still reported at DOMContentLoaded and load
    }
    addListener('DOMContentLoaded', sendTitle);
    addListener('load', sendTitle);
  }

  // ---- grading: un-cancelled form submission ------------------------------------------------
  /**
   * `dom` (grading) runs only. A form submission that no handler cancelled navigates the learner
   * document; the shell CSP (`form-action 'none'`) blocks it and the browser swaps in an error
   * page, which `pagehide` reports — but only once the navigation task runs, so later steps
   * sometimes finished first and the same answer passed or failed at random. Decide at once
   * instead: a capture listener (window, registered before any learner code) remembers every
   * trusted `submit`; a microtask queued from it runs after the whole dispatch (every learner
   * handler) and before the navigation task, reads the event's real `defaultPrevented` with the
   * captured getter, and if nothing cancelled a submission that leaves the document, records
   * `NavigationError` and finishes the run. The sandbox is unchanged (the navigation is still
   * blocked by the CSP); this only reports it deterministically.
   *
   * Not leaving: untrusted `submit` events (a script's `dispatchEvent(new Event('submit'))`
   * submits nothing), `method="dialog"`, and a target other than the document itself (the
   * sandbox has no `allow-popups`/`allow-top-navigation`). `form.submit()` and `location`
   * changes fire no event and are still caught by `pagehide`.
   */
  function detectUncancelledSubmit() {
    const EventProto = Event.prototype;
    const defaultPrevented = getOwnPropertyDescriptor(EventProto, 'defaultPrevented')?.get as
      Fn | undefined;
    const submitterOf = getOwnPropertyDescriptor(G.SubmitEvent.prototype, 'submitter')?.get as
      Fn | undefined;
    const getAttribute = G.Element.prototype.getAttribute as Fn;
    const ElementCtor = G.Element;
    const microtask = G.queueMicrotask.bind(G);
    const attr = (el: unknown, name: string) =>
      el instanceof ElementCtor ? (apply(getAttribute, el, [name]) as string | null) : null;

    const leaves = (ev: Event): boolean => {
      const form = ev.target;
      // `isTrusted` is an unforgeable own property.
      if (!(form instanceof ElementCtor) || !ev.isTrusted) return false;
      const submitter = submitterOf ? (apply(submitterOf, ev, []) as Element | null) : null;
      const method = attr(submitter, 'formmethod') ?? attr(form, 'method') ?? '';
      if (reExec(/^\s*dialog\s*$/i, method)) return false;
      const target = attr(submitter, 'formtarget') ?? attr(form, 'target') ?? '';
      return reExec(/^\s*(_self)?\s*$/i, target) !== null;
    };

    addListener(
      'submit',
      ((ev: Event) => {
        if (finished || !defaultPrevented || !leaves(ev)) return;
        microtask(() => {
          if (finished || (apply(defaultPrevented, ev, []) as boolean)) return;
          record('runtime', {
            name: 'NavigationError',
            message: SUBMIT_NAVIGATION_MESSAGE,
          });
          finish();
        });
      }) as EventListener,
      true,
    );
  }

  // ---- start ---------------------------------------------------------------------------------
  if (isWorker) {
    // Firefox does not apply the inherited connect-src to EventSource in workers (PoC S5-w), and
    // learner workers would escape the loop guard. MVP lessons need none of them.
    for (const name of ['EventSource', 'Worker', 'SharedWorker']) {
      try {
        defineProperty(G, name, { value: undefined, writable: false, configurable: false });
      } catch {
        // ignore
      }
    }
    const load = importScripts;
    const onStart = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; scripts?: unknown; expose?: unknown } | null;
      const transferred = e.ports[0];
      if (port || d?.type !== 'start' || !transferred) return;
      G.removeEventListener('message', onStart);
      attachPort(transferred);
      const urls = (Array.isArray(d.scripts) ? d.scripts : []) as string[];
      for (let i = 0; i < urls.length; i++) {
        try {
          load?.(urls[i] ?? '');
        } catch (err) {
          if (!isLoopLimit(err)) {
            record((err as { name?: unknown }).name === 'SyntaxError' ? 'syntax' : 'runtime', err);
          }
        }
      }
      if (typeof d.expose === 'string') {
        try {
          load?.(d.expose);
        } catch (err) {
          record('harness', err);
        }
      }
      void afterScripts();
    };
    addListener('message', onStart as EventListener);
  } else {
    const parentWindow = G.parent;
    addListener(
      'message',
      ((e: MessageEvent) => {
        const d = e.data as { type?: unknown } | null;
        const transferred = e.ports[0];
        if (port || e.source !== parentWindow || d?.type !== 'pg-port' || !transferred) return;
        e.stopImmediatePropagation();
        attachPort(transferred);
      }) as EventListener,
      true,
    );
    parentWindow.postMessage({ type: 'pg-harness-hello' }, '*');
    if (config.interceptNavigation) interceptNavigation(parentWindow);
    else detectUncancelledSubmit();
    if (config.reportTitle) reportTitle(parentWindow);
    addListener('load', () => {
      void afterScripts();
    });
    // Navigating the learner document (location, <meta refresh>, form submission) is blocked by
    // the shell CSP, and the browser replaces the document with an error page. End the run now
    // with an explanation instead of waiting for the shell's time limit (PoC S11/S12).
    addListener('pagehide', () => {
      record('runtime', {
        name: 'NavigationError',
        message: '실행 중에는 다른 페이지로 이동하거나 폼을 전송할 수 없습니다.',
      });
      finish();
      // Preview: also after the run (a click handler assigning `location`). The shell replaces
      // the browser's error page with an explanation (D-074).
      if (config.interceptNavigation) {
        try {
          parentWindow.postMessage({ type: 'pg-left' } satisfies HarnessLeftMessage, '*');
        } catch {
          // ignore
        }
      }
    });
  }
}
