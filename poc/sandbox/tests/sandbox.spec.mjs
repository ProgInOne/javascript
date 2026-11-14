// M1-B sandbox PoC tests. IDs follow docs/design/code-execution-sandbox.md (S1–S44) and the
// open questions (Q1–Q9). Each test attaches an "evidence" annotation used by tools/report.mjs.
import { test, expect } from '@playwright/test';

const APP = 'http://127.0.0.1:4331';
const EXT = 'http://127.0.0.1:4332';
const TOKEN = 'poc-session-token-7f3a';
const ALLOWED = new Set(['/', '/host.js', '/prepare.js', '/vendor/acorn.mjs', '/sandbox/runner.html?v=1', '/favicon.ico']);

const evidence = (obj) => test.info().annotations.push({ type: 'evidence', description: JSON.stringify(obj) });

// PG_SHELL_ORIGIN=http://s{n}.localhost:4331 runs every test against a per-shell-subdomain shell.
const SHELL_Q = process.env.PG_SHELL_ORIGIN ? `?shellOrigin=${encodeURIComponent(process.env.PG_SHELL_ORIGIN)}` : '';
async function open(page, request) {
  await request.get(`${APP}/__log/reset`);
  await page.goto(`${APP}/${SHELL_Q}`);
  await page.waitForSelector('html[data-ready="1"]', { timeout: 10_000 });
}
const run = (page, opts) => page.evaluate((o) => window.pg.run(o), opts);
async function unexpectedRequests(request) {
  const log = await (await request.get(`${APP}/__log`)).json();
  return log.filter((r) => r.server === 'external' || !(ALLOWED.has(r.url) || r.url.startsWith('/?shellOrigin=')));
}
const html = (body, head = '') => `<!doctype html>\n<html><head>${head}</head><body>\n${body}\n</body></html>`;
const dom = (body, head = '', extra = {}) => ({ mode: 'dom', files: [{ path: 'index.html', language: 'html', content: html(body, head) }], ...extra });
const fmt = (a) => (a.t === 'string' ? a.v : a.t === 'number' || a.t === 'boolean' ? String(a.v) : a.t === 'undefined' || a.t === 'null' ? a.t : JSON.stringify(a));
const logs = (r) => (r.console || []).map((e) => e.args.map(fmt).join(' '));
const settleMs = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- basics
test.describe('basics', () => {
  test('B1 js-console: console capture and serialization', async ({ page, request }) => {
    await open(page, request);
    const r = await run(page, {
      code: [
        'const o = { a: 1 }; o.self = o;',
        'console.log(NaN, -0, 10n, Symbol("s"), undefined, null);',
        'console.log(new Map([["k", 1]]), new Set([1]), o);',
        'console.log(() => 1, class K {}, async function af() {}, Math.max);',
        'console.log(new Date(0), /a+/g, new Error("boom"), [1, , 3]);',
        'console.log({ get g() { throw new Error("getter called"); } });',
      ].join('\n'),
    });
    evidence({ status: r.status, console: r.console.map((e) => e.args) });
    expect(r.status).toBe('completed');
    const flat = JSON.stringify(r.console);
    expect(flat).toContain('"v":"NaN"');
    expect(flat).toContain('"v":"-0"');
    expect(flat).toContain('"t":"circular"');
    expect(flat).toContain('"kind":"arrow"');
    expect(flat).toContain('"kind":"class"');
    expect(flat).toContain('"t":"getter"');
    expect(flat).toContain('"t":"hole"');
  });

  test('B2 callFunction / readGlobal via expose (let/const, TDZ, missing)', async ({ page, request }) => {
    await open(page, request);
    const r = await run(page, {
      code: 'const add = (a, b) => a + b;\nlet counter = 3;\nfunction mutate(arr) { arr.push(9); return arr.length; }',
      expose: ['add', 'counter', 'mutate', 'nope'],
      checks: [
        { kind: 'callFunction', name: 'add', args: [2, 3] },
        { kind: 'readGlobal', name: 'counter' },
        { kind: 'callFunction', name: 'mutate', args: [[1]], observeArgsAfter: true },
        { kind: 'callFunction', name: 'nope', args: [] },
      ],
    });
    evidence({ observations: r.observations });
    expect(r.observations[0].value.returned).toEqual({ t: 'number', v: 5 });
    expect(r.observations[1].value.value).toEqual({ t: 'number', v: 3 });
    expect(r.observations[2].value.argsAfter.items[0].items.length).toBe(2);
    expect(r.observations[3].value.missing).toBe(true);
  });

  test('B3 dom: computedStyle, boxRect and media query across viewports', async ({ page, request }) => {
    await open(page, request);
    const css = '<style>.box{width:100px;padding:10px;border:2px solid rgb(255,0,0);margin:5px;box-sizing:content-box;color:#0a0}' +
      '.row{display:flex;gap:8px}@media (max-width:500px){.row{flex-direction:column}}</style>';
    const r = await run(page, {
      ...dom('<div class="box" id="b">x</div><div class="row"><span id="a">A</span><span id="c">C</span></div>', css),
      viewport: { width: 1280, height: 800 },
      checks: [
        { kind: 'computedStyle', selector: '#b', props: ['width', 'padding-left', 'border-top-width', 'color'] },
        { kind: 'boxRect', selectors: ['#b', '#a', '#c'] },
        { kind: 'setViewport', width: 375, height: 700 },
        { kind: 'boxRect', selectors: ['#a', '#c'] },
        { kind: 'computedStyle', selector: '.row', props: ['flex-direction'] },
      ],
    });
    evidence({ status: r.status, observations: r.observations });
    expect(r.status).toBe('completed');
    const [cs, rect1, vp, rect2, cs2] = r.observations.map((o) => o.value);
    expect(cs[0]).toEqual({ width: '100px', 'padding-left': '10px', 'border-top-width': '2px', color: 'rgb(0, 170, 0)' });
    expect(rect1['#b'][0].width).toBe(124);
    expect(rect1['#c'][0].y).toBe(rect1['#a'][0].y); // row
    expect(vp.width).toBe(375);
    expect(rect2['#c'][0].y).toBeGreaterThan(rect2['#a'][0].y); // column under media query
    expect(cs2[0]['flex-direction']).toBe('column');
  });

  test('B4 dom: click handler and submit event (Q3: allow-forms + form-action none)', async ({ page, request }) => {
    await open(page, request);
    const r = await run(page, {
      ...dom(
        `<button id="b">go</button><p id="out">0</p>
<form id="f" method="post" action="${APP}/probe/B4-form"><input name="x" value="1"></form>
<script>
let n = 0;
document.getElementById('b').addEventListener('click', () => { n++; document.getElementById('out').textContent = String(n); });
document.getElementById('f').addEventListener('submit', (e) => { console.log('submit-fired', e.defaultPrevented); });
</script>`,
      ),
      checks: [
        { kind: 'dispatch', selector: '#b', event: 'click' },
        { kind: 'domQuery', selector: '#out', read: ['text'] },
        { kind: 'dispatch', selector: '#f', event: 'submit' },
        { kind: 'waitSettled', maxMs: 300 },
      ],
    });
    await settleMs(500);
    const leaks = await unexpectedRequests(request);
    evidence({ status: r.status, console: logs(r), csp: r.csp, leaks, observations: r.observations });
    expect(r.observations[1].value.items[0].text).toBe('1');
    expect(logs(r)).toContain('submit-fired false');
    expect(leaks).toEqual([]);
  });

  test('B5/Q7 error positions: worker stack mapping, DOM ErrorEvent.lineno with/without sourceURL', async ({ page, request }) => {
    await open(page, request);
    const w = await run(page, { code: 'let a = 1;\nfunction f() {\n  null.x;\n}\nf();' });
    const body = '<p>x</p>\n<script>\nlet a = 1;\nnull.x;\n</script>';
    const d1 = await run(page, { ...dom(body), scriptDelivery: 'inline' });
    const d2 = await run(page, { ...dom('<p>x</p>\n<script>\nlet a = 1;\nnull.x;\n//# sourceURL=learner:///app.js\n</script>'), scriptDelivery: 'inline' });
    const d3 = await run(page, dom(body));
    const syn = await run(page, { code: 'let a = ;' });
    evidence({
      worker: w.errors,
      domNoSourceURL: d1.errors.map((e) => ({ position: e.position, stack: e.stackPositions })),
      domWithSourceURL: d2.errors.map((e) => ({ position: e.position, stack: e.stackPositions })),
      domBlobDelivery: d3.errors.map((e) => ({ name: e.name, position: e.position, stack: e.stackPositions })),
      syntax: syn.errors,
      note: 'DOM doc lines: <!doctype>=1, <html>=2, <p>=3, <script>=4, let=5, null.x=6 (script-relative line 3)',
    });
    expect(w.errors[0].name).toBe('TypeError');
    expect(w.errors[0].stackPositions.some((p) => p.file === 'main.js' && p.line === 3)).toBe(true);
    expect(d3.errors[0].name).toBe('TypeError');
    expect(d3.errors[0].stackPositions[0]).toMatchObject({ file: 'index.html#script1', line: 3 });
    expect(syn.status).toBe('error');
    expect(syn.errors[0].line).toBe(1);
  });

  test('B6 dom scriptDelivery=blob: errors not muted, script-relative lines, globals shared, order kept', async ({ page, request }) => {
    await open(page, request);
    const page1 = html(`<p id="p">x</p>
<script>
let shared = 1;
document.addEventListener('DOMContentLoaded', () => console.log('dcl', shared));
console.log('first', document.currentScript && document.currentScript.src.slice(0, 5));
</script>
<p id="q">y</p>
<script>
shared++;
console.log('second sees q', !!document.getElementById('q'), shared);
null.x;
</script>
<script>
let n = 0;
while (true) { n++; }
</script>`);
    const r = await run(page, { mode: 'dom', files: [{ path: 'index.html', language: 'html', content: page1 }], scriptDelivery: 'blob', expose: ['shared'], checks: [{ kind: 'readGlobal', name: 'shared' }] });
    evidence({ status: r.status, console: logs(r), errors: r.errors.map((e) => ({ phase: e.phase, name: e.name, position: e.position, stack: e.stackPositions })), obs: r.observations });
    expect(logs(r)).toEqual(['first blob:', 'second sees q true 2', 'dcl 2']);
    const te = r.errors.find((e) => e.name === 'TypeError');
    expect(te).toBeTruthy();
    expect(te.position.line).toBe(4);
    const ll = r.errors.find((e) => e.phase === 'loop_limit');
    expect(ll.position.line).toBe(3);
    expect(r.observations[0].value.value).toEqual({ t: 'number', v: 2 });
  });

  test('Q6 timers/layout in an off-screen shell vs visible shell', async ({ page, request }) => {
    await open(page, request);
    const steps = [{ kind: 'timing' }, { kind: 'boxRect', selectors: ['#b'] }];
    const body = '<div id="b" style="width:50px;height:20px"></div>';
    const visibleDom = await run(page, { ...dom(body), checks: steps });
    const visibleWorker = await run(page, { code: '1', checks: [{ kind: 'timing' }] });
    await page.evaluate(() => window.pg.setPlacement('offscreen'));
    const offDom = await run(page, { ...dom(body), checks: steps });
    const offWorker = await run(page, { code: '1', checks: [{ kind: 'timing' }] });
    await page.evaluate(() => window.pg.setPlacement('hidden-in-viewport'));
    const hiddenDom = await run(page, { ...dom(body), checks: steps });
    const v = (r) => r.observations.map((o) => o.value);
    evidence({ visibleDom: v(visibleDom), offDom: v(offDom), hiddenInViewportDom: v(hiddenDom), visibleWorker: v(visibleWorker), offWorker: v(offWorker) });
    expect(hiddenDom.observations[1].value['#b'][0].width).toBe(50);
    expect(hiddenDom.observations[0].value.timeout100ActualMs).toBeLessThan(400);
  });
});

