import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { Page, Request } from '@playwright/test';
import { build } from 'esbuild';
import type * as HostModule from '../../packages/runner/src/host/host.ts';
import type { RunnerHost, RunnerHostOptions } from '../../packages/runner/src/host/host.ts';
import type { RunEvent } from '../../packages/runner/src/protocol/messages.ts';
import type {
  ObservationStep,
  RunPlan,
  RunResult,
} from '../../packages/shared/src/run-protocol.ts';

/**
 * Drives the real runner through the production build.
 *
 * The app does not use the runner on any screen yet, and a hidden test route would ship in
 * production. Instead the host module is bundled here and evaluated in the app page through the
 * DevTools protocol (`page.evaluate`, which the page CSP does not apply to). Everything else is
 * real: the app document with its CSP, the server's `/sandbox/runner.html` with the shell CSP on
 * per-shell `*.localhost` sites, the shell, the harness and the Worker/nested document.
 */

const HOST_ENTRY = fileURLToPath(
  new URL('../../packages/runner/src/host/host.ts', import.meta.url),
);
let hostBundle: Promise<string> | undefined;

function hostScript(): Promise<string> {
  hostBundle ??= build({
    entryPoints: [HOST_ENTRY],
    bundle: true,
    format: 'iife',
    globalName: '__runnerHostModule',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
    // Code evaluated through DevTools is exempt from the page CSP, so zod's `new Function` probe
    // succeeds there and its compiled validators later fail under the app CSP. Pages that load the
    // host normally detect the CSP correctly; here zod is told up front.
    banner: { js: 'globalThis.__zod_globalConfig={jitless:true};' },
    // page.evaluate runs the string inside a function, so `var` would stay local.
    footer: { js: 'globalThis.__runnerHostModule = __runnerHostModule;' },
  }).then((r) => r.outputFiles[0]?.text ?? '');
  return hostBundle;
}

type HostOptions = Omit<RunnerHostOptions, 'container' | 'onEvent'>;

interface TestWindow {
  __runnerHostModule: typeof HostModule;
  __host: RunnerHost;
  __events: unknown[];
  __monitor: { maxGap: number; last: number };
}

/** Opens the app and creates a RunnerHost in it. Resolves once the shell is connected. */
export async function openRunner(page: Page, options: HostOptions = {}) {
  await page.goto('/');
  await page.evaluate(await hostScript());
  await page.evaluate(async (opts) => {
    const w = window as unknown as TestWindow;
    w.__events = [];
    w.__host = w.__runnerHostModule.createRunnerHost({
      ...opts,
      onEvent: (e) => w.__events.push(e),
    });
    await w.__host.ready();
  }, options);
}

export async function run(page: Page, plan: RunPlan): Promise<RunResult> {
  // Explicit `unknown` type arguments: inferring Playwright's serializable types for the
  // recursive protocol types is too deep for the compiler.
  const result = await page.evaluate<unknown, unknown>(
    (p) => (window as unknown as TestWindow).__host.run(p as RunPlan),
    plan,
  );
  return result as RunResult;
}

export function hostStats(page: Page) {
  return page.evaluate(() => (window as unknown as TestWindow).__host.stats);
}

/** Records the longest gap between animation frames of the app (main-thread responsiveness). */
export async function startFrameMonitor(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as TestWindow;
    w.__monitor = { maxGap: 0, last: performance.now() };
    const tick = (t: number) => {
      w.__monitor.maxGap = Math.max(w.__monitor.maxGap, t - w.__monitor.last);
      w.__monitor.last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function maxFrameGap(page: Page) {
  return page.evaluate(() => (window as unknown as TestWindow).__monitor.maxGap);
}

/** Plan options for tests: shared `RunPlan` fields plus the bundle's steps and expose list. */
export type PlanExtra = Partial<Omit<RunPlan, 'checks'>> & {
  steps?: ObservationStep[];
  expose?: string[];
};

function plan(base: Pick<RunPlan, 'mode' | 'files' | 'entry'>, extra: PlanExtra): RunPlan {
  const { steps = [], expose = [], ...rest } = extra;
  return {
    v: 1,
    purpose: 'interactive',
    timers: 'real',
    ...base,
    ...rest,
    checks: { v: 1, expose, steps },
  };
}

/** A one-file js-console plan in the shape exercise-kit's `buildRunPlan` produces. */
export const js = (content: string, extra: PlanExtra = {}): RunPlan =>
  plan(
    { mode: 'js-console', files: [{ path: 'main.js', language: 'js', content }], entry: 'main.js' },
    extra,
  );

/** A single-document DOM plan. */
export const html = (content: string, extra: PlanExtra = {}): RunPlan =>
  plan(
    {
      mode: 'dom',
      files: [{ path: 'index.html', language: 'html', content }],
      entry: 'index.html',
    },
    extra,
  );

/** Requests the shell CSP blocked in the last run (from the `blocked` event). */
export function blockedRequests(page: Page) {
  return page.evaluate(() => {
    const events = (window as unknown as TestWindow).__events as RunEvent[];
    return events.flatMap((e) => (e.kind === 'blocked' ? e.requests : []));
  });
}

/** Text of every console entry with string/number arguments, for quick assertions. */
export function consoleText(result: RunResult): string[] {
  return result.console.map((e) =>
    e.args
      .map((a) => {
        if (a.t === 'string') return a.v;
        if (a.t === 'number' || a.t === 'boolean' || a.t === 'bigint') return String(a.v);
        return `<${a.t}>`;
      })
      .join(' '),
  );
}

/**
 * A stand-in for "some other local service": every request that reaches it is a sandbox leak.
 * Attack code targets it and the app server; requests to the app server are caught by
 * {@link watchRequests}.
 */
export async function startProbe(): Promise<{
  origin: string;
  hits: () => string[];
  reset: () => void;
  close: () => Promise<void>;
}> {
  const hits: string[] = [];
  const record = (req: IncomingMessage) => hits.push(`${req.method ?? ''} ${req.url ?? ''}`);
  const server: Server = createServer((req, res) => {
    record(req);
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    res.end('probe');
  });
  server.on('upgrade', (req, socket) => {
    record(req);
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    hits: () => [...hits],
    reset: () => {
      hits.length = 0;
    },
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

/**
 * Requests of the page (all frames and workers, including out-of-process shells) that got a
 * response. Chromium reports some CSP-blocked requests (e.g. XHR in a Worker) as started and then
 * failed; only a response means something reached a server.
 */
export function watchRequests(page: Page) {
  const seen: string[] = [];
  const onRequest = (r: Request) => {
    if (/^(https?|wss?):/.test(r.url())) seen.push(`${r.method()} ${r.url()}`);
  };
  page.context().on('requestfinished', onRequest);
  return {
    /** Requests other than loading the runner shell itself. */
    unexpected: () =>
      seen.filter((s) => !/^GET http:\/\/[^/]+\/sandbox\/runner\.html\?v=\d+$/.test(s)),
    reset: () => {
      seen.length = 0;
    },
    stop: () => {
      page.context().off('requestfinished', onRequest);
    },
  };
}
