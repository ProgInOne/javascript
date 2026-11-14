import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { CheckBundle, ObservationStep, RunPlan } from '@proginone/shared';
import { runnablePlanSchema } from '../protocol/messages.ts';
import { ArgsExprError, exposedNames, exposeScript } from './expose.ts';

const bundle = (expose: string[], steps: ObservationStep[] = []): CheckBundle => ({
  v: 1,
  expose,
  steps,
});

const plan = (overrides: Partial<RunPlan>): RunPlan =>
  runnablePlanSchema.parse({
    v: 1,
    mode: 'js-console',
    purpose: 'grading',
    files: [],
    entry: 'main.js',
    timers: 'real',
    checks: bundle([]),
    ...overrides,
  });
import { prepareHtml } from './html.ts';
import {
  mapErrors,
  mapPosition,
  nativeSyntaxErrors,
  prepareRun,
  STRICT_PREFIX,
  syntaxCheckScript,
} from './index.ts';

describe('exposeScript', () => {
  type Reader = () => { s: number; v?: unknown };

  /** Runs `before`, the expose script and `after` in one global scope (test only). */
  function expose(before: string, names: string[], after = '') {
    const script = exposeScript(bundle(names));
    if (!script) throw new Error('no script');
    let readers: Record<string, Reader> = {};
    const context = {
      __pg: {
        expose: (o: Record<string, Reader>) => {
          readers = o;
        },
      },
    };
    runInNewContext(`${before}\n${script}\n${after}`, context);
    return (name: string) => readers[name]?.();
  }

  it('hands over top-level let/const/class/function bindings', () => {
    const read = expose('let a = 1; const b = [2]; class C {} function f() { return 3; }', [
      'a',
      'b',
      'C',
      'f',
    ]);
    expect(read('a')).toEqual({ s: 0, v: 1 });
    expect(read('b')).toEqual({ s: 0, v: [2] });
    expect(typeof read('C')?.v).toBe('function');
    expect(typeof read('f')?.v).toBe('function');
  });

  it('reads the current value, not the value at expose time', () => {
    const read = expose('let count = 0;', ['count'], 'count = 5;');
    expect(read('count')).toEqual({ s: 0, v: 5 });
  });

  it('tells missing, declared-but-undefined and TDZ bindings apart', () => {
    const read = expose('let u;', ['u', 'nope']);
    expect(read('u')).toEqual({ s: 0, v: undefined });
    expect(read('nope')).toEqual({ s: 1 });
    // Expose script before `let late = 1;` runs: read during the TDZ, not after.
    const script = exposeScript(bundle(['late'])) ?? '';
    let during: unknown;
    runInNewContext(`${script}\nlet late = 1;`, {
      __pg: {
        expose: (o: Record<string, Reader>) => {
          during = o['late']?.();
        },
      },
    });
    expect(during).toEqual({ s: 2 });
  });

  it('is not confused by learner bindings named like its helpers', () => {
    const read = expose('let o = "mine"; let e = "err";', ['o', 'e']);
    expect(read('o')).toEqual({ s: 0, v: 'mine' });
    expect(read('e')).toEqual({ s: 0, v: 'err' });
  });

  it('skips reserved words and invalid names', () => {
    expect(exposeScript(bundle(['class', 'arguments']))).toBeNull();
    expect(exposeScript(bundle(['ok', 'typeof']))).not.toContain('typeof typeof');
  });

  it('collects names from the bundle and from callFunction/readGlobal steps once', () => {
    const names = exposedNames(
      bundle(
        ['add'],
        [
          { op: 'callFunction', id: 'c1#0', name: 'add', args: [] },
          { op: 'readGlobal', id: 'p#0', name: 'total' },
          { op: 'consoleOutput', id: 'k#0' },
        ],
      ),
    );
    expect(names).toEqual(['add', 'total']);
  });

  it('turns argsExpr into fresh argument arrays per call', () => {
    const script =
      exposeScript(
        bundle(
          ['f'],
          [{ op: 'callFunction', id: 'c#0', name: 'f', args: [], argsExpr: '[new Map([[1, 2]])]' }],
        ),
      ) ?? '';
    let argReaders: Record<string, () => unknown> = {};
    runInNewContext(`function f() {}\n${script}`, {
      __pg: {
        expose: (_o: unknown, a: Record<string, () => unknown>) => {
          argReaders = a;
        },
      },
    });
    const first = argReaders['c#0']?.() as Map<number, number>[];
    expect(first[0]?.get(1)).toBe(2);
    expect(argReaders['c#0']?.()).not.toBe(first);
  });

  it('refuses an argsExpr that is more than one expression', () => {
    const step = (argsExpr: string): ObservationStep => ({
      op: 'callFunction',
      id: 'c#0',
      name: 'f',
      args: [],
      argsExpr,
    });
    expect(() => exposeScript(bundle([], [step('[1]; }); alert(1); (function(){')]))).toThrow(
      ArgsExprError,
    );
    expect(() => exposeScript(bundle([], [step('[1, 2]')]))).not.toThrow();
  });
});

