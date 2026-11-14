import { expect, test, type Page } from '@playwright/test';
import {
  blockedRequests,
  consoleText,
  hostStats,
  html,
  js,
  maxFrameGap,
  openRunner,
  run,
  startFrameMonitor,
  startProbe,
  watchRequests,
} from './sandbox-fixtures.ts';

/**
 * Runner sandbox through the production build (docs/design/code-execution-sandbox.md#보안-테스트-스위트).
 * Scenario numbers (S1–S48) refer to that table. Every attack checks both that it was blocked
 * and that nothing reached a server: the probe server (a stand-in for another local service)
 * and the app server (all page requests are recorded).
 */

let probe: Awaited<ReturnType<typeof startProbe>>;
test.beforeAll(async () => {
  probe = await startProbe();
});
test.afterAll(async () => {
  await probe.close();
});
test.beforeEach(() => {
  probe.reset();
});

/** Opens the runner and fails the test if anything but the shell itself was requested. */
async function setup(page: Page, options?: Parameters<typeof openRunner>[1]) {
  await openRunner(page, options);
  const appOrigin = await page.evaluate(() => location.origin);
  const requests = watchRequests(page);
  const expectNoLeaks = async () => {
    // Give late requests (beacons, image loads) a moment to show up.
    await page.waitForTimeout(500);
    expect(probe.hits(), 'requests that reached the probe server').toEqual([]);
    expect(requests.unexpected(), 'requests other than loading the shell').toEqual([]);
  };
  return { appOrigin, expectNoLeaks };
}

/** Wraps attack snippets so each reports `ok:<value>` or `blocked:<error name>`. */
const ATTACK_PRELUDE = `
const out = {};
const t = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      out[name] = 'pending';
      r.then((v) => { out[name] = 'ok:' + v; }, (e) => { out[name] = 'blocked:' + (e && e.name); });
    } else {
      out[name] = 'ok:' + r;
    }
  } catch (e) {
    out[name] = 'blocked:' + (e && e.name);
  }
};
const report = () => setTimeout(() => console.log(JSON.stringify(out)), 300);
`;

const num = (v: number) => ({ t: 'number' as const, v });

/** An observation without its envelope, for compact assertions. */
function payloads(result: Awaited<ReturnType<typeof run>>) {
  return result.observations.map(({ op: _op, id: _id, status: _status, ...rest }) => rest);
}

function attackReport(result: Awaited<ReturnType<typeof run>>): Record<string, string> {
  const line = consoleText(result).find((t) => t.startsWith('{'));
  if (!line) throw new Error(`no attack report: ${JSON.stringify(result)}`);
  return JSON.parse(line) as Record<string, string>;
}

