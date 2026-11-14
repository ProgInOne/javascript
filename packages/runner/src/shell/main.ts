/**
 * Runner shell controller. Runs in `/sandbox/runner.html`: a sandboxed (opaque origin) frame with
 * the shell CSP (docs/design/code-execution-sandbox.md#러너-셸-iframe).
 *
 * - Talks to the host only over the transferred MessagePort; the only window messages it reacts
 *   to are `connect` from its parent and `pg-harness-hello` from its current learner document.
 * - Validates everything it receives with the protocol schemas.
 * - Runs `js-console` in a `blob:` Worker and `dom`/`preview` in a nested sandboxed `srcdoc`
 *   frame, enforces `maxDurationMs`, and sends heartbeats while a run is active.
 */
import {
  connectSchema,
  HARNESS_CONFIG_GLOBAL,
  harnessToShellSchema,
  type HarnessConfig,
  type HarnessToShell,
  hostToShellSchema,
  PROTOCOL_VERSION,
  type BlockedRequest,
  type RunRequest,
  type ShellControl,
  type ShellToHarness,
} from '../protocol/messages.ts';
import type { ConsoleEntry, RunResult } from '@proginone/shared';

declare const __HARNESS_SOURCE__: string;

const HEARTBEAT_MS = 250;
/** Grace period after maxDurationMs before the shell gives up on the harness. */
const HARD_STOP_GRACE_MS = 300;
const LEARNER_CSP = `<meta http-equiv="Content-Security-Policy" content="worker-src 'none'">`;

interface ActiveRun {
  request: RunRequest;
  started: number;
  channel: MessageChannel;
  harnessPortGiven: boolean;
  blobUrls: string[];
  console: ConsoleEntry[];
  heartbeat: ReturnType<typeof setInterval>;
  hardStop: ReturnType<typeof setTimeout>;
  worker?: Worker;
  frame?: HTMLIFrameElement;
  done: boolean;
}

let hostPort: MessagePort | null = null;
let current: ActiveRun | null = null;
/** A finished preview keeps its document on screen until the next run. */
let previewFrame: HTMLIFrameElement | null = null;

const post = (msg: ShellControl | RunResult) => {
  hostPort?.postMessage(msg);
};

window.addEventListener('message', (e: MessageEvent) => {
  const port = e.ports[0];
  if (!hostPort && e.source === parent && port && connectSchema.safeParse(e.data).success) {
    hostPort = port;
    hostPort.onmessage = onHostMessage;
    post({ v: PROTOCOL_VERSION, type: 'ready' });
    return;
  }
  const run = current;
  const learner = run?.frame?.contentWindow;
  if (
    run &&
    learner &&
    !run.harnessPortGiven &&
    e.source === learner &&
    (e.data as { type?: unknown } | null)?.type === 'pg-harness-hello'
  ) {
    run.harnessPortGiven = true;
    learner.postMessage({ type: 'pg-port' }, '*', [run.channel.port2]);
  }
  // Everything else, including learner code posting fake results to its parent, is ignored.
});

parent.postMessage({ v: PROTOCOL_VERSION, type: 'shell-hello' }, '*');

function onHostMessage(e: MessageEvent) {
  const parsed = hostToShellSchema.safeParse(e.data);
  if (!parsed.success) return;
  const msg = parsed.data;
  if (msg.type === 'run') startRun(msg);
  else if (current?.request.runId === msg.runId) finish(current, { status: 'aborted' });
}

function blobUrl(run: ActiveRun, text: string): string {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  run.blobUrls.push(url);
  return url;
}

/** JSON that is safe inside an inline <script>. */
const scriptJson = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