describe('prepareHtml', () => {
  const page = [
    '<!doctype html>',
    '<html><body>',
    '<button onclick="while (true) {}">go</button>',
    '<script>',
    'let n = 0;',
    'for (;;) { n++; }',
    '</script>',
    '<script type="application/json">{"for": 1}</script>',
    '<script src="app.js"></script>',
    '<p>end</p>',
    '</body></html>',
  ].join('\n');

  it('replaces inline script bodies with blob delivery calls and keeps every line', () => {
    const r = prepareHtml(page, { file: 'index.html', expose: null });
    if (!r.ok) throw new Error('unexpected error');
    expect(r.document.split('\n')).toHaveLength(page.split('\n').length);
    expect(r.document).toContain('<script>__pg.w(0)\n\n\n</script>');
    expect(r.scripts).toHaveLength(1);
    expect(r.scripts[0]?.code).toContain('__pg.tick(');
    // Data blocks and external scripts are left alone.
    expect(r.document).toContain('<script type="application/json">{"for": 1}</script>');
    expect(r.document).toContain('<script src="app.js"></script>');
  });

  it('instruments inline handlers in place', () => {
    const r = prepareHtml(page, { file: 'index.html', expose: null });
    if (!r.ok) throw new Error('unexpected error');
    expect(r.document).toMatch(
      /onclick="'use strict';\{let __pgL1=__pg\.enter\(0,1,0\);while \(true\)/,
    );
    // Source 0 is the handler (line 3), source 1 the script body (starts on line 4).
    expect(r.sources[0]).toMatchObject({ file: 'index.html', line: 3 });
    expect(r.sources[1]).toMatchObject({ file: 'index.html', line: 4, column: 8 });
    expect(r.scripts[0]?.id).toBe(1);
  });

  it('inserts the harness right after the doctype and appends the expose script', () => {
    const r = prepareHtml(page, { file: 'index.html', expose: '__pg.expose({});' });
    if (!r.ok) throw new Error('unexpected error');
    expect(r.document.slice(0, r.harnessAt)).toBe('<!doctype html>');
    expect(r.document.endsWith('<script>__pg.expose({});</script>')).toBe(true);
  });

  it('inserts the harness at the start without a doctype', () => {
    const r = prepareHtml('<p>x</p>', { file: 'index.html', expose: null });
    expect(r.ok && r.harnessAt).toBe(0);
  });

  it('maps syntax errors in scripts to document positions', () => {
    const r = prepareHtml('<!doctype html>\n<p>\n<script>let a = 1;\nlet = ;</script>', {
      file: 'index.html',
      expose: null,
    });
    expect(r).toMatchObject({
      ok: false,
      errors: [{ file: 'index.html', line: 4, message: expect.any(String) as string }],
    });
  });

  it('refuses module scripts', () => {
    const r = prepareHtml('<script type="module">import x from "y";</script>', {
      file: 'index.html',
      expose: null,
    });
    expect(r.ok).toBe(false);
  });
});