test.describe('runner: execution and observations', () => {
  test('js-console keeps value structure, observes functions and maps errors to files', async ({
    page,
  }) => {
    await setup(page);
    const result = await run(page, {
      ...js(''),
      purpose: 'grading',
      entry: 'a.js',
      files: [
        {
          path: 'a.js',
          language: 'js',
          content: [
            'const add = (a, b) => a + b;',
            'let later;',
            'function fail() { throw new RangeError("nope"); }',
            'async function slow(x) { return x * 2; }',
            'function mutate(list) { list.push(4); return list.length; }',
            'function same(list) { console.log("in same"); return list; }',
            'console.log("hi", { a: [1, 2], m: new Map([["k", NaN]]) }, -0, 10n);',
          ].join('\n'),
        },
        {
          path: 'b.js',
          language: 'js',
          content: '\n\nfunction boom() { for (const x of [1]) { null.y; } }\nboom();',
        },
      ],
      checks: {
        v: 1,
        expose: ['add'],
        steps: [
          { op: 'waitSettled', id: 'settle', maxMs: 3_000 },
          { op: 'callFunction', id: 'add#0', name: 'add', args: [num(1), num(2)] },
          { op: 'callFunction', id: 'fail#0', name: 'fail', args: [] },
          { op: 'callFunction', id: 'slow#0', name: 'slow', args: [num(21)] },
          {
            op: 'callFunction',
            id: 'mutate#0',
            name: 'mutate',
            args: [{ t: 'array', items: [num(1), num(2), num(3)], length: 3 }],
            observeArgsAfter: true,
          },
          { op: 'callFunction', id: 'same#0', name: 'same', args: [], argsExpr: '[[1], 2]' },
          { op: 'callFunction', id: 'missing#0', name: 'missing', args: [] },
          { op: 'callFunction', id: 'later#0', name: 'later', args: [] },
          { op: 'readGlobal', id: 'later#1', name: 'later' },
          { op: 'consoleOutput', id: 'console#0' },
        ],
      },
    });
    expect(result.status).toBe('error');
    expect(result.console[0]?.args).toEqual([
      { t: 'string', v: 'hi' },
      {
        t: 'object',
        className: 'Object',
        entries: [
          [
            'a',
            {
              t: 'array',
              items: [
                { t: 'number', v: 1 },
                { t: 'number', v: 2 },
              ],
              length: 2,
            },
          ],
          [
            'm',
            {
              t: 'map',
              entries: [
                [
                  { t: 'string', v: 'k' },
                  { t: 'number', v: 'NaN' },
                ],
              ],
              size: 1,
            },
          ],
        ],
      },
      { t: 'number', v: '-0' },
      { t: 'bigint', v: '10' },
    ]);
    // The error is in b.js line 3 even though a loop guard was inserted before it on that line.
    const line = 'function boom() { for (const x of [1]) { null.y; } }';
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      phase: 'runtime',
      name: 'TypeError',
      position: { file: 'b.js', line: 3, column: line.indexOf('null.y') + 6 },
    });
    expect(result.observations.map((o) => [o.id, o.status])).toEqual(
      [
        'settle',
        'add#0',
        'fail#0',
        'slow#0',
        'mutate#0',
        'same#0',
        'missing#0',
        'later#0',
        'later#1',
        'console#0',
      ].map((id) => [id, 'ok']),
    );
    const [settle, add, fail, slow, mutate, same, missing, later, laterGlobal, logged] =
      payloads(result);
    expect(settle).toEqual({ settled: true });
    expect(add).toEqual({ outcome: 'returned', value: num(3), returnIsArg: [] });
    expect(fail).toEqual({
      outcome: 'threw',
      thrown: { t: 'error', name: 'RangeError', message: 'nope' },
    });
    expect(slow).toEqual({ outcome: 'returned', value: num(42), returnIsArg: [] });
    expect(mutate).toEqual({
      outcome: 'returned',
      value: num(4),
      returnIsArg: [],
      argsAfter: [{ t: 'array', items: [1, 2, 3, 4].map(num), length: 4 }],
    });
    // argsExpr builds real values; returning an argument shows up in returnIsArg.
    expect(same).toMatchObject({
      outcome: 'returned',
      returnIsArg: [0],
      console: [{ level: 'log', args: [{ t: 'string', v: 'in same' }] }],
    });
    expect(missing).toEqual({ outcome: 'missing' });
    expect(later).toEqual({ outcome: 'not_callable' });
    expect(laterGlobal).toEqual({ outcome: 'ok', value: { t: 'undefined' } });
    expect(logged).toMatchObject({ truncated: false, entries: [{ seq: 1 }, { seq: 2 }] });
  });

  test('dom mode keeps script order and shared globals, observes the DOM and events', async ({
    page,
  }) => {
    await setup(page);
    const result = await run(
      page,
      html(
        [
          '<!doctype html>',
          '<html><head><style>',
          '.box { width: 120px; padding: 10px; border: 2px solid red; }',
          '@media (max-width: 500px) { .box { width: 50px; } }',
          '</style></head><body>',
          '<div class="box" id="b">hi</div>',
          '<ul><li>a</li><li>b</li></ul>',
          '<button id="btn">0</button><input id="name"><button id="bad">x</button>',
          '<script>',
          'let clicks = 0;',
          'btn.addEventListener("click", () => { clicks++; btn.textContent = String(clicks); });',
          'document.getElementById("name").addEventListener("input", (e) => { b.textContent = e.target.value; });',
          'bad.addEventListener("click", () => { throw new TypeError("handler broke"); });',
          '</script>',
          '<script>console.log("second script", clicks, document.readyState);</script>',
          '</body></html>',
        ].join('\n'),
        {
          steps: [
            { op: 'domQuery', id: 'li#q', selector: 'li', read: ['count', 'text', 'tagName'] },
            { op: 'domQuery', id: 'ul#q', selector: 'ul', read: ['outerHTMLShape', 'attr:id'] },
            {
              op: 'computedStyle',
              id: 'box#0',
              selector: '.box',
              properties: ['width', 'border-top-color'],
            },
            { op: 'boxRect', id: 'box#1', selectors: ['.box', '.none'] },
            { op: 'dispatch', id: 'ev#s0', selector: '#btn', event: 'click' },
            { op: 'dispatch', id: 'ev#s1', selector: '#btn', event: 'click' },
            { op: 'dispatch', id: 'ev#s2', selector: '#name', event: 'input', value: 'Kim' },
            { op: 'domQuery', id: 'ev#e0', selector: '#btn, #b', read: ['text'] },
            { op: 'readGlobal', id: 'g#0', name: 'clicks' },
            { op: 'setViewport', id: 'viewport#400', width: 400, height: 600 },
            { op: 'computedStyle', id: 'box#2', selector: '.box', properties: ['width'] },
            { op: 'dispatch', id: 'ev#s3', selector: '#missing', event: 'click' },
            { op: 'dispatch', id: 'ev#s4', selector: '#bad', event: 'click' },
          ],
        },
      ),
    );
    // The handler error is a runtime error of the program, and the dispatch reports it.
    expect(result.status).toBe('error');
    expect(consoleText(result)).toEqual(['second script 0 loading']);
    expect(result.observations.every((o) => o.status === 'ok')).toBe(true);
    const values = payloads(result);
    expect(values[0]).toEqual({
      count: 2,
      items: [
        { text: 'a', tagName: 'li' },
        { text: 'b', tagName: 'li' },
      ],
    });
    expect(values[1]).toEqual({
      count: 1,
      items: [{ outerHTMLShape: 'ul(li,li)', attrs: { id: null } }],
    });
    expect(values[2]).toEqual({
      count: 1,
      elements: [{ width: '120px', 'border-top-color': 'rgb(255, 0, 0)' }],
    });
    expect(values[3]).toMatchObject({
      rects: [
        { selector: '.box', count: 1, rect: { width: 144 } },
        { selector: '.none', count: 0 },
      ],
      viewport: { width: 800, height: 600 },
    });
    expect(values[4]).toEqual({ ok: true });
    expect(values[7]).toEqual({ count: 2, items: [{ text: 'Kim' }, { text: '2' }] });
    expect(values[8]).toEqual({ outcome: 'ok', value: num(2) });
    expect(values[9]).toEqual({ width: 400, height: 600 });
    expect(values[10]).toEqual({ count: 1, elements: [{ width: '50px' }] });
    expect(values[11]).toEqual({ ok: false, reason: 'TARGET_NOT_FOUND' });
    expect(values[12]).toEqual({
      ok: false,
      reason: 'HANDLER_ERROR',
      error: { name: 'TypeError', message: 'handler broke' },
    });
  });

  test('dom mode maps errors to document lines', async ({ page }) => {
    await setup(page);
    const result = await run(
      page,
      html('<!doctype html>\n<p>x</p>\n<script>\nconst a = 1;\nundefinedFn();\n</script>'),
    );
    expect(result.status).toBe('error');
    expect(result.errors[0]).toMatchObject({
      phase: 'runtime',
      name: 'ReferenceError',
      position: { file: 'index.html', line: 5, column: 1 },
    });
  });

  test('learner code runs in strict mode with learner line numbers (D-026)', async ({ page }) => {
    await setup(page);
    // Assigning to an undeclared variable throws instead of creating a global (V8 points at `=`).
    const undeclared = await run(page, js('let a = 1;\nnickname = "코코";\nconsole.log("after");'));
    expect(undeclared.status).toBe('error');
    expect(undeclared.errors[0]).toMatchObject({
      phase: 'runtime',
      name: 'ReferenceError',
      message: expect.stringContaining('nickname is not defined'),
      position: { file: 'main.js', line: 2, column: 10 },
    });
    expect(consoleText(undeclared)).toEqual([]);

    // Line 1 columns are not shifted by the directive.
    const lineOne = await run(page, js('let b = 1; missingName;'));
    expect(lineOne.errors[0]).toMatchObject({
      name: 'ReferenceError',
      position: { file: 'main.js', line: 1, column: 12 },
    });

    // `this` in a plain function call is undefined; top-level `this` is still the global.
    const thisCheck = await run(
      page,
      js('function f() { return this; }\nconsole.log(f() === undefined, this === globalThis);'),
    );
    expect(thisCheck.status).toBe('completed');
    expect(consoleText(thisCheck)).toEqual(['true true']);

    // Strict-only syntax is a syntax error before anything runs.
    const octal = await run(page, js('console.log("never");\nlet n = 010;'));
    expect(octal).toMatchObject({
      status: 'error',
      console: [],
      errors: [{ phase: 'syntax', position: { file: 'main.js', line: 2 } }],
    });

    // DOM mode: inline scripts and handlers are strict too.
    const dom = await run(
      page,
      html('<!doctype html>\n<p>x</p>\n<script>\nconst a = 1;\ncount = 2;\n</script>'),
    );
    expect(dom.errors[0]).toMatchObject({
      phase: 'runtime',
      name: 'ReferenceError',
      position: { file: 'index.html', line: 5, column: 7 },
    });
  });

  test('syntax errors come back before anything runs', async ({ page }) => {
    await setup(page);
    const result = await run(page, js('console.log("never");\nlet x = ;'));
    expect(result).toMatchObject({
      status: 'error',
      console: [],
      errors: [{ phase: 'syntax', position: { file: 'main.js', line: 2 } }],
    });
  });

  test('syntax errors carry the browser engine message and position (D-030)', async ({ page }) => {
    const { expectNoLeaks } = await setup(page);
    // CI runs Chromium, so V8's wording is asserted; other engines word these differently.
    const cases: [code: string, message: string, line: number, column: number][] = [
      ['console.log("하나");\nconsole.log("셋";', 'missing ) after argument list', 2, 13],
      ['let x = 1;\nlet y = x x;', "Unexpected identifier 'x'", 2, 11],
      ['const birthYear;', 'Missing initializer in const declaration', 1, 7],
      ['let quizScore = 80;\n90 = quizScore;', 'Invalid left-hand side in assignment', 2, 1],
      ['let food-price = 18000;', "Unexpected token '-'", 1, 9],
      ['console.log("끝);', 'Invalid or unexpected token', 1, 13],
      // Strict-only syntax (D-026) comes from the engine too.
      ['let a = 1;\nlet n = 010;', 'Octal literals are not allowed in strict mode.', 2, 9],
    ];
    for (const [code, message, line, column] of cases) {
      const result = await run(page, js(code));
      expect(result, code).toMatchObject({
        status: 'error',
        console: [],
        errors: [
          {
            phase: 'syntax',
            name: 'SyntaxError',
            message,
            position: { file: 'main.js', line, column },
          },
        ],
      });
      expect(result.errors, code).toHaveLength(1);
    }

    // Every broken file is reported; the working one never runs.
    const files = await run(page, {
      ...js('console.log("main");'),
      files: [
        { path: 'main.js', language: 'js', content: 'console.log("main");' },
        { path: 'a.js', language: 'js', content: '\nif (x {\n}' },
        { path: 'b.js', language: 'js', content: 'function f() {\n  return 1;\n' },
      ],
    });
    expect(files).toMatchObject({
      status: 'error',
      console: [],
      errors: [
        { phase: 'syntax', message: "Unexpected token '{'", position: { file: 'a.js', line: 2 } },
        {
          phase: 'syntax',
          message: 'Unexpected end of input',
          position: { file: 'b.js', line: 3 },
        },
      ],
    });

    // DOM mode: inline scripts map to document lines; handlers to their attribute.
    const dom = await run(
      page,
      html(
        [
          '<!doctype html>',
          '<p>x</p>',
          '<script>',
          'console.log("ran");',
          'console.log("a";',
          '</script>',
          `<button onclick="alert('hi'">x</button>`,
        ].join('\n'),
      ),
    );
    expect(dom).toMatchObject({
      status: 'error',
      console: [],
      errors: [
        {
          phase: 'syntax',
          message: 'missing ) after argument list',
          position: { file: 'index.html', line: 5, column: 13 },
        },
        {
          phase: 'syntax',
          message: 'missing ) after argument list',
          position: { file: 'index.html', line: 7 },
        },
      ],
    });

    // Code around the error never runs: no request leaves the sandbox.
    const leak = await run(
      page,
      js(`fetch("${probe.origin}/syntax");\nnavigator.sendBeacon("/syntax");\nlet = ;`),
    );
    expect(leak.errors).toMatchObject([{ phase: 'syntax', position: { line: 3 } }]);
    await expectNoLeaks();

    // The next valid run works as usual.
    const after = await run(page, js('console.log("ok");'));
    expect(after.status).toBe('completed');
    expect(consoleText(after)).toEqual(['ok']);
  });

  test('a syntax check keeps the last preview on screen (D-030)', async ({ page }) => {
    await setup(page, { placement: 'visible' });
    const preview = (content: string) => ({ ...html(content), mode: 'preview' as const });
    await run(page, preview('<!doctype html><p id="p">미리보기</p>'));
    const broken = await run(page, preview('<!doctype html><script>let = ;</script>'));
    expect(broken.errors).toMatchObject([{ phase: 'syntax', name: 'SyntaxError' }]);
    const shell = page.frameLocator('iframe[title="코드 실행 결과"]');
    await expect(
      shell.frameLocator('iframe[title="학습자 문서"]:visible').locator('#p'),
    ).toHaveText('미리보기');
  });

  test('dialogs never block and read stdin (S20)', async ({ page }) => {
    await setup(page);
    const code = 'alert("a"); console.log(confirm("b"), prompt("c", "def"));';
    const plain = await run(page, js(code));
    expect(plain.console.map((e) => e.level)).toEqual(['alert', 'confirm', 'prompt', 'log']);
    expect(consoleText(plain).at(-1)).toBe('true def');
    const answered = await run(
      page,
      html(`<script>${code}</script>`, { stdin: ['아니오', 'Kim'] }),
    );
    expect(consoleText(answered).at(-1)).toBe('false Kim');
  });

  test('live console events stream during the run', async ({ page }) => {
    await setup(page);
    await run(page, js('console.log(1); setTimeout(() => console.log(2), 50);'));
    const kinds = await page.evaluate(() =>
      (window as unknown as { __events: { kind: string }[] }).__events.map((e) => e.kind),
    );
    expect(kinds).toEqual(expect.arrayContaining(['started', 'console', 'settled']));
  });
});