// ---------------------------------------------------------------- network (S1–S13, S25, S44)
const netDom = [
  ['S1', `fetch('${APP}/probe/S1').then(r=>console.log('S1 ok',r.status),e=>console.log('S1 blocked',e.name))`],
  ['S1-ext', `fetch('${EXT}/probe/S1-ext').then(r=>console.log('ok',r.status),e=>console.log('blocked',e.name))`],
  ['S1-token', `fetch('${APP}/api/secret',{headers:{'x-proginone-token':'${TOKEN}'}}).then(r=>r.text()).then(t=>console.log('LEAK',t),e=>console.log('blocked',e.name))`],
  ['S2', `fetch('/probe/S2').then(r=>console.log('ok',r.status),e=>console.log('blocked',e.name))`],
  ['S3', `try{const x=new XMLHttpRequest();x.open('GET','${APP}/probe/S3');x.onload=()=>console.log('LEAK');x.onerror=()=>console.log('xhr error');x.send()}catch(e){console.log('blocked',e.name)}`],
  ['S4', `try{const w=new WebSocket('ws://127.0.0.1:4331/probe/S4');w.onopen=()=>console.log('LEAK');w.onerror=()=>console.log('ws error')}catch(e){console.log('blocked',e.name)}`],
  ['S5', `try{const s=new EventSource('${APP}/probe/S5');s.onerror=()=>console.log('es error')}catch(e){console.log('blocked',e.name)}`],
  ['S6', `try{console.log('beacon', navigator.sendBeacon('${APP}/probe/S6','d'))}catch(e){console.log('blocked',e.name)}`],
  ['S7', `const i=new Image();i.onerror=()=>console.log('img error');i.onload=()=>console.log('LEAK');i.src='${APP}/probe/S7';`],
  ['S25', `import('${APP}/probe/S25.js').then(()=>console.log('LEAK'),e=>console.log('blocked',e.name))`],
  ['S5-dom-worker', `try{new Worker(URL.createObjectURL(new Blob(["new EventSource('${APP}/probe/S5dw')"])));console.log('worker created')}catch(e){console.log('blocked',e.name)}`],
  ['S11', `location.href='${APP}/probe/S11';`],
];
const netDomHtml = [
  ['S8', `<p>x</p>`, `<link rel="stylesheet" href="${APP}/probe/S8.css">`],
  ['S9', `<div style="width:10px;height:10px;background:url(${APP}/probe/S9.png)"></div>`, ''],
  ['S9-ext', `<div style="width:10px;height:10px;background-image:url(${EXT}/probe/S9.png)"></div>`, ''],
  ['S10', `<iframe src="${APP}/probe/S10"></iframe>`, ''],
  ['S12', `<p>x</p>`, `<meta http-equiv="refresh" content="0;url=${APP}/probe/S12">`],
  ['S44', `<img src="probe/S44.png">`, `<base href="${EXT}/">`],
  ['S-font', `<p style="font-family:x">x</p>`, `<style>@font-face{font-family:x;src:url(${APP}/probe/font.woff)}</style>`],
  ['S-script-src', `<p>x</p>`, `<script src="${APP}/probe/S-script.js"></script>`],
  ['S-object', `<object data="${APP}/probe/S-object"></object><embed src="${APP}/probe/S-embed">`, ''],
  ['S-prefetch', `<p>x</p>`, `<link rel="prefetch" href="${APP}/probe/S-prefetch"><link rel="preload" as="image" href="${APP}/probe/S-preload">`],
];
const netWorker = [
  ['S1-w', `fetch('${APP}/probe/S1w').then(r=>console.log('LEAK',r.status),e=>console.log('blocked',e.name))`],
  ['S1-w-ext', `fetch('${EXT}/probe/S1wx').then(r=>console.log('LEAK'),e=>console.log('blocked',e.name))`],
  ['S3-w', `try{const x=new XMLHttpRequest();x.open('GET','${APP}/probe/S3w');x.onload=()=>console.log('LEAK');x.onerror=()=>console.log('xhr error');x.send()}catch(e){console.log('blocked',e.name)}`],
  ['S4-w', `try{const w=new WebSocket('ws://127.0.0.1:4331/probe/S4w');w.onopen=()=>console.log('LEAK');w.onerror=()=>console.log('ws error')}catch(e){console.log('blocked',e.name)}`],
  ['S5-w', `try{if(typeof EventSource==='function'){const s=new EventSource('${APP}/probe/S5w');s.onerror=()=>console.log('es error')}else console.log('no EventSource')}catch(e){console.log('blocked',e.name)}`],
  ['S25-w', `try{importScripts('${APP}/probe/S25w.js');console.log('LEAK')}catch(e){console.log('blocked',e.name)}`],
  ['S25-w-import', `import('${APP}/probe/S25wi.js').then(()=>console.log('LEAK'),e=>console.log('blocked',e.name))`],
  ['S5-w-nested', `try{const w=new Worker(URL.createObjectURL(new Blob(["new EventSource('${APP}/probe/S5wn')"])));console.log('nested worker created')}catch(e){console.log('blocked',e.name)}`],
  ['S-w-nested-worker', `try{new Worker('${APP}/probe/Sww.js');console.log('created')}catch(e){console.log('blocked',e.name)}`],
];