function startRun(request: RunRequest) {
  if (current) finish(current, { status: 'aborted' });
  previewFrame?.remove();
  previewFrame = null;

  const channel = new MessageChannel();
  const started = performance.now();
  const run: ActiveRun = {
    request,
    started,
    channel,
    harnessPortGiven: false,
    blobUrls: [],
    console: [],
    heartbeat: setInterval(() => {
      post({
        v: PROTOCOL_VERSION,
        type: 'heartbeat',
        runId: request.runId,
        at: performance.now() - started,
      });
    }, HEARTBEAT_MS),
    hardStop: setTimeout(() => {
      finish(run, { status: 'timeout' });
    }, request.limits.maxDurationMs + HARD_STOP_GRACE_MS),
    done: false,
  };
  current = run;
  channel.port1.onmessage = (ev: MessageEvent) => {
    onHarnessMessage(run, ev.data);
  };
  post({ v: PROTOCOL_VERSION, type: 'event', runId: request.runId, kind: 'started' });

  const config: HarnessConfig = {
    limits: request.limits,
    steps: request.steps,
    stdin: request.stdin,
    scripts: request.mode === 'js-console' ? [] : request.scripts,
    sourceIds: {},
  };

  if (request.mode === 'js-console') {
    // One blob per learner file: stack frames name the blob, so errors map to the file and
    // file-relative lines (PoC B5).
    const urls = request.scripts.map((s) => {
      const url = blobUrl(run, s.code);
      config.sourceIds[url] = `src:${s.id}`;
      return url;
    });
    const expose = request.expose === null ? null : blobUrl(run, request.expose);
    const prelude = `self.${HARNESS_CONFIG_GLOBAL}=${JSON.stringify(config)};${__HARNESS_SOURCE__}`;
    try {
      run.worker = new Worker(blobUrl(run, prelude));
    } catch {
      finish(run, { status: 'crashed' });
      return;
    }
    run.worker.onerror = (ev) => {
      // Errors inside learner scripts are reported by the harness; this only sees uncaught
      // errors that escaped it (e.g. the Worker running out of memory).
      ev.preventDefault();
    };
    const start: ShellToHarness = { type: 'start', scripts: urls, expose };
    run.worker.postMessage(start, [channel.port2]);
    run.harnessPortGiven = true;
    return;
  }

  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-forms');
  frame.setAttribute('title', '학습자 문서');
  const vp = request.viewport;
  frame.style.width = vp ? `${vp.width}px` : '100%';
  frame.style.height = vp ? `${vp.height}px` : '100%';
  const harnessTag = `${LEARNER_CSP}<script>self.${HARNESS_CONFIG_GLOBAL}=${scriptJson(config)};${__HARNESS_SOURCE__}</script>`;
  const source = request.document ?? '';
  const at = Math.min(request.harnessAt ?? 0, source.length);
  frame.srcdoc = source.slice(0, at) + harnessTag + source.slice(at);
  run.frame = frame;
  document.body.appendChild(frame);
}

function onHarnessMessage(run: ActiveRun, data: unknown) {
  if (current !== run || run.done) return;
  const parsed = harnessToShellSchema.safeParse(data);
  if (!parsed.success) return;
  const msg: HarnessToShell = parsed.data;
  switch (msg.type) {
    case 'console': {
      const room = run.request.limits.maxConsoleEntries - run.console.length;
      const entries = msg.entries.slice(0, Math.max(0, room));
      run.console.push(...entries);
      if (entries.length > 0) {
        post({
          v: PROTOCOL_VERSION,
          type: 'event',
          runId: run.request.runId,
          kind: 'console',
          entries,
        });
      }
      break;
    }
    case 'settled':
      post({ v: PROTOCOL_VERSION, type: 'event', runId: run.request.runId, kind: 'settled' });
      break;
    case 'viewport':
      if (run.frame) {
        run.frame.style.width = `${msg.width}px`;
        run.frame.style.height = `${msg.height}px`;
      }
      run.channel.port1.postMessage({
        type: 'viewport-done',
        reqId: msg.reqId,
      } satisfies ShellToHarness);
      break;
    case 'done':
      finish(run, {
        status: msg.status,
        errors: msg.errors,
        observations: msg.observations,
        droppedConsoleEntries: msg.droppedConsoleEntries,
        pendingAtEnd: msg.pendingAtEnd,
        blocked: msg.blocked,
      });
      break;
  }
}

function finish(
  run: ActiveRun,
  partial: Partial<RunResult> & Pick<RunResult, 'status'> & { blocked?: BlockedRequest[] },
) {
  if (run.done) return;
  run.done = true;
  clearInterval(run.heartbeat);
  clearTimeout(run.hardStop);
  run.worker?.terminate();
  if (run.frame) {
    if (run.request.mode === 'preview' && partial.status !== 'timeout') previewFrame = run.frame;
    else run.frame.remove();
  }
  for (const url of run.blobUrls) URL.revokeObjectURL(url);
  run.channel.port1.close();
  if (current === run) current = null;
  const dropped = partial.droppedConsoleEntries ?? 0;
  if (partial.blocked && partial.blocked.length > 0) {
    post({
      v: PROTOCOL_VERSION,
      type: 'event',
      runId: run.request.runId,
      kind: 'blocked',
      requests: partial.blocked,
    });
  }
  post({
    v: PROTOCOL_VERSION,
    type: 'result',
    runId: run.request.runId,
    status: partial.status,
    durationMs: Math.round(performance.now() - run.started),
    console: run.console,
    consoleTruncated: dropped > 0,
    droppedConsoleEntries: dropped,
    errors: partial.errors ?? [],
    observations: partial.observations ?? [],
    pendingAtEnd: partial.pendingAtEnd ?? { timers: 0, intervals: 0 },
  });
}
