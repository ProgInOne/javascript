// M1-B sandbox PoC server (throwaway). node:http only.
// - App page (strict CSP, frame-src 'self')
// - /sandbox/runner.html with its own strict CSP header (D-018)
// - /api/secret protected by token header + Origin check
// - Every request is logged; tests assert that sandboxed code produced 0 requests.
// - A second "external" server on another port stands in for an external host.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as acorn from 'acorn';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, p), 'utf8');

export const APP_TOKEN = 'poc-session-token-7f3a';

export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' http://localhost:* http://*.localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// Copied verbatim from docs/design/code-execution-sandbox.md (셸의 CSP).
export const SHELL_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob:",
  'worker-src blob:',
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "manifest-src 'none'",
  "object-src 'none'",
].join('; ');

// The harness is injected as ONE line so that it does not shift learner line numbers.
// harness.js must therefore not contain line comments or rely on ASI.
function buildHarnessSource() {
  const raw = read('src/harness.js');
  const oneLine = raw.replace(/\r?\n\s*/g, ' ');
  acorn.parse(oneLine, { ecmaVersion: 'latest' }); // fail fast if collapsing broke it
  return oneLine;
}

function buildRunnerHtml() {
  const harness = buildHarnessSource();
  const shell = read('src/shell.js');
  const json = JSON.stringify(harness).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>runner</title>
<style>html,body{margin:0;padding:0;background:#fff}iframe{border:0;display:block}</style></head>
<body><script>const HARNESS_SRC = ${json};
${shell}</script></body></html>`;
}

function makeLogger(name) {
  const log = [];
  return {
    log,
    push(req, extra = {}) {
      log.push({
        server: name,
        t: Date.now(),
        method: req.method,
        url: req.url,
        origin: req.headers.origin ?? null,
        referer: req.headers.referer ?? null,
        secFetchSite: req.headers['sec-fetch-site'] ?? null,
        secFetchDest: req.headers['sec-fetch-dest'] ?? null,
        ...extra,
      });
    },
  };
}

export function startServers({ port = 4311, externalPort = 4312 } = {}) {
  const appLog = makeLogger('app');
  const extLog = makeLogger('external');
  const runnerHtml = buildRunnerHtml();
  const acornSrc = readFileSync(path.join(here, 'node_modules/acorn/dist/acorn.mjs'), 'utf8');

  const app = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    // Control endpoints used by Playwright's request context only (not logged).
    if (url.pathname === '/__log') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify([...appLog.log, ...extLog.log]));
    }
    if (url.pathname === '/__log/reset') {
      appLog.log.length = 0;
      extLog.log.length = 0;
      res.writeHead(204);
      return res.end();
    }
    appLog.push(req);

    const send = (status, type, body, headers = {}) => {
      res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff', ...headers });
      res.end(body);
    };

    switch (url.pathname) {
      case '/':
      case '/app.html':
        return send(200, 'text/html; charset=utf-8', read('public/app.html'), {
          'content-security-policy': APP_CSP,
        });
      case '/host.js':
        return send(200, 'text/javascript; charset=utf-8', read('public/host.js'));
      case '/prepare.js':
        return send(200, 'text/javascript; charset=utf-8', read('public/prepare.js'));
      case '/vendor/acorn.mjs':
        return send(200, 'text/javascript; charset=utf-8', acornSrc);
      case '/sandbox/runner.html':
        return send(200, 'text/html; charset=utf-8', runnerHtml, {
          'content-security-policy': SHELL_CSP,
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
        });
      case '/api/secret': {
        // Same rules as the real server: token header required, Origin "null" rejected.
        if (req.headers.origin === 'null') return send(403, 'application/json', '{"error":"origin"}');
        if (req.headers['x-proginone-token'] !== APP_TOKEN)
          return send(401, 'application/json', '{"error":"token"}');
        return send(200, 'application/json', '{"secret":"learner-data"}');
      }
      default:
        // /probe/* and anything else: 200 with a tiny body so that a leak would "succeed".
        return send(200, 'text/plain', 'probe-ok', { 'access-control-allow-origin': '*' });
    }
  });
  app.on('upgrade', (req, socket) => {
    appLog.push(req, { upgrade: true });
    socket.destroy();
  });

  const external = http.createServer((req, res) => {
    extLog.push(req);
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    res.end('external-ok');
  });
  external.on('upgrade', (req, socket) => {
    extLog.push(req, { upgrade: true });
    socket.destroy();
  });

  return Promise.all([
    new Promise((r) => app.listen(port, '127.0.0.1', r)),
    new Promise((r) => external.listen(externalPort, '127.0.0.1', r)),
  ]).then(() => ({
    port,
    externalPort,
    close: () => Promise.all([new Promise((r) => app.close(r)), new Promise((r) => external.close(r))]),
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4311);
  const s = await startServers({ port, externalPort: port + 1 });
  console.log(`PoC app: http://127.0.0.1:${s.port}/  (external stand-in: ${s.externalPort})`);
}