test.describe('network is blocked', () => {
  for (const [id, code] of netDom) {
    test(`${id} dom`, async ({ page, request }) => {
      await open(page, request);
      const r = await run(page, { ...dom(`<script>${code}</script>`), limits: { maxDurationMs: 1500 } });
      await settleMs(700);
      const leaks = await unexpectedRequests(request);
      const st = await page.evaluate(() => window.pg.state);
      evidence({ status: r.status, console: logs(r), csp: r.csp, leaks, appUrl: st.location });
      expect(leaks).toEqual([]);
      expect(logs(r).join('\n')).not.toContain('LEAK');
      expect(st.location).toBe(`${APP}/${SHELL_Q}`);
    });
  }
  for (const [id, body, head] of netDomHtml) {
    test(`${id} dom-html`, async ({ page, request }) => {
      await open(page, request);
      const r = await run(page, { ...dom(body, head), limits: { maxDurationMs: 1500 } });
      await settleMs(700);
      const leaks = await unexpectedRequests(request);
      evidence({ status: r.status, csp: r.csp, leaks });
      expect(leaks).toEqual([]);
    });
  }
  for (const [id, code] of netWorker) {
    test(`${id} js-console`, async ({ page, request }) => {
      await open(page, request);
      const r = await run(page, { code, limits: { maxDurationMs: 1500 } });
      await settleMs(700);
      const leaks = await unexpectedRequests(request);
      evidence({ status: r.status, console: logs(r), errors: r.errors, csp: r.csp, leaks });
      expect(leaks).toEqual([]);
      expect(logs(r).join('\n')).not.toContain('LEAK');
    });
  }
  test('S5-dom-worker-unmitigated (recorded): learner blob Worker EventSource without the worker-src meta', async ({ page, request }) => {
    await open(page, request);
    const r = await run(page, { ...dom(`<script>new Worker(URL.createObjectURL(new Blob(["new EventSource('${APP}/probe/S5dwu')"]))); console.log('worker created');</script>`), allowLearnerWorkers: true, checks: [{ kind: 'waitSettled', maxMs: 300 }], limits: { maxDurationMs: 1500 } });
    await settleMs(700);
    const leaks = await unexpectedRequests(request);
    evidence({ console: logs(r), csp: r.csp, leaks });
  });

  test('S13/Q3 form POST to app API: submit handler runs, request not sent', async ({ page, request }) => {
    await open(page, request);
    const r = await run(page, {
      ...dom(`<form id="f" method="post" action="${APP}/probe/S13"><button id="s">send</button></form>
<script>document.getElementById('f').addEventListener('submit', () => console.log('submit handler ran'));</script>`),
      checks: [{ kind: 'dispatch', selector: '#s', event: 'click' }, { kind: 'waitSettled', maxMs: 300 }],
      limits: { maxDurationMs: 1500 },
    });
    await settleMs(700);
    const leaks = await unexpectedRequests(request);
    evidence({ status: r.status, console: logs(r), csp: r.csp, leaks });
    expect(logs(r)).toContain('submit handler ran');
    expect(leaks).toEqual([]);
  });
});