test.describe('runner: network and isolation', () => {
  test('js-console blocks network APIs and removes EventSource/Worker (S1, S3, S4, S45)', async ({
    page,
  }) => {
    const { appOrigin, expectNoLeaks } = await setup(page);
    const P = probe.origin;
    const result = await run(
      page,
      js(`${ATTACK_PRELUDE}
t('fetch', () => fetch('${P}/s1'));
t('fetchApp', () => fetch('${appOrigin}/api/v1/settings'));
t('xhr', () => { const x = new XMLHttpRequest(); x.open('GET', '${P}/s3'); x.send(); return 'sent'; });
t('ws', () => new WebSocket('${P.replace('http', 'ws')}/s4') && 'created');
t('eventSource', () => typeof EventSource);
t('worker', () => typeof Worker + ',' + typeof SharedWorker);
t('importScripts', () => importScripts('${P}/s-import.js'));
report();`),
    );
    const out = attackReport(result);
    expect(out['fetch']).toMatch(/^blocked/);
    expect(out['fetchApp']).toMatch(/^blocked/);
    // WebSocket construction does not throw in a Worker; the probe check below is what counts.
    expect(out['eventSource']).toBe('ok:undefined');
    expect(out['worker']).toBe('ok:undefined,undefined');
    expect(out['importScripts']).toMatch(/^blocked/);
    await expectNoLeaks();
  });

  test('dom mode blocks every request path (S1–S10, S25, S44, S46)', async ({ page }) => {
    const { appOrigin, expectNoLeaks } = await setup(page);
    const P = probe.origin;
    const result = await run(
      page,
      html(
        `<!doctype html>
<html><head>
<base href="${P}/s44/">
<link rel="stylesheet" href="${P}/s8.css">
<link rel="prefetch" href="${P}/prefetch">
<style>body { background: url(${P}/s9.png); } @font-face { font-family: x; src: url(${P}/font.woff); } p { font-family: x; }</style>
</head><body>
<p>text</p>
<img src="${P}/s7-tag.png"><img src="relative.png">
<iframe src="${P}/s10"></iframe>
<object data="${P}/object"></object>
<script src="${P}/s25.js"></script>
<script>${ATTACK_PRELUDE}
t('fetch', () => fetch('${P}/s1'));
t('fetchApp', () => fetch('${appOrigin}/api/v1/settings'));
t('fetchRelative', () => fetch('/api/v1/settings'));
t('xhr', () => { const x = new XMLHttpRequest(); x.open('GET', '${P}/s3'); x.send(); return 'sent'; });
t('ws', () => new WebSocket('${P.replace('http', 'ws')}/s4') && 'created');
t('eventSource', () => new EventSource('${P}/s5') && 'created');
t('beacon', () => navigator.sendBeacon('${P}/s6', 'd'));
t('image', () => { new Image().src = '${P}/s7'; return 'set'; });
t('import', () => import('${P}/s25-import.js'));
t('worker', () => new Worker(URL.createObjectURL(new Blob(['fetch("${P}/s46")']))) && 'created');
report();
</script></body></html>`,
      ),
    );
    const out = attackReport(result);
    for (const name of ['fetch', 'fetchApp', 'fetchRelative', 'import']) {
      expect(out[name], name).toMatch(/^blocked/);
    }
    // Chromium creates the Worker object and blocks its script (worker-src 'none' in the learner
    // document), and sendBeacon queues before the CSP check, so for those the violations below
    // and the leak check are what count.
    const directives = new Set((await blockedRequests(page)).map((b) => b.directive));
    for (const d of ['connect-src', 'img-src', 'frame-src', 'base-uri', 'worker-src']) {
      expect(directives, d).toContain(d);
    }
    await expectNoLeaks();
  });

  for (const [name, code] of [
    ['location navigation (S11)', '<script>location.href = "APP/api/v1/settings";</script>'],
    ['meta refresh (S12)', '<meta http-equiv="refresh" content="0;url=APP/api/v1/settings">'],
    [
      'form submission (S13)',
      '<form id="f" method="post" action="APP/api/v1/backups/x/restore"><input name="a"></form>' +
        '<script>f.addEventListener("submit", () => console.log("submit handler ran")); f.requestSubmit();</script>',
    ],
  ] as const) {
    test(`nested document cannot navigate: ${name}`, async ({ page }) => {
      const { appOrigin, expectNoLeaks } = await setup(page);
      const result = await run(
        page,
        html(`<!doctype html>${code.replace('APP', appOrigin)}<p>x</p>`),
      );
      if (name.includes('S13')) expect(consoleText(result)).toContain('submit handler ran');
      // Either the browser drops the navigation, or it swaps in an error page, which the
      // harness reports as a NavigationError right away.
      if (result.status !== 'completed') {
        expect(result.status).toBe('error');
        expect(result.errors.map((e) => e.name)).toContain('NavigationError');
      }
      expect(result.durationMs).toBeLessThan(2_000);
      await expectNoLeaks();
    });
  }

  test('cannot reach the app document, storage, top window, popups or downloads (S14–S19, S21–S23)', async ({
    page,
  }) => {
    const { expectNoLeaks } = await setup(page);
    await page.evaluate(() => {
      localStorage.setItem('app-marker', 'app-value');
    });
    const appUrl = page.url();
    let downloads = 0;
    page.on('download', () => downloads++);
    const result = await run(
      page,
      html(`<script>${ATTACK_PRELUDE}
t('parentDocument', () => parent.document.body);
t('topCookie', () => top.document.cookie);
t('parentStorage', () => parent.localStorage.getItem('app-marker'));
t('ownStorage', () => { localStorage.setItem('k', 'v'); return localStorage.getItem('k'); });
t('topNavigation', () => { top.location = 'https://example.com/'; return 'assigned'; });
t('open', () => window.open('https://example.com/'));
t('download', () => { const a = document.createElement('a'); a.href = 'data:text/plain,x'; a.download = 'x.txt'; document.body.appendChild(a); a.click(); return 'clicked'; });
t('clipboard', () => navigator.clipboard ? navigator.clipboard.writeText('x') : 'none');
t('fullscreen', () => document.body.requestFullscreen());
t('serviceWorker', () => navigator.serviceWorker ? navigator.serviceWorker.register('/sw.js') : 'none');
report();
</script>`),
    );
    const out = attackReport(result);
    expect(out['parentDocument']).toBe('blocked:SecurityError');
    expect(out['topCookie']).toBe('blocked:SecurityError');
    expect(out['parentStorage']).toBe('blocked:SecurityError');
    expect(out['ownStorage']).toBe('ok:v'); // the in-memory shim
    expect(out['open']).toBe('ok:null');
    expect(out['clipboard']).toMatch(/^(blocked|ok:none)/);
    expect(out['fullscreen']).toMatch(/^blocked/);
    expect(out['serviceWorker']).toMatch(/^(blocked|ok:none)/);
    expect(page.url()).toBe(appUrl);
    expect(page.context().pages()).toHaveLength(1);
    expect(downloads).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('app-marker'))).toBe('app-value');
    expect(await page.evaluate(() => localStorage.getItem('k'))).toBeNull();
    await expectNoLeaks();
  });

  test('eval, new Function and string timers do not run (S24)', async ({ page }) => {
    await setup(page);
    const code = `${ATTACK_PRELUDE}
t('eval', () => eval('1 + 1'));
t('function', () => new Function('return 1')());
setTimeout('console.log("string timer ran")', 0);
report();`;
    for (const plan of [js(code), html(`<script>${code}</script>`)]) {
      const result = await run(page, plan);
      const out = attackReport(result);
      expect(out['eval']).toBe('blocked:EvalError');
      expect(out['function']).toBe('blocked:EvalError');
      expect(consoleText(result)).not.toContain('string timer ran');
    }
  });

  test('ignores results posted by learner code (S36)', async ({ page }) => {
    await setup(page);
    const fake = {
      v: 1,
      type: 'result',
      status: 'completed',
      observations: [{ op: 'readGlobal', id: 'g#0', status: 'ok', outcome: 'ok' }],
    };
    const result = await run(
      page,
      html(
        `<script>
parent.postMessage(${JSON.stringify(fake)}, '*');
parent.postMessage({ type: 'pg-harness-hello' }, '*');
top.postMessage(${JSON.stringify(fake)}, '*');
console.log('real');
</script>`,
      ),
    );
    expect(result.status).toBe('completed');
    expect(result.observations).toEqual([]);
    expect(consoleText(result)).toEqual(['real']);
  });
});

