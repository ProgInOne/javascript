import { parseRunResult, type RunResult } from '@proginone/shared';
import { PROTOCOL_VERSION } from '../protocol/constants.ts';
import {
  type HostToShell,
  type RunEvent,
  type RunPlan,
  type RunPlanInput,
  type RunnerNotice,
  type RunRequest,
  runnablePlanSchema,
  runRequestSchema,
  type ShellControl,
  shellControlSchema,
  shellHelloSchema,
} from '../protocol/messages.ts';
import { resolveLimits } from '../protocol/limits.ts';
// Type only: the module itself loads with `import()` below.
import type * as PrepareExports from '../prepare/index.ts';

type PrepareModule = typeof PrepareExports;
let prepareModule: Promise<PrepareModule> | null = null;

/**
 * The prepare step (HTML/JS parsing with parse5 and acorn, about half a megabyte) loads on first
 * use, so a page that only shows a runner does not pay for it up front (D-074). `ready()` and
 * `preloadRunner()` start it early; a failed load is retried on the next call.
 */
function loadPrepare(): Promise<PrepareModule> {
  prepareModule ??= import('../prepare/index.ts').catch((e: unknown) => {
    prepareModule = null;
    throw e;
  });
  return prepareModule;
}

/** Starts loading the prepare step without creating a shell (e.g. while the screen is idle). */
export function preloadRunner(): Promise<void> {
  return loadPrepare().then(
    () => undefined,
    () => undefined,
  );
}

/**
 * RunnerHost: the app side of the sandbox (docs/design/code-execution-sandbox.md#메시지-프로토콜).
 *
 * Owns one runner shell iframe at a time, validates every message from it, maps error positions
 * back to learner files and runs the watchdog. Create one host per purpose (e.g. a visible one for
 * the preview and a hidden one for grading); runs on one host are sequential and a new run aborts
 * the previous one.
 */

export interface RunnerHostOptions {
  /** Where the shell iframe goes. Default: `document.body`. */
  container?: HTMLElement;
  /** Origin of the local server that serves `/sandbox/runner.html`. Default: `location.origin`. */
  serverOrigin?: string;
  /**
   * `hidden`: grading and verification. Kept inside the viewport with `opacity: 0`; off-screen
   * frames stall timers in WebKit (PoC Q6) and `display: none` has no layout.
   * `visible`: preview; the iframe fills `container`.
   */
  placement?: 'hidden' | 'visible';
  /** Live console/progress events of the current run. */
  onEvent?: (event: RunEvent) => void;
  /**
   * Notices from a `preview` document, also after its run has finished (e.g. the learner clicked
   * a link the preview does not follow). Show them next to the preview.
   */
  onNotice?: (notice: RunnerNotice) => void;
  /**
   * The title of the `preview` document on screen (D-082): when it has parsed, has loaded and
   * after it changes, also after its run has finished. At most `PREVIEW_TITLE_MAX_LENGTH`
   * characters, `''` when the document has none. Learner code controls it: render it as text.
   */
  onTitle?: (title: string) => void;
  /**
   * Load every shell from its own `<shellId>.localhost` site (default `true`, D-018). A stuck
   * shell process is then never reused, and Firefox keeps the app responsive.
   */
  perShellSite?: boolean;
  /** How long to wait for `shell-hello` before falling back to the same-site shell. */
  helloTimeoutMs?: number;
}

export interface RunnerHost {
  /**
   * Validates, prepares and runs a plan. Syntax errors resolve without running learner code: the
   * shell only parses the broken scripts so that the messages are the browser's own (D-030).
   * Resolves with `aborted` when another run or `abort()` supersedes it.
   * @throws ZodError (rejects) when the plan fails validation, e.g. too many or too large files.
   */
  run(plan: RunPlanInput): Promise<RunResult>;
  /** Aborts the current run, if any. */
  abort(): void;
  /** Resolves once a shell is connected; `run` waits for this itself. */
  ready(): Promise<void>;
  /** Removes the shell and stops listening. Pending runs resolve as `aborted`. */
  dispose(): void;
  /** Diagnostics: shells created so far and whether the same-site fallback is in use. */
  readonly stats: { shellsCreated: number; usingFallback: boolean };
}

const HEARTBEAT_TIMEOUT_MS = 1_500;
const OVERTIME_GRACE_MS = 1_000;
const WATCHDOG_TICK_MS = 100;
const READY_TIMEOUT_MS = 3_000;
const SHELL_ALLOW = [
  'clipboard-read',
  'clipboard-write',
  'camera',
  'microphone',
  'geolocation',
  'fullscreen',
  'display-capture',
  'usb',
  'serial',
  'bluetooth',
  'payment',
  'screen-wake-lock',
]
  .map((f) => `${f} 'none'`)
  .join('; ');
const DEFAULT_VIEWPORT = { width: 800, height: 600 };

interface Shell {
  frame: HTMLIFrameElement;
  port: MessagePort | null;
  connected: Promise<void>;
}

