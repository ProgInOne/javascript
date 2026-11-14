// RunnerHost (app side). Creates the runner shell iframe, performs the handshake,
// sends RunRequests over a MessagePort, runs the watchdog, and measures main-thread responsiveness.
import { instrumentJs, exposeScript, prepareHtml } from '/prepare.js';

const SHELL_ALLOW =
  "clipboard-read 'none'; clipboard-write 'none'; camera 'none'; microphone 'none'; geolocation 'none'; " +
  "fullscreen 'none'; display-capture 'none'; usb 'none'; serial 'none'; bluetooth 'none'; payment 'none'; screen-wake-lock 'none'";

const DEFAULT_LIMITS = {
  maxDurationMs: 3000,
  quietMs: 50,
  loopBudgetMs: 1000,
  maxConsoleEntries: 1000,
  maxEntryBytes: 10000,
  maxObservationBytes: 64000,
  checkTimeoutMs: 3000,
  maxOutputBytes: 1000000,
};

const state = {
  shell: null,
  port: null,
  ready: null,
  readyResolve: null,
  shellCaps: null,
  rejectedWindowMessages: [],
  shellsCreated: 0,
  pending: null,
  placement: 'visible',
};

// --- responsiveness monitor (app main thread) ---
const mon = { lastRaf: performance.now(), maxRafGap: 0, lastTick: performance.now(), maxTimerLag: 0 };
function rafLoop(t) {
  const gap = t - mon.lastRaf;
  if (gap > mon.maxRafGap) mon.maxRafGap = gap;
  mon.lastRaf = t;
  requestAnimationFrame(rafLoop);
}
requestAnimationFrame(rafLoop);
setInterval(() => {
  const n = performance.now();
  const lag = n - mon.lastTick - 20;
  if (lag > mon.maxTimerLag) mon.maxTimerLag = lag;
  mon.lastTick = n;
}, 20);
function resetMonitor() {
  mon.maxRafGap = 0;
  mon.maxTimerLag = 0;
  mon.lastRaf = performance.now();
  mon.lastTick = performance.now();
}

let clicks = 0;
document.getElementById('btn').addEventListener('click', () => {
  clicks++;
  document.getElementById('clicks').textContent = String(clicks);
});

// App-origin state that sandboxed code must not be able to read or change.
localStorage.setItem('app-marker', 'app-value');
document.cookie = 'appcookie=app-secret; path=/';

window.addEventListener('message', (e) => {
  const d = e.data;
  if (state.shell && !state.port && e.source === state.shell.contentWindow && e.origin === 'null' && d && d.type === 'shell-hello' && d.v === 1) {
    const ch = new MessageChannel();
    state.port = ch.port1;
    state.port.onmessage = onShellMessage;
    state.shell.contentWindow.postMessage({ type: 'connect', v: 1 }, '*', [ch.port2]);
    return;
  }
  state.rejectedWindowMessages.push({
    origin: e.origin,
    fromShell: !!state.shell && e.source === state.shell.contentWindow,
    type: d && d.type,
  });
});

function createShell() {
  if (state.shell) state.shell.remove();
  state.port = null;
  state.ready = new Promise((r) => (state.readyResolve = r));
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts allow-forms');
  f.setAttribute('allow', SHELL_ALLOW);
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.setAttribute('title', '코드 실행 결과');
  const shellOrigin = new URLSearchParams(location.search).get('shellOrigin') || '';
  f.src = shellOrigin.replace('{n}', String(state.shellsCreated + 1)) + '/sandbox/runner.html?v=1';
  state.shell = f;
  state.shellsCreated++;
  const slot = document.getElementById('shell-slot');
  slot.className = { offscreen: 'offscreen', 'hidden-in-viewport': 'hiddenvp' }[state.placement] || '';
  slot.appendChild(f);
  return state.ready;
}

function onShellMessage(e) {
  const m = e.data;
  if (!m || m.v !== 1) return;
  if (m.type === 'ready') {
    state.shellCaps = m.caps;
    state.readyResolve();
    return;
  }
  const p = state.pending;
  if (!p || m.runId !== p.runId) return; // stale message from an older run
  if (m.type === 'heartbeat') {
    p.lastHeartbeat = performance.now();
    p.heartbeats++;
  } else if (m.type === 'event') {
    p.events++;
  } else if (m.type === 'result') {
    finish(p, m);
  } else if (m.type === 'stats') {
    /* handled by stats() */
  }
}