// ---------------------------------------------------------------- parent / app isolation (S14–S24)
test.describe('app isolation', () => {
  test('S14/S15 parent & top document, cookie, localStorage', async ({ page, request }) => {
    await open(page, request);
    const code = `
const tryIt = (label, f) => { try { console.log(label, 'OK', String(f())); } catch (e) { console.log(label, 'threw', e.name); } };
tryIt('parent.document', () => parent.document.body);
tryIt('top.document', () => top.document.body);
tryIt('top.cookie', () => top.document.cookie);
tryIt('parent.localStorage', () => parent.localStorage.getItem('app-marker'));
tryIt('top.localStorage', () => top.localStorage.getItem('app-marker'));
tryIt('opener', () => window.opener);
tryIt('top.pg', () => top.pg);`;
    const r = await run(page, dom(`<script>${code}</script>`));
    const st = await page.evaluate(() => window.pg.state);
    evidence({ console: logs(r), caps: r.harnessCaps, app: { ls: st.appLocalStorage, cookie: st.appCookie } });
    const out = logs(r).join('\n');
    expect(out).not.toMatch(/parent\.document OK|top\.document OK|top\.cookie OK|parent\.localStorage OK|top\.localStorage OK|top\.pg OK [^u]/);
    expect(st.appLocalStorage).toBe('app-value');
  });

  test('S16/Q8 localStorage shim and cookie behavior in opaque origin', async ({ page, request }) => {
    await open(page, request);
    const r = await run(page, dom(`<script>localStorage.setItem('k','v'); console.log('ls', localStorage.getItem('k'));</script>`));
    const st = await page.evaluate(() => window.pg.state);
    evidence({ console: logs(r), errors: r.errors, caps: r.harnessCaps, shellCaps: st.shellCaps, appLs: st.appLocalStorage });
    expect(logs(r)).toContain('ls v');
    expect(st.appLocalStorage).toBe('app-value');
  });

  test('S17 top navigation blocked', async ({ page, request }) => {
    await open(page, request);
    const r = await run(page, {
      ...dom(`<script>try { top.location = '${APP}/probe/S17'; console.log('assigned'); } catch (e) { console.log('threw', e.name); }
try { top.location.href = 'https://example.com/'; } catch (e) { console.log('threw2', e.name); }</script>`),
      limits: { maxDurationMs: 1500 },
    });
    await settleMs(700);
    const st = await page.evaluate(() => window.pg.state);
    const leaks = await unexpectedRequests(request);
    evidence({ console: logs(r), url: st.location, leaks });
    expect(st.location).toBe(`${APP}/${SHELL_Q}`);
    expect(leaks).toEqual([]);
  });

  test('S18 window.open / S19 download', async ({ page, request }) => {
    await open(page, request);
    let popups = 0;
    let downloads = 0;
    page.context().on('page', () => popups++);
    page.on('download', () => downloads++);
    const r = await run(page, {
      ...dom(`<a id="d" href="data:text/plain,x" download="x.txt">d</a><a id="t" href="${APP}/probe/S18b" target="_blank">t</a>
<script>console.log('open', String(window.open('${APP}/probe/S18')));</script>`),
      checks: [{ kind: 'dispatch', selector: '#d', event: 'click' }, { kind: 'dispatch', selector: '#t', event: 'click' }],
      limits: { maxDurationMs: 1500 },
    });
    await settleMs(800);
    const leaks = await unexpectedRequests(request);
    evidence({ console: logs(r), popups, downloads, leaks });
    expect(popups).toBe(0);
    expect(downloads).toBe(0);
    expect(leaks).toEqual([]);
  });

  test('S20 alert/confirm/prompt do not block (both modes)', async ({ page, request }) => {
    await open(page, request);
    const code = `alert('a'); console.log('c', confirm('b')); console.log('p', prompt('z'));`;
    const d = await run(page, dom(`<script>${code}</script>`));
    const w = await run(page, { code });
    evidence({ dom: d.console.map((e) => e.level), worker: w.console.map((e) => e.level) });
    expect(d.console.map((e) => e.level)).toEqual(['alert', 'confirm', 'log', 'prompt', 'log']);
    expect(w.console.map((e) => e.level)).toEqual(['alert', 'confirm', 'log', 'prompt', 'log']);
  });

  test('S21 clipboard / S22 fullscreen & pointer lock / S23 service worker (Q9)', async ({ page, request }) => {
    await open(page, request);
    const code = `
const rep = (l, p) => Promise.resolve().then(p).then(v => console.log(l, 'resolved', String(v)), e => console.log(l, 'rejected', e && e.name));
rep('clipboard.write', () => navigator.clipboard ? navigator.clipboard.writeText('x') : 'no navigator.clipboard');
rep('clipboard.read', () => navigator.clipboard ? navigator.clipboard.readText() : 'no navigator.clipboard');
rep('fullscreen', () => document.body.requestFullscreen ? document.body.requestFullscreen() : 'no api');
try { document.body.requestPointerLock(); console.log('pointerLock called'); } catch (e) { console.log('pointerLock threw', e.name); }
rep('serviceWorker', () => navigator.serviceWorker ? navigator.serviceWorker.register('${APP}/probe/sw.js') : 'no navigator.serviceWorker');`;
    const r = await run(page, { ...dom(`<script>${code}</script>`), checks: [{ kind: 'waitSettled', maxMs: 800 }], limits: { maxDurationMs: 2000 } });
    await settleMs(500);
    const leaks = await unexpectedRequests(request);
    evidence({ console: logs(r), leaks });
    const out = logs(r).join('\n');
    expect(out).not.toMatch(/clipboard\.(write|read) resolved undefined|fullscreen resolved undefined|serviceWorker resolved \[object/);
    expect(leaks).toEqual([]);
  });

  test('S24 eval / new Function / string timers blocked (both modes)', async ({ page, request }) => {
    await open(page, request);
    const code = `
try { console.log('eval', eval('1+1')); } catch (e) { console.log('eval threw', e.name); }
try { console.log('Function', new Function('return 1')()); } catch (e) { console.log('Function threw', e.name); }
try { setTimeout("console.log('string timer ran')", 0); console.log('string timer scheduled'); } catch (e) { console.log('string timer threw', e.name); }`;
    const d = await run(page, { ...dom(`<script>${code}</script>`), checks: [{ kind: 'waitSettled', maxMs: 200 }] });
    const w = await run(page, { code, checks: [{ kind: 'waitSettled', maxMs: 200 }] });
    evidence({ dom: logs(d), domCsp: d.csp, worker: logs(w), workerCsp: w.csp });
    for (const out of [logs(d).join('\n'), logs(w).join('\n')]) {
      expect(out).toContain('eval threw EvalError');
      expect(out).toContain('Function threw EvalError');
      expect(out).not.toContain('string timer ran');
    }
  });

  test('S36 postMessage spoofing to shell and app is ignored', async ({ page, request }) => {
    await open(page, request);
    const fake = `{type:'done',status:'completed',errors:[],observations:[{kind:'callFunction',value:{returned:{t:'number',v:42}}}]}`;
    const r = await run(page, {
      ...dom(`<script>
parent.postMessage(${fake}, '*');
parent.postMessage({type:'result',v:1,status:'completed'}, '*');
top.postMessage({type:'shell-hello',v:1}, '*');
top.postMessage({type:'result',v:1,runId:'x',status:'completed'}, '*');
function add(a,b){ return a - b; }
</script>`),
      expose: ['add'],
      checks: [{ kind: 'callFunction', name: 'add', args: [2, 3] }],
    });
    const st = await page.evaluate(() => window.pg.state);
    evidence({ observations: r.observations, ignoredByShell: r.ignoredWindowMessages, rejectedByApp: st.rejectedWindowMessages });
    expect(r.observations[0].value.returned).toEqual({ t: 'number', v: -1 });
    expect(r.ignoredWindowMessages).toBeGreaterThanOrEqual(2);
    expect(st.rejectedWindowMessages.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------- loops, limits, integrity (S26–S43)
test.describe('loops and limits', () => {
  test('S26 js-console while(true): loop guard, and terminate() without instrumentation', async ({ page, request }) => {
    await open(page, request);
    const guarded = await run(page, { code: 'let i = 0;\nwhile (true) { i++; }' });
    const raw = await run(page, { code: 'while (true) {}', instrument: false, limits: { maxDurationMs: 2000 } });
    const after = await run(page, { code: 'console.log("next run ok")' });
    evidence({
      guarded: { status: guarded.status, errors: guarded.errors, wallMs: guarded.host.wallMs, maxRafGapMs: guarded.host.maxRafGapMs },
      raw: { status: raw.status, reason: raw.reason, wallMs: raw.host.wallMs, maxRafGapMs: raw.host.maxRafGapMs, heartbeats: raw.host.heartbeats },
      after: after.status,
    });
    expect(guarded.status).toBe('loop_limit');
    expect(guarded.errors[0].position.line).toBe(2);
    expect(raw.status).toBe('timeout');
    expect(raw.host.wallMs).toBeLessThan(3000);
    expect(raw.host.maxRafGapMs).toBeLessThan(100);
    expect(after.status).toBe('completed');
  });

  test('S27 dom while(true) on line 3: loop_limit with line, UI responsive', async ({ page, request }) => {
    await open(page, request);
    const r = await run(page, dom('<script>\nlet count = 0;\nwhile (true) { count++; }\n</script>'));
    evidence({ status: r.status, errors: r.errors, wallMs: r.host.wallMs, maxRafGapMs: r.host.maxRafGapMs, maxTimerLagMs: r.host.maxTimerLagMs });
    expect(r.status).toBe('loop_limit');
    expect(r.errors[0].position.line).toBe(3);
  });

  test('S28/S29/S30 loops in timers, inline handlers, do-while, generators, labels', async ({ page, request }) => {
    await open(page, request);
    const cases = {
      S28: dom('<script>setTimeout(() => { for (;;) {} }, 0);</script>'),
      S29: { ...dom('<button id="b" onclick="while(1){}">b</button>'), checks: [{ kind: 'dispatch', selector: '#b', event: 'click' }] },
      'S30-do': dom('<script>do {} while (true);</script>'),
      'S30-gen': dom('<script>function* g(){ let i=0; while(true) yield i++; }\nfor (const x of g()) {}</script>'),
      'S30-label': dom('<script>outer: for (;;) { inner: while (true) { continue outer; } }</script>'),
      'S30-nobody': dom('<script>let x = 1; while (x) x = 1;</script>'),
      'S30-async': dom('<script>(async () => { await null; while (true) {} })();</script>'),
    };
    const out = {};
    for (const [k, c] of Object.entries(cases)) {
      const r = await run(page, c);
      out[k] = { status: r.status, phase: r.errors?.[0]?.phase, line: r.errors?.[0]?.position?.line, wallMs: r.host.wallMs };
    }
    evidence(out);
    for (const v of Object.values(out)) expect(v.status).toBe('loop_limit');
  });

  test('S31 infinite recursion → RangeError (both modes)', async ({ page, request }) => {
    await open(page, request);
    const d = await run(page, dom('<script>function f(){ f(); } f();</script>'));
    const w = await run(page, { code: 'function f(){ f(); } f();' });
    evidence({ dom: d.errors.map((e) => e.name), worker: w.errors.map((e) => e.name) });
    expect(d.errors[0].name).toMatch(/RangeError|InternalError/);
    expect(w.errors[0].name).toMatch(/RangeError|InternalError/);
  });

  test('S34/S35 console flood and huge strings are capped', async ({ page, request }) => {
    await open(page, request);
    const flood = await run(page, { code: 'for (let i = 0; i < 1e6; i++) console.log(i);', limits: { loopBudgetMs: 2500, maxDurationMs: 4000 } });
    const big = await run(page, { code: "console.log('x'.repeat(1e8));" });
    const domFlood = await run(page, dom('<script>for (let i = 0; i < 2e5; i++) console.log(i);</script>'));
    evidence({
      flood: { status: flood.status, count: flood.console.length, dropped: flood.droppedConsoleEntries, maxRafGapMs: flood.host.maxRafGapMs },
      big: { status: big.status, truncated: big.console[0]?.args[0]?.truncated, len: big.console[0]?.args[0]?.v?.length },
      domFlood: { status: domFlood.status, count: domFlood.console.length, dropped: domFlood.droppedConsoleEntries, maxRafGapMs: domFlood.host.maxRafGapMs },
    });
    expect(flood.console.length).toBe(1000);
    expect(flood.droppedConsoleEntries).toBeGreaterThan(0);
    expect(big.console[0].args[0].truncated).toBe(true);
    expect(domFlood.console.length).toBe(1000);
  });

  test('S37/S38/S39 harness integrity against tampering (both modes)', async ({ page, request }) => {
    await open(page, request);
    const tamper = `
Array.prototype.push = () => 0; JSON.stringify = () => '{}'; Object.keys = () => [];
MessagePort.prototype.postMessage = function () {};
try { globalThis.__pg = null; } catch (e) {}
try { delete globalThis.__pg; } catch (e) {}
function sum(a) { let s = 0; for (const x of a) s += x; return s; }
console.log('after tamper', typeof __pg);`;
    const steps = [{ kind: 'callFunction', name: 'sum', args: [[1, 2, 3]] }];
    const w = await run(page, { code: tamper, expose: ['sum'], checks: steps });
    const d = await run(page, { ...dom(`<script>${tamper}</script>`), expose: ['sum'], checks: steps });
    evidence({ worker: { status: w.status, obs: w.observations, console: logs(w) }, dom: { status: d.status, obs: d.observations, console: logs(d) } });
    expect(w.observations[0].value.returned).toEqual({ t: 'number', v: 6 });
    expect(d.observations[0].value.returned).toEqual({ t: 'number', v: 6 });
    expect(logs(w)).toContain('after tamper object');
  });

  test('S40 unhandled rejection / S41 setInterval pending at end', async ({ page, request }) => {
    await open(page, request);
    const wr = await run(page, { code: "Promise.reject(new Error('x'));", checks: [{ kind: 'waitSettled', maxMs: 200 }] });
    const dr = await run(page, { ...dom("<script>Promise.reject(new Error('x'));</script>"), checks: [{ kind: 'waitSettled', maxMs: 200 }] });
    const iv = await run(page, { code: 'setInterval(() => console.log(1), 10);', purpose: 'grading', limits: { maxDurationMs: 1000 } });
    evidence({
      workerRejection: wr.errors, workerCaps: wr.harnessCaps, domRejection: dr.errors,
      interval: { status: iv.status, pendingAtEnd: iv.pendingAtEnd, consoleCount: iv.consoleCount, wallMs: iv.host.wallMs },
    });
    expect(dr.errors.some((e) => e.phase === 'unhandled_rejection')).toBe(true);
    expect(iv.pendingAtEnd.intervals).toBe(1);
    expect(iv.host.wallMs).toBeLessThan(2000);
  });

  test('S43 oversized RunRequest rejected by host validation', async ({ page, request }) => {
    await open(page, request);
    const r = await page.evaluate(() => window.pg.run({ files: Array.from({ length: 21 }, (_, i) => ({ path: `f${i}.js`, language: 'js', content: '1' })) }));
    const r2 = await page.evaluate(() => window.pg.run({ code: 'x'.repeat(200001) }));
    evidence({ r, r2 });
    expect(r.status).toBe('rejected');
    expect(r2.status).toBe('rejected');
  });
});

// ---------------------------------------------------------------- browser behavior (record; Q4, Q5, S32, S33, S42)
test.describe('browser behavior (recorded)', () => {
  for (const placement of ['same-site', 'cross-site', 'per-shell-subdomain']) {
    test(`Q4/Q5 uninstrumented DOM infinite loop (${placement} shell): app freeze? recovery?`, async ({ browser, browserName, request }) => {
      test.setTimeout(60_000);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await request.get(`${APP}/__log/reset`);
      const q = { 'same-site': '', 'cross-site': '?shellOrigin=http://localhost:4331', 'per-shell-subdomain': '?shellOrigin=http://s{n}.localhost:4331' }[placement];
      await page.goto(`${APP}/${q}`);
      await page.waitForSelector('html[data-ready="1"]', { timeout: 10_000 });
      let cdp = null;
      if (browserName === 'chromium') cdp = await browser.newBrowserCDPSession().catch(() => null);
      const renderers = async () => (cdp ? (await cdp.send('SystemInfo.getProcessInfo')).processInfo.filter((p) => p.type === 'renderer') : null);
      await page.evaluate(() => {
        window.__q4 = null;
        window.pg.run({ mode: 'dom', files: [{ path: 'index.html', language: 'html', content: '<!doctype html><script>while(true){}</script>' }], instrument: false, limits: { maxDurationMs: 2000 } }).then((r) => (window.__q4 = r));
      });
      const t0 = Date.now();
      const samples = [];
      let result = null;
      while (Date.now() - t0 < 8000) {
        const s0 = Date.now();
        const v = await Promise.race([page.evaluate(() => window.__q4 && { status: window.__q4.status, watchdog: window.__q4.watchdog, host: window.__q4.host }), settleMs(1500).then(() => 'FROZEN')]);
        samples.push({ atMs: Date.now() - t0, evalLatencyMs: Date.now() - s0, frozen: v === 'FROZEN' });
        if (v && v !== 'FROZEN') { result = v; break; }
        await settleMs(250);
      }
      let cpu = null;
      let next = null;
      if (result) {
        const a = await renderers();
        await settleMs(1500);
        const b = await renderers();
        if (a && b) cpu = b.map((p) => ({ id: p.id, cpuDeltaS: +(p.cpuTime - (a.find((x) => x.id === p.id)?.cpuTime ?? p.cpuTime)).toFixed(2) })).filter((p) => p.cpuDeltaS > 0.3);
        if (cpu && cpu.length) {
          // How long until the spinning renderer goes away (killed or stopped)?
          const busyId = cpu[0].id;
          let prev = b.find((p) => p.id === busyId)?.cpuTime;
          const k0 = Date.now();
          let stoppedAfterMs = null;
          while (Date.now() - k0 < 30000) {
            await settleMs(500);
            const cur = (await renderers()).find((p) => p.id === busyId);
            if (!cur || cur.cpuTime - prev < 0.2) { stoppedAfterMs = Date.now() - k0 + 3000; break; }
            prev = cur.cpuTime;
          }
          cpu.push({ busyRendererStoppedAfterWatchdogMs: stoppedAfterMs });
        }
        const n0 = Date.now();
        next = await Promise.race([
          page.evaluate(() => window.pg.run({ code: 'console.log("next ok")' })).then((r) => ({ status: r.status, wallMs: r.host.wallMs, watchdog: r.watchdog })),
          settleMs(8000).then(() => ({ status: 'NO-RESULT-8s' })),
        ]);
        next.afterMs = Date.now() - n0;
        if (next.status !== 'completed') {
          // Does a later shell recover once the old process is gone? Try a few more times.
          const retries = [];
          for (let i = 0; i < 3 && next.status !== 'completed'; i++) {
            const st = await Promise.race([page.evaluate(() => window.pg.createShell().then(() => window.pg.run({ code: '1' }))).then((r) => r.status), settleMs(5000).then(() => 'NO-RESULT-5s')]);
            retries.push(st);
            if (st === 'completed') break;
          }
          next.retries = retries;
          next.renderersNow = await renderers();
        }
      }
      evidence({
        placement,
        appFrozen: !result,
        result: result && { status: result.status, watchdog: result.watchdog, wallMs: result.host.wallMs, appMaxRafGapMs: result.host.maxRafGapMs, heartbeats: result.host.heartbeats },
        firstSamples: samples.slice(0, 4),
        busyRenderersAfterRemoval_1500ms: cpu,
        nextRun: next,
      });
      await ctx.close().catch(() => {});
    });
  }

  for (const variant of ['allowLearnerWorkers', 'default-meta-worker-src-none']) {
    test(`S42 learner-created Worker with infinite loop after the nested frame is removed (${variant})`, async ({ page, request, browserName, browser }) => {
      test.setTimeout(60_000);
      await open(page, request);
      const head = '';
      const r = await run(page, {
        ...dom(`<script>try { const w = new Worker(URL.createObjectURL(new Blob(['while(true){}'], {type:'text/javascript'}))); w.onerror = (e) => console.log('worker error event'); console.log('learner worker created'); } catch (e) { console.log('learner worker blocked', e.name); }</script>`, head),
        checks: [{ kind: 'waitSettled', maxMs: 300 }],
        allowLearnerWorkers: variant === 'allowLearnerWorkers',
      });
      const timeline = [];
      if (browserName === 'chromium') {
        const cdp = await browser.newBrowserCDPSession();
        let prev = (await cdp.send('SystemInfo.getProcessInfo')).processInfo;
        for (let i = 0; i < 12; i++) {
          await settleMs(1000);
          const cur = (await cdp.send('SystemInfo.getProcessInfo')).processInfo;
          const busy = cur.map((p) => ({ id: p.id, d: +(p.cpuTime - (prev.find((q) => q.id === p.id)?.cpuTime ?? p.cpuTime)).toFixed(2) })).filter((p) => p.d > 0.5);
          timeline.push({ s: i + 1, busy: busy.length });
          prev = cur;
          if (!busy.length) break;
        }
      }
      evidence({ variant, console: logs(r), csp: r.csp, status: r.status, chromiumBusySecondsTimeline: timeline });
    });
  }

  test('S32 memory bomb in js-console mode', async ({ page, request }) => {
    test.setTimeout(60_000);
    await open(page, request);
    const r = await run(page, { code: 'const a = [];\nwhile (true) a.push(new Array(1e6).fill(1));', limits: { maxDurationMs: 3000 } });
    const next = await run(page, { code: 'console.log("next ok")' });
    evidence({ status: r.status, errors: r.errors, watchdog: r.watchdog, wallMs: r.host?.wallMs, maxRafGapMs: r.host?.maxRafGapMs, next: next.status });
    expect(next.status).toBe('completed');
  });

  test('S33 memory bomb in dom mode', async ({ page, request }) => {
    test.setTimeout(60_000);
    await open(page, request);
    let crashed = false;
    page.on('crash', () => (crashed = true));
    const r = await run(page, { ...dom('<script>\nconst a = [];\nwhile (true) a.push(new Array(1e6).fill(1));\n</script>'), limits: { maxDurationMs: 3000 } }).catch((e) => ({ status: 'evaluate-failed', message: String(e).slice(0, 200) }));
    let next = null;
    if (!crashed) next = await run(page, { code: 'console.log("next ok")' }).catch((e) => ({ status: 'evaluate-failed' }));
    evidence({ status: r.status, errors: r.errors, watchdog: r.watchdog, wallMs: r.host?.wallMs, maxRafGapMs: r.host?.maxRafGapMs, appTabCrashed: crashed, next: next?.status });
  });
});
