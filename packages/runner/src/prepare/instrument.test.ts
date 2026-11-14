import { describe, expect, it } from 'vitest';
import { instrumentJs, originalColumn, STRICT_PREFIX } from './instrument.ts';

function ok(code: string, options?: Parameters<typeof instrumentJs>[1]) {
  const r = instrumentJs(code, options);
  if (!r.ok) throw new Error(`unexpected syntax error: ${r.error.message}`);
  return r;
}

describe('instrumentJs', () => {
  it.each([
    ['while', 'while (true) { x++; }'],
    ['for', 'for (let i = 0; ; i++) { x++; }'],
    ['do-while', 'do { x++; } while (true);'],
    ['for-in', 'for (const k in o) { x++; }'],
    ['for-of', 'for (const v of gen()) { x++; }'],
  ])('guards a %s loop', (_, code) => {
    const r = ok(code);
    expect(r.loops).toBe(1);
    expect(r.code).toMatch(/^\{let __pgL1=__pg\.enter\(0,1,0\);/);
    expect(r.code).toContain('{__pg.tick(__pgL1); x++;');
    expect(r.code.endsWith('}')).toBe(true);
  });

  it('wraps a body that is not a block', () => {
    const r = ok('while (x) x--;');
    expect(r.code).toBe('{let __pgL1=__pg.enter(0,1,0);while (x) {__pg.tick(__pgL1);x--;}}');
  });

  it('keeps labels attached to their loop', () => {
    const r = ok('outer: for (;;) { inner: for (;;) { continue outer; } }');
    expect(r.code.startsWith('{let __pgL1=__pg.enter(0,1,7);outer: for')).toBe(true);
    expect(r.code).toContain('{let __pgL2=__pg.enter(0,1,25);inner: for');
    // Still valid JavaScript.
    expect(instrumentJs(r.code).ok).toBe(true);
  });

  it('handles nested loops without blocks and loops inside async/generator functions', () => {
    for (const code of [
      'for (;;) for (;;) x++;',
      'async function f() { for await (const x of s) {} }',
      'function* g() { while (true) yield 1; }',
      'if (a) while (b) {} else do {} while (c)',
    ]) {
      const r = ok(code);
      expect(instrumentJs(r.code).ok, code).toBe(true);
      expect(r.code.split('__pg.tick(').length - 1).toBe(r.loops);
    }
  });

  it('never adds a line, so line numbers stay the same', () => {
    const code = 'let n = 0;\nwhile (n < 3) {\n  n++;\n}\nfor (;;)\n  break;\n';
    const r = ok(code);
    expect(r.code.split('\n')).toHaveLength(code.split('\n').length);
    expect(r.code.split('\n')[2]).toBe('  n++;');
    expect(r.code).toContain('__pg.enter(0,2,0)');
    expect(r.code).toContain('__pg.enter(0,5,0)');
  });

  it('puts the source id into the guard', () => {
    expect(ok('while(1){}', { sourceId: 7 }).code).toContain('__pg.enter(7,1,0)');
  });

  it('allows return in inline handlers only when asked', () => {
    expect(instrumentJs('return false').ok).toBe(false);
    expect(instrumentJs('return false', { handler: true }).ok).toBe(true);
  });

  it('reports syntax errors with 1-based positions and without acorn location suffix', () => {
    const r = instrumentJs('let a = 1;\nlet b = ;');
    expect(r).toEqual({
      ok: false,
      error: { message: 'Unexpected token', line: 2, column: 9 },
    });
  });

  it('leaves code without loops untouched', () => {
    const r = ok('console.log("hi");');
    expect(r).toMatchObject({ code: 'console.log("hi");', loops: 0, insertions: [] });
  });
});

describe('originalColumn', () => {
  it('maps instrumented columns back to the original line', () => {
    const code = 'let a = 1; while (a) { a = b.c; }';
    const r = ok(code);
    const line = r.code;
    // `b.c` in the instrumented code → `b.c` in the original.
    const instrumentedCol = line.indexOf('b.c') + 1;
    expect(originalColumn(r.insertions, 1, instrumentedCol)).toBe(code.indexOf('b.c') + 1);
    // Before any insertion nothing moves.
    expect(originalColumn(r.insertions, 1, 5)).toBe(5);
    // Other lines are not affected.
    expect(originalColumn(r.insertions, 2, 9)).toBe(9);
  });

  it('maps a column inside guard text to where it was inserted', () => {
    const r = ok('x; while (a) {}');
    expect(originalColumn(r.insertions, 1, 6)).toBe(4);
  });
});

describe('instrumentJs strict mode (D-026)', () => {
  it('prepends the directive on line 1 without adding a line', () => {
    const code = 'x = 1;\nlet y = 2;\n';
    const r = ok(code, { strict: true });
    expect(r.code).toBe(`${STRICT_PREFIX}${code}`);
    expect(r.code.split('\n')).toHaveLength(code.split('\n').length);
    expect(r.insertions[0]).toEqual({ line: 1, column: 0, length: STRICT_PREFIX.length });
  });

  it('maps line-1 columns back past the prefix', () => {
    const r = ok('let a = b;', { strict: true });
    const col = r.code.indexOf('b;') + 1;
    expect(originalColumn(r.insertions, 1, col)).toBe(9);
    // Inside the prefix maps to the start of the line.
    expect(originalColumn(r.insertions, 1, 3)).toBe(1);
    // Other lines are untouched.
    const r2 = ok('let a;\na = b;', { strict: true });
    expect(originalColumn(r2.insertions, 2, 5)).toBe(5);
  });

  it('keeps the directive in front of a loop guard at the very start', () => {
    const r = ok('while (x) x--;', { strict: true });
    expect(r.code).toBe(
      `${STRICT_PREFIX}{let __pgL1=__pg.enter(0,1,0);while (x) {__pg.tick(__pgL1);x--;}}`,
    );
    const nested = ok('let n = 0;\nfor (;;) { n++; }', { strict: true });
    expect(nested.code).toContain('__pg.enter(0,2,0)');
    expect(instrumentJs(nested.code).ok).toBe(true);
  });

  it('reports strict-only syntax errors at learner positions', () => {
    const withStmt = instrumentJs('with (o) { x; }', { strict: true });
    expect(withStmt).toMatchObject({ ok: false, error: { line: 1, column: 1 } });
    const octal = instrumentJs('let a = 1;\nlet b = 010;', { strict: true });
    expect(octal).toMatchObject({ ok: false, error: { line: 2, column: 9 } });
    const dupParams = instrumentJs('function f(a, a) {}', { strict: true });
    expect(dupParams.ok).toBe(false);
    if (!dupParams.ok) expect(dupParams.error.column).toBeLessThanOrEqual(20);
    // Sloppy parsing (strict off) still accepts them.
    expect(instrumentJs('with (o) { x; }').ok).toBe(true);
  });

  it('accepts handler bodies with return', () => {
    const r = ok('return false;', { strict: true, handler: true });
    expect(r.code).toBe(`${STRICT_PREFIX}return false;`);
  });
});