interface PendingRun {
  runId: string;
  resolve: (r: RunResult) => void;
  started: number;
  lastHeartbeat: number;
  maxDurationMs: number;
  watchdog: ReturnType<typeof setInterval>;
  map: (r: RunResult) => RunResult;
}

const randomShellId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let id = '';
  for (const b of bytes) id += 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(b % 36);
  return id;
};

/** A result the host produces itself (syntax errors, watchdog, abort). */
function hostResult(
  runId: string,
  status: RunResult['status'],
  extra: Partial<RunResult> = {},
): RunResult {
  return {
    v: PROTOCOL_VERSION,
    type: 'result',
    runId,
    status,
    durationMs: 0,
    console: [],
    consoleTruncated: false,
    droppedConsoleEntries: 0,
    errors: [],
    observations: [],
    pendingAtEnd: { timers: 0, intervals: 0 },
    ...extra,
  };
}

export function createRunnerHost(options: RunnerHostOptions = {}): RunnerHost {
  const container = options.container ?? document.body;
  const serverOrigin = options.serverOrigin ?? location.origin;
  const placement = options.placement ?? 'hidden';
  const helloTimeoutMs = options.helloTimeoutMs ?? 3_000;
  const server = new URL(serverOrigin);
  let usingFallback = options.perShellSite === false || server.protocol !== 'http:';
  let shellsCreated = 0;
  let shell: Shell | null = null;
  let pending: PendingRun | null = null;
  let disposed = false;
  let runSeq = 0;
  let onHello: ((e: MessageEvent) => void) | null = null;

  const shellUrl = () => {
    const path = `/sandbox/runner.html?v=${PROTOCOL_VERSION}`;
    return usingFallback
      ? `${server.origin}${path}`
      : `http://${randomShellId()}.localhost:${server.port || '80'}${path}`;
  };

  const style = (frame: HTMLIFrameElement, viewport = DEFAULT_VIEWPORT) => {
    if (placement === 'visible') {
      frame.style.cssText = 'display:block;width:100%;height:100%;border:0';
      return;
    }
    frame.style.cssText =
      `position:fixed;left:0;top:0;width:${viewport.width}px;height:${viewport.height}px;` +
      'border:0;opacity:0;pointer-events:none;z-index:-1';
  };

  const discardShell = () => {
    if (!shell) return;
    shell.port?.close();
    shell.frame.remove();
    shell = null;
  };

  /** Creates a shell and connects to it. Falls back to the same-site shell once if needed. */
  const createShell = (): Shell => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    frame.setAttribute('allow', SHELL_ALLOW);
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('title', '코드 실행 결과');
    if (placement === 'hidden') {
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
    }
    style(frame);
    const created: Shell = { frame, port: null, connected: Promise.resolve() };
    created.connected = new Promise<void>((resolve, reject) => {
      const helloTimer = setTimeout(() => {
        if (shell !== created) return;
        cleanup();
        discardShell();
        if (!usingFallback) {
          // `*.localhost` did not answer (e.g. a browser that does not resolve it): same site.
          usingFallback = true;
          const next = createShell();
          next.connected.then(resolve, reject);
        } else {
          reject(new Error('실행 환경을 준비하지 못했습니다.'));
        }
      }, helloTimeoutMs);
      const cleanup = () => {
        clearTimeout(helloTimer);
        if (onHello) window.removeEventListener('message', onHello);
        onHello = null;
      };
      onHello = (e: MessageEvent) => {
        // The shell is an opaque origin ("null"), so the origin alone proves nothing: the source
        // window must be this very iframe.
        if (e.source !== frame.contentWindow || e.origin !== 'null') return;
        if (!shellHelloSchema.safeParse(e.data).success || shell !== created) return;
        cleanup();
        const channel = new MessageChannel();
        created.port = channel.port1;
        const readyTimer = setTimeout(() => {
          reject(new Error('실행 환경이 응답하지 않습니다.'));
        }, READY_TIMEOUT_MS);
        channel.port1.onmessage = (ev: MessageEvent) => {
          // Results come from code the learner can influence: shared guards (depth, __proto__)
          // and schema, exactly as the server checks them again.
          if ((ev.data as { type?: unknown } | null)?.type === 'result') {
            const result = parseRunResult(ev.data);
            if (result.success) onResult(result.data);
            return;
          }
          const parsed = shellControlSchema.safeParse(ev.data);
          if (!parsed.success) return;
          if (parsed.data.type === 'ready') {
            clearTimeout(readyTimer);
            resolve();
            return;
          }
          onShellMessage(parsed.data);
        };
        frame.contentWindow?.postMessage({ v: PROTOCOL_VERSION, type: 'connect' }, '*', [
          channel.port2,
        ]);
      };
      window.addEventListener('message', onHello);
    });
    // Avoid an unhandled rejection when nobody awaits a shell that failed to start.
    created.connected.catch(() => undefined);
    frame.src = shellUrl();
    shell = created;
    shellsCreated++;
    container.appendChild(frame);
    return created;
  };

  const ensureShell = () => {
    if (disposed) throw new Error('RunnerHost가 이미 정리되었습니다.');
    return (shell ?? createShell()).connected;
  };

  const settle = (p: PendingRun, result: RunResult) => {
    if (pending !== p) return;
    pending = null;
    clearInterval(p.watchdog);
    p.resolve(result);
  };

  function onShellMessage(msg: ShellControl) {
    if (msg.type === 'notice') {
      options.onNotice?.(msg.notice);
      return;
    }
    if (msg.type === 'title') {
      options.onTitle?.(msg.title);
      return;
    }
    const p = pending;
    if (msg.type === 'ready' || !p) return;
    if (msg.runId !== p.runId) return; // stale run
    p.lastHeartbeat = performance.now();
    if (msg.type === 'event') options.onEvent?.(msg);
  }

  function onResult(result: RunResult) {
    const p = pending;
    if (!p) return;
    if (result.runId === p.runId) settle(p, p.map(result));
  }

  const send = (msg: HostToShell) => {
    shell?.port?.postMessage(msg);
  };

  const abort = () => {
    const p = pending;
    if (!p) return;
    send({ v: PROTOCOL_VERSION, type: 'abort', runId: p.runId });
    settle(p, hostResult(p.runId, 'aborted', { durationMs: performance.now() - p.started }));
  };

  /** Sends a request to the shell and resolves with its (mapped) result or the watchdog's. */
  const execute = async (
    request: RunRequest,
    map: (r: RunResult) => RunResult,
    viewport: RunPlan['viewport'],
  ): Promise<RunResult> => {
    const { runId } = request;
    const token = ++runSeq;
    abort();
    await ensureShell();
    // A newer run() started while this one waited for the shell.
    if (token !== runSeq) return hostResult(runId, 'aborted');
    if (shell && placement === 'hidden') style(shell.frame, viewport ?? DEFAULT_VIEWPORT);

    return new Promise<RunResult>((resolve) => {
      const started = performance.now();
      const p: PendingRun = {
        runId,
        resolve,
        started,
        lastHeartbeat: started,
        maxDurationMs: request.limits.maxDurationMs,
        map,
        watchdog: setInterval(() => {
          const t = performance.now();
          const silent = t - p.lastHeartbeat > HEARTBEAT_TIMEOUT_MS;
          const over = t - p.started > p.maxDurationMs + OVERTIME_GRACE_MS;
          if (!silent && !over) return;
          // The shell is stuck (e.g. an uninstrumented loop sharing its thread). Throw it away;
          // the next shell gets a new site, so it never lands in the stuck process.
          discardShell();
          settle(p, hostResult(runId, silent ? 'crashed' : 'timeout', { durationMs: t - started }));
          if (!disposed) void ensureShell().catch(() => undefined);
        }, WATCHDOG_TICK_MS),
      };
      pending = p;
      send(request);
    });
  };

  const run = async (input: RunPlanInput): Promise<RunResult> => {
    const plan = runnablePlanSchema.parse(input);
    const runId = crypto.randomUUID();
    // Connect the shell while the prepare step loads (both are needed on a page's first run).
    if (!disposed) ensureShell().catch(() => undefined);
    const { mapErrors, nativeSyntaxErrors, prepareRun } = await loadPrepare();
    const prepared = prepareRun(plan);
    const limits = resolveLimits(plan.purpose, plan.limits);
    const base = {
      v: PROTOCOL_VERSION,
      type: 'run',
      runId,
      purpose: plan.purpose,
      limits,
      ...(plan.viewport ? { viewport: plan.viewport } : {}),
      stdin: plan.stdin ?? [],
    } as const;

    if (!prepared.ok) {
      const check = prepared.syntaxCheck;
      if (!check) return hostResult(runId, 'error', { errors: prepared.errors });
      // Engine syntax check (D-030): nothing runs, the browser only parses the broken scripts.
      const request = runRequestSchema.parse({
        ...base,
        mode: 'dom',
        steps: [],
        expose: null,
        syntaxOnly: true,
        ...check.code,
      });
      const r = await execute(request, (x) => x, plan.viewport);
      if (r.status === 'aborted') return r;
      return hostResult(runId, 'error', {
        durationMs: r.durationMs,
        errors: nativeSyntaxErrors(prepared.errors, check, r),
      });
    }

    const request: RunRequest = runRequestSchema.parse({
      ...base,
      mode: plan.mode,
      steps: plan.checks.steps,
      ...prepared.prepared.code,
    });
    const fallbackFile = plan.entry;
    const sources = prepared.prepared.sources;
    return execute(
      request,
      (r) => ({ ...r, errors: mapErrors(r.errors, sources, fallbackFile) }),
      plan.viewport,
    );
  };

  return {
    run,
    abort,
    ready: () => {
      void preloadRunner();
      return ensureShell();
    },
    dispose() {
      abort();
      disposed = true;
      if (onHello) window.removeEventListener('message', onHello);
      discardShell();
    },
    get stats() {
      return { shellsCreated, usingFallback };
    },
  };
}