test.describe('runner: loops, output and integrity', () => {
  test('a js-console infinite loop stops and the app stays responsive (S26)', async ({ page }) => {
    await setup(page);
    await startFrameMonitor(page);
    const guarded = await run(page, js('let n = 0;\nwhile (true) { n++; }'));
    expect(guarded.status).toBe('loop_limit');
    expect(guarded.errors[0]).toMatchObject({
      phase: 'loop_limit',
      position: { file: 'main.js', line: 2, column: 1 },
    });
    // Not instrumentable: an endless microtask chain. The shell terminates the Worker.
    const unguarded = await run(
      page,
      js('function f() { Promise.resolve().then(f); } f();', { limits: { maxDurationMs: 1_000 } }),
    );
    expect(unguarded.status).toBe('timeout');
    expect(await maxFrameGap(page)).toBeLessThan(100);
  });

  test('dom loops stop at the right line (S27–S30)', async ({ page }) => {
    await setup(page);
    const s27 = await run(page, html('<!doctype html>\n<script>\nwhile (true) {}\n</script>'));
    expect(s27.status).toBe('loop_limit');
    expect(s27.errors[0]?.position).toEqual({ file: 'index.html', line: 3, column: 1 });

    const s28 = await run(page, html('<script>setTimeout(() => { for (;;) {} }, 0);</script>'));
    expect(s28.status).toBe('loop_limit');

    const s29 = await run(
      page,
      html('<button onclick="while (1) {}">go</button>', {
        steps: [{ op: 'dispatch', id: 'ev#s0', selector: 'button', event: 'click' }],
      }),
    );
    expect(s29.status).toBe('loop_limit');

    for (const loop of [
      'do {} while (true);',
      'function* g() { while (true) yield 1; } for (const x of g()) {}',
      'outer: for (;;) { inner: for (;;) { continue outer; } }',
      'try { while (true) {} } catch (e) { while (true) {} }',
    ]) {
      const r = await run(page, html(`<script>${loop}</script>`));
      expect(r.status, loop).toBe('loop_limit');
    }
  });

  test('infinite recursion reports a RangeError (S31)', async ({ page }) => {
    await setup(page);
    const code = 'function f() { f(); }\nf();';
    for (const plan of [js(code), html(`<script>${code}</script>`)]) {
      const r = await run(page, plan);
      expect(r.status).toBe('error');
      expect(r.errors[0]?.name).toBe('RangeError');
    }
  });

  test('console floods are capped and long strings cut (S34, S35)', async ({ page }) => {
    await setup(page);
    await startFrameMonitor(page);
    const flood = 'for (let i = 0; i < 1e6; i++) console.log(i);';
    for (const plan of [js(flood), html(`<script>${flood}</script>`)]) {
      const r = await run(page, plan);
      expect(r.status).toBe('completed');
      expect(r.console).toHaveLength(1_000);
      expect(r.droppedConsoleEntries).toBe(999_000);
      expect(r.consoleTruncated).toBe(true);
    }
    expect(await maxFrameGap(page)).toBeLessThan(100);
    const long = await run(page, js('console.log("x".repeat(1e7));'));
    expect(long.console[0]?.args[0]).toEqual({
      t: 'string',
      v: 'x'.repeat(8_000),
      truncated: true,
    });
  });

  test('observations survive learner changes to built-ins and __pg (S37–S39)', async ({ page }) => {
    await setup(page);
    const code = [
      'function add(a, b) { return a + b; }',
      'Array.prototype.push = () => 0;',
      'JSON.stringify = () => "{}";',
      'Object.keys = () => [];',
      'MessagePort.prototype.postMessage = function () {};',
      // Strict mode (D-026): writing the read-only __pg throws instead of being ignored.
      'try { globalThis.__pg = null; } catch (e) { console.log("write", e.name); }',
      'try { delete globalThis.__pg; } catch (e) {}',
      'console.log("pg", typeof __pg);',
    ].join('\n');
    const steps = [
      { op: 'callFunction' as const, id: 'add#0', name: 'add', args: [num(2), num(3)] },
      { op: 'readGlobal' as const, id: 'add#1', name: 'add' },
    ];
    for (const plan of [js(code, { steps }), html(`<script>${code}</script>`, { steps })]) {
      const r = await run(page, plan);
      expect(r.status).toBe('completed');
      expect(consoleText(r)).toEqual(['write TypeError', 'pg object']);
      const [call, read] = payloads(r);
      expect(call).toEqual({ outcome: 'returned', value: num(5), returnIsArg: [] });
      expect(read).toMatchObject({ outcome: 'ok', value: { t: 'function' } });
    }
    // The loop guard still works after the overwrite attempt.
    const loop = await run(
      page,
      js('try { globalThis.__pg = null; } catch (e) {}\nwhile (true) {}'),
    );
    expect(loop.status).toBe('loop_limit');
  });

  test('unhandled rejections and pending intervals are reported (S40, S41)', async ({ page }) => {
    await setup(page);
    for (const plan of [
      js('Promise.reject(new Error("x"));'),
      html('<script>Promise.reject(new Error("x"));</script>'),
    ]) {
      const r = await run(page, plan);
      expect(r.status).toBe('error');
      expect(r.errors[0]).toMatchObject({ phase: 'unhandled_rejection', message: 'x' });
    }
    const interval = 'setInterval(() => console.log(1), 10);';
    for (const plan of [js(interval), html(`<script>${interval}</script>`)]) {
      const r = await run(page, { ...plan, purpose: 'grading', limits: { maxDurationMs: 1_500 } });
      expect(r.status).toBe('completed');
      expect(r.pendingAtEnd.intervals).toBe(1);
      expect(r.console.length).toBeGreaterThan(10);
    }
  });

  test('oversized plans are rejected before reaching the shell (S43)', async ({ page }) => {
    await setup(page);
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `f${i}.js`,
      language: 'js' as const,
      content: 'x'.repeat(200_001),
    }));
    await expect(run(page, { ...js(''), files, entry: 'f0.js' })).rejects.toThrow();
  });
});

