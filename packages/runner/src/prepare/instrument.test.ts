import { describe, expect, it } from 'vitest';
import { instrumentJs, originalColumn } from './instrument.ts';

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