describe('prepareRun and position mapping', () => {
  it('returns syntax errors for js-console without running', () => {
    const r = prepareRun(
      plan({
        files: [
          { path: 'main.js', language: 'js', content: 'let a = 1;' },
          { path: 'bad.js', language: 'js', content: '\n\nif (' },
        ],
      }),
    );
    expect(r).toMatchObject({
      ok: false,
      errors: [{ phase: 'syntax', name: 'SyntaxError', position: { file: 'bad.js', line: 3 } }],
    });
  });

  it('prepares js files entry first, one source each', () => {
    const r = prepareRun(
      plan({
        files: [
          { path: 'a.js', language: 'js', content: 'while (x) x--;' },
          { path: 'style.css', language: 'css', content: 'p{}' },
          { path: 'main.js', language: 'js', content: 'var x = 1;' },
        ],
        checks: bundle([], [{ op: 'readGlobal', id: 'p#0', name: 'x' }]),
      }),
    );
    if (!r.ok) throw new Error('unexpected error');
    expect(r.prepared.code.scripts.map((s) => s.id)).toEqual([0, 1]);
    expect(r.prepared.code.scripts[1]?.code).toContain('__pg.enter(1,1,0)');
    expect(r.prepared.code.expose).toContain('return{s:0,v:x}');
    expect(r.prepared.sources.map((s) => s.file)).toEqual(['main.js', 'a.js']);
  });

  it('maps instrumented and original positions back to the file', () => {
    const p = plan({
      mode: 'dom',
      entry: 'index.html',
      files: [
        {
          path: 'index.html',
          language: 'html',
          content: '<!doctype html>\n<script>\nwhile (a) { b.c; }\n</script>',
        },
      ],
    });
    const r = prepareRun(p);
    if (!r.ok) throw new Error('unexpected error');
    const { sources } = r.prepared;
    const instrumented = r.prepared.code.scripts[0]?.code.split('\n')[1] ?? '';
    // Script line 2 is document line 3.
    expect(
      mapPosition(
        { file: 'src:0', line: 2, column: instrumented.indexOf('b.c') + 1 },
        sources,
        'index.html',
      ),
    ).toEqual({ file: 'index.html', line: 3, column: 13 });
    expect(mapPosition({ file: 'orig:0', line: 2, column: 1 }, sources, 'index.html')).toEqual({
      file: 'index.html',
      line: 3,
      column: 1,
    });
    // Unknown files (e.g. inline handlers reported against the document) keep only the line.
    expect(
      mapPosition({ file: 'about:srcdoc', line: 9, column: 4 }, sources, 'index.html'),
    ).toEqual({ file: 'index.html', line: 9 });
    const [mapped] = mapErrors(
      [
        {
          phase: 'runtime',
          name: 'TypeError',
          message: 'x',
          position: { file: 'src:0', line: 1, column: 1 },
          stack: [{ file: 'src:0', line: 1, column: 1 }],
        },
      ],
      sources,
      'index.html',
    );
    expect(mapped?.position).toEqual({ file: 'index.html', line: 2, column: 9 });
    expect(mapped?.stack).toEqual([{ file: 'index.html', line: 2, column: 9 }]);
  });
});