function finish(p, result) {
  if (p.finished) return;
  p.finished = true;
  clearInterval(p.watchdog);
  state.pending = null;
  p.resolve({
    ...result,
    host: {
      wallMs: Math.round(performance.now() - p.started),
      maxRafGapMs: Math.round(mon.maxRafGap),
      maxTimerLagMs: Math.round(mon.maxTimerLag),
      heartbeats: p.heartbeats,
      events: p.events,
      shellsCreated: state.shellsCreated,
      prepare: p.prepareInfo,
    },
  });
}

function validateRequest(req) {
  if (req.files.length > 20) return 'too many files';
  for (const f of req.files) if (f.content.length > 200000) return `file too large: ${f.path}`;
  return null;
}

async function run(opts) {
  if (!state.port) await (state.ready || createShell());
  await state.ready;
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  const mode = opts.mode || 'js-console';
  const instrument = opts.instrument !== false;
  let files = opts.files || [{ path: 'main.js', language: 'js', content: opts.code }];
  const rawSizeError = validateRequest({ files });
  if (rawSizeError) return { status: 'rejected', reason: rawSizeError };

  let expose = null;
  const prepareInfo = { loops: 0, syntaxErrors: [] };
  if (mode === 'js-console') {
    files = files.map((f) => {
      if (!instrument) return f;
      const r = instrumentJs(f.content);
      prepareInfo.loops += r.loops.length;
      if (r.syntaxError) prepareInfo.syntaxErrors.push({ file: f.path, ...r.syntaxError });
      return { ...f, content: r.code };
    });
    if (prepareInfo.syntaxErrors.length) {
      return { status: 'error', errors: prepareInfo.syntaxErrors.map((s) => ({ phase: 'syntax', ...s })), host: { prepare: prepareInfo } };
    }
    expose = exposeScript(opts.expose || []);
  } else {
    const r = prepareHtml(files[0].content, { instrument, expose: opts.expose || [], scriptDelivery: opts.scriptDelivery || 'blob' });
    prepareInfo.scripts = r.scripts;
    prepareInfo.loops = r.loops.length;
    prepareInfo.syntaxErrors = r.syntaxErrors;
    files = [{ path: 'index.html', language: 'html', content: r.html }];
  }

  const runId = crypto.randomUUID();
  resetMonitor();
  return new Promise((resolve) => {
    const p = {
      runId,
      resolve,
      started: performance.now(),
      lastHeartbeat: performance.now(),
      heartbeats: 0,
      events: 0,
      finished: false,
      prepareInfo,
    };
    state.pending = p;
    // Watchdog: maxDurationMs + 1000 total, or 1500ms without heartbeat.
    p.watchdog = setInterval(() => {
      const t = performance.now();
      const silent = t - p.lastHeartbeat > 1500;
      const over = t - p.started > limits.maxDurationMs + 1000;
      if (silent || over) {
        createShell(); // discard the stuck shell and build a new one
        finish(p, { type: 'result', runId, status: silent ? 'crashed' : 'timeout', watchdog: silent ? 'no-heartbeat' : 'over-time' });
      }
    }, 100);
    state.port.postMessage({
      v: 1,
      type: 'run',
      runId,
      mode,
      purpose: opts.purpose || 'interactive',
      files,
      entry: files[0].path,
      limits,
      viewport: opts.viewport,
      nestedSandbox: opts.nestedSandbox,
      allowLearnerWorkers: !!opts.allowLearnerWorkers,
      scripts: prepareInfo.scripts || [],
      checks: opts.checks || [],
      expose,
    });
  });
}

async function shellStats() {
  await state.ready;
  return new Promise((resolve) => {
    const prev = state.port.onmessage;
    state.port.onmessage = (e) => {
      if (e.data && e.data.type === 'stats') {
        state.port.onmessage = prev;
        resolve(e.data);
      } else prev(e);
    };
    state.port.postMessage({ v: 1, type: 'stats' });
  });
}

window.pg = {
  run,
  createShell,
  shellStats,
  setPlacement(p) {
    state.placement = p;
    return createShell();
  },
  get state() {
    return {
      rejectedWindowMessages: state.rejectedWindowMessages.slice(),
      shellsCreated: state.shellsCreated,
      shellCaps: state.shellCaps,
      hasPort: !!state.port,
      appLocalStorage: localStorage.getItem('app-marker'),
      appCookie: document.cookie,
      location: location.href,
      clicks,
    };
  },
  resetMonitor,
  monitor: () => ({ maxRafGapMs: Math.round(mon.maxRafGap), maxTimerLagMs: Math.round(mon.maxTimerLag) }),
};
createShell().then(() => {
  document.documentElement.dataset.ready = '1';
});