test.describe('runner: shell lifecycle', () => {
  test('a stuck shell is replaced on a new site and the next run works (S48)', async ({ page }) => {
    await setup(page);
    await startFrameMonitor(page);
    const before = (await hostStats(page)).shellsCreated;
    const stuck = await run(
      page,
      html('<script>function f() { Promise.resolve().then(f); } f();</script>', {
        limits: { maxDurationMs: 1_000 },
      }),
    );
    expect(['crashed', 'timeout']).toContain(stuck.status);
    const started = Date.now();
    const next = await run(page, js('console.log("alive")'));
    expect(next.status).toBe('completed');
    expect(consoleText(next)).toEqual(['alive']);
    expect(Date.now() - started).toBeLessThan(3_000);
    if (stuck.status === 'crashed') expect((await hostStats(page)).shellsCreated).toBe(before + 1);
    expect(await maxFrameGap(page)).toBeLessThan(200);
  });

  test('per-shell sites are used, and the same-site shell is the fallback', async ({ page }) => {
    await setup(page);
    expect(await hostStats(page)).toEqual({ shellsCreated: 1, usingFallback: false });
    const shellFrame = page.frames().find((f) => f.url().includes('/sandbox/runner.html'));
    expect(shellFrame?.url()).toMatch(/^http:\/\/[a-z0-9]+\.localhost:\d+\/sandbox\/runner\.html/);

    const other = await page.context().newPage();
    // Simulate a browser that does not resolve *.localhost.
    await other.route(
      (url) => url.hostname.endsWith('.localhost'),
      (route) => route.abort(),
    );
    await openRunner(other, { helloTimeoutMs: 1_000 });
    expect(await hostStats(other)).toEqual({ shellsCreated: 2, usingFallback: true });
    const r = await run(other, js('console.log("fallback")'));
    expect(consoleText(r)).toEqual(['fallback']);
    await other.close();
  });

  test('the hidden grading shell keeps timers and layout working (S47)', async ({ page }) => {
    await setup(page, { placement: 'hidden' });
    const r = await run(
      page,
      html(
        '<div id="d" style="width: 50%">x</div><script>setTimeout(() => { d.textContent = "later"; }, 100);</script>',
        {
          purpose: 'grading',
          viewport: { width: 1000, height: 700 },
          steps: [
            { op: 'waitSettled', id: 'settle', maxMs: 3_000 },
            { op: 'domQuery', id: 'd#q', selector: '#d', read: ['text'] },
            { op: 'boxRect', id: 'd#0', selectors: ['#d'] },
          ],
        },
      ),
    );
    const [settled, text, box] = payloads(r);
    expect(settled).toEqual({ settled: true });
    expect(text).toEqual({ count: 1, items: [{ text: 'later' }] });
    expect(box).toMatchObject({ rects: [{ selector: '#d', count: 1, rect: { width: 492 } }] });
  });
});