describe('engine syntax check (D-030)', () => {
  const engineError = (file: string, line: number, column: number, message: string) => ({
    phase: 'runtime' as const,
    name: 'SyntaxError',
    message,
    position: { file, line, column },
  });

  it('never runs learner code, even if the engine accepts it', () => {
    const script = syntaxCheckScript('globalThis.ran = true;', { strict: true });
    const handler = syntaxCheckScript('globalThis.ran = true; return false', {
      handler: true,
      strict: true,
    });
    for (const s of [script, handler]) {
      const context: { ran?: boolean } = {};
      expect(() => {
        runInNewContext(s.code, context);
      }).toThrow();
      expect(context.ran).toBeUndefined();
    }
    expect(script.code.startsWith(`${STRICT_PREFIX}throw 0;`)).toBe(true);
    // Line 1 text in front of learner code is one insertion; no line is added in front.
    expect(script.insertions).toEqual([
      { line: 1, column: 0, length: `${STRICT_PREFIX}throw 0;`.length },
    ]);
    expect(syntaxCheckScript('a\nb\n').lines).toBe(3);
  });

  it('builds a check for every broken js-console file, nothing else', () => {
    const r = prepareRun(
      plan({
        files: [
          { path: 'main.js', language: 'js', content: 'console.log(1);' },
          { path: 'bad.js', language: 'js', content: '\n\nif (' },
          { path: 'worse.js', language: 'js', content: "console.log('hi'" },
        ],
      }),
    );
    if (r.ok) throw new Error('expected syntax errors');
    expect(r.errors.map((e) => e.position?.file)).toEqual(['bad.js', 'worse.js']);
    const check = r.syntaxCheck;
    if (!check) throw new Error('expected a syntax check');
    expect(check.code.scripts.map((s) => s.id)).toEqual([0, 1]);
    expect(check.code.scripts[1]?.code).toBe(`${STRICT_PREFIX}throw 0;console.log('hi'`);
    expect(check.code.document).toBe(
      '<!doctype html><script>__pg.w(0)</script><script>__pg.w(1)</script>',
    );
    expect(check.code.harnessAt).toBe('<!doctype html>'.length);
    expect(check.targets.map((t) => t.errorIndex)).toEqual([0, 1]);
  });

  it("replaces the pre-parser's errors with the engine's, mapped to learner files", () => {
    const r = prepareRun(
      plan({
        files: [
          { path: 'main.js', language: 'js', content: 'let x = 1;\nlet y = x x;' },
          { path: 'b.js', language: 'js', content: "console.log('hi'" },
        ],
      }),
    );
    if (r.ok || !r.syntaxCheck) throw new Error('expected a syntax check');
    const shift = `${STRICT_PREFIX}throw 0;`.length;
    const errors = nativeSyntaxErrors(r.errors, r.syntaxCheck, {
      errors: [
        // The `throw 0` sentinel of an accepted script and unrelated errors are ignored.
        { phase: 'runtime', name: 'Error', message: '0', position: { file: 'src:1', line: 1 } },
        engineError('src:0', 2, 11, "Unexpected identifier 'x'"),
        engineError('src:1', 1, shift + 13, 'missing ) after argument list'),
      ],
    });
    expect(errors).toEqual([
      {
        phase: 'syntax',
        name: 'SyntaxError',
        message: "Unexpected identifier 'x'",
        position: { file: 'main.js', line: 2, column: 11 },
      },
      {
        phase: 'syntax',
        name: 'SyntaxError',
        message: 'missing ) after argument list',
        position: { file: 'b.js', line: 1, column: 13 },
      },
    ]);
  });

  it("keeps the pre-parser's error when the engine reports none", () => {
    const r = prepareRun(
      plan({ files: [{ path: 'main.js', language: 'js', content: 'let x = ;' }] }),
    );
    if (r.ok || !r.syntaxCheck) throw new Error('expected a syntax check');
    // e.g. the check timed out, or the engine accepted the code and hit the sentinel.
    expect(nativeSyntaxErrors(r.errors, r.syntaxCheck, { errors: [] })).toEqual(r.errors);
    const sentinel = nativeSyntaxErrors(r.errors, r.syntaxCheck, {
      errors: [
        {
          phase: 'runtime',
          name: 'Error',
          message: '0',
          position: { file: 'src:0', line: 1, column: 14 },
        },
      ],
    });
    expect(sentinel).toEqual(r.errors);
  });

  it('maps DOM inline scripts and handlers, and keeps unsupported-feature errors', () => {
    const content = [
      '<!doctype html>',
      '<script type="module">import x from "y";</script>',
      '<script>',
      'console.log("a";',
      '</script>',
      `<button onclick="alert('hi'">x</button>`,
    ].join('\n');
    const r = prepareRun(
      plan({
        mode: 'dom',
        entry: 'index.html',
        files: [{ path: 'index.html', language: 'html', content }],
      }),
    );
    if (r.ok || !r.syntaxCheck) throw new Error('expected a syntax check');
    expect(r.errors).toHaveLength(3);
    const check = r.syntaxCheck;
    expect(check.targets.map((t) => t.errorIndex)).toEqual([1, 2]);
    expect(check.code.scripts[1]?.code).toBe(
      `throw 0;(function(event){${STRICT_PREFIX}alert('hi'\n});`,
    );
    const errors = nativeSyntaxErrors(r.errors, check, {
      errors: [
        // Script line 2 is document line 4.
        engineError('src:0', 2, 13, 'missing ) after argument list'),
        // Reported in the handler wrapper's closing line: clamped to the value, column dropped.
        engineError('src:1', 2, 1, 'missing ) after argument list'),
      ],
    });
    expect(errors[0]).toEqual(r.errors[0]);
    expect(errors[1]).toMatchObject({
      message: 'missing ) after argument list',
      position: { file: 'index.html', line: 4, column: 13 },
    });
    expect(errors[2]).toEqual({
      phase: 'syntax',
      name: 'SyntaxError',
      message: 'missing ) after argument list',
      position: { file: 'index.html', line: 6 },
    });
  });

  it('maps a handler error inside the value to its column, and drops WebKit column 0', () => {
    const r = prepareRun(
      plan({
        mode: 'dom',
        entry: 'index.html',
        files: [{ path: 'index.html', language: 'html', content: '<p onclick="let = 1">x</p>' }],
      }),
    );
    if (r.ok || !r.syntaxCheck) throw new Error('expected a syntax check');
    const prefix = `throw 0;(function(event){${STRICT_PREFIX}`.length;
    const [inValue] = nativeSyntaxErrors(r.errors, r.syntaxCheck, {
      errors: [engineError('src:0', 1, prefix + 5, "Unexpected token '='")],
    });
    // The value starts at column 13 (`<p onclick="` is 12 characters).
    expect(inValue?.position).toEqual({ file: 'index.html', line: 1, column: 17 });
    const [noColumn] = nativeSyntaxErrors(r.errors, r.syntaxCheck, {
      errors: [engineError('src:0', 1, 0, 'Unexpected token')],
    });
    expect(noColumn?.position).toEqual({ file: 'index.html', line: 1 });
  });

  it('builds no check when no learner JavaScript failed to parse', () => {
    const r = prepareRun(
      plan({
        mode: 'dom',
        entry: 'index.html',
        files: [
          { path: 'index.html', language: 'html', content: '<script type="module"></script>' },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty('syntaxCheck');
  });
});
