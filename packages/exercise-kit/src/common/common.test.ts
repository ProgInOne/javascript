import type { SerializedValue } from '@proginone/shared';
import { describe, expect, it } from 'vitest';

import { LITERAL_MAX_LENGTH, parseLiteral } from './literal.ts';
import {
  normalizeBlankText,
  normalizeOutputLines,
  toHalfWidth,
  unifySmartQuotes,
  unquoteLiteral,
} from './normalize.ts';
import { compareOutput, outputLineEquals } from './output.ts';
import { createRng, deriveSeed, seedFromString, splitmix64, xoshiro128ss } from './prng.ts';
import { diffValues, fromJson, valuesEqual } from './values.ts';

const lit = (text: string): SerializedValue => {
  const value = parseLiteral(text);
  if (value === null) throw new Error(`not a literal: ${text}`);
  return value;
};

describe('parseLiteral', () => {
  it.each([
    ['5', { t: 'number', v: 5 }],
    ['-0', { t: 'number', v: '-0' }],
    ['-Infinity', { t: 'number', v: '-Infinity' }],
    ['NaN', { t: 'number', v: 'NaN' }],
    ['0x1f', { t: 'number', v: 31 }],
    ['1.5e2', { t: 'number', v: 150 }],
    ['12n', { t: 'bigint', v: '12' }],
    ['"a\\nb"', { t: 'string', v: 'a\nb' }],
    ["'\\u{1F600}'", { t: 'string', v: '😀' }],
    ['`x`', { t: 'string', v: 'x' }],
    ['undefined', { t: 'undefined' }],
    ['true', { t: 'boolean', v: true }],
  ])('parses %s', (text, expected) => {
    expect(parseLiteral(text)).toEqual(expected);
  });

  it('parses nested arrays, objects, class-prefixed objects, Map and Set', () => {
    expect(lit("[1, 'a', [true],]")).toEqual({
      t: 'array',
      length: 3,
      items: [
        { t: 'number', v: 1 },
        { t: 'string', v: 'a' },
        { t: 'array', length: 1, items: [{ t: 'boolean', v: true }] },
      ],
    });
    expect(lit('{ a: 1, "b c": null, 2: [] }')).toMatchObject({
      t: 'object',
      className: 'Object',
      entries: [
        ['a', { t: 'number', v: 1 }],
        ['b c', { t: 'null' }],
        ['2', expect.anything()],
      ],
    });
    expect(lit('Point { x: 1 }')).toMatchObject({ t: 'object', className: 'Point' });
    expect(lit('Map(1) { "a" => 1 }')).toMatchObject({ t: 'map', size: 1 });
    expect(lit('Set(2) { 1, 2 }')).toMatchObject({ t: 'set', size: 2 });
  });

  it.each([
    'hello',
    'a + b',
    '[1,,2]',
    '`${x}`',
    '"unterminated',
    'alert(1)',
    '{ a }',
    '1 2',
    'constructor',
    '__proto__',
    '',
    '[',
  ])('rejects non-literal %j', (text) => {
    expect(parseLiteral(text)).toBeNull();
  });

  it('rejects hostile input without throwing', () => {
    expect(parseLiteral('['.repeat(10_000))).toBeNull();
    expect(parseLiteral('[1]'.padEnd(LITERAL_MAX_LENGTH + 1, ' '))).toBeNull();
    expect(parseLiteral(`[${'0,'.repeat(9_000)}]`)).not.toBeNull();
    expect(parseLiteral(`[${'0,'.repeat(10_001)}]`)).toBeNull();
  });
});

describe('value comparison', () => {
  it('ignores key order and treats +0/-0 as equal unless strict', () => {
    expect(valuesEqual(lit('{ a: 1, b: 2 }'), lit('{ b: 2, a: 1 }'))).toBe(true);
    expect(valuesEqual(lit('0'), lit('-0'))).toBe(true);
    expect(valuesEqual(lit('0'), lit('-0'), { strict: true })).toBe(false);
    expect(valuesEqual(lit('NaN'), lit('NaN'))).toBe(true);
  });

  it('distinguishes types ("5" vs 5) and compares Map/Set by content', () => {
    expect(valuesEqual(lit('"5"'), lit('5'))).toBe(false);
    expect(valuesEqual(lit('Set { 1, 2 }'), lit('Set { 2, 1 }'))).toBe(true);
    expect(valuesEqual(lit('Map { 1 => "a" }'), lit('Map { 1 => "b" }'))).toBe(false);
  });

  it('reports the first differing path', () => {
    const expected = fromJson([{ price: 100 }, { price: 300 }]);
    const actual = lit('[{ price: 100 }, { price: "300" }]');
    expect(diffValues(expected, actual)).toEqual({
      path: '[1].price',
      expected: '300',
      actual: '"300"',
      reason: 'MISMATCH',
    });
    expect(diffValues(fromJson({ a: 1 }), lit('{}'))?.path).toBe('.a');
    expect(diffValues(fromJson([1]), lit('[1, 2]'))?.path).toBe('.length');
  });

  it('never equates functions, circular, truncated or unserializable values', () => {
    const fn: SerializedValue = { t: 'function', name: 'f', kind: 'function' };
    expect(valuesEqual(fn, fn)).toBe(false);
    expect(diffValues(fromJson(1), { t: 'circular', refId: 1 })?.reason).toBe('CIRCULAR_VALUE');
    expect(
      diffValues({ t: 'string', v: 'ab' }, { t: 'string', v: 'ab', truncated: true })?.reason,
    ).toBe('TRUNCATED_VALUE');
    expect(
      valuesEqual({ t: 'unserializable', reason: 'x' }, { t: 'unserializable', reason: 'x' }),
    ).toBe(false);
  });

  it('rejects objects with duplicated keys (forged observations)', () => {
    const forged: SerializedValue = {
      t: 'object',
      className: 'Object',
      entries: [
        ['a', { t: 'number', v: 1 }],
        ['a', { t: 'number', v: 1 }],
      ],
    };
    expect(valuesEqual(fromJson({ a: 1 }), forged)).toBe(false);
  });
});

describe('normalization', () => {
  it('converts full-width characters and smart quotes', () => {
    expect(toHalfWidth('ｒｅｔｕｒｎ　１')).toBe('return 1');
    expect(unifySmartQuotes('“hi” ‘a’')).toBe('"hi" \'a\'');
    expect(normalizeBlankText('  Ｒeturn   a ', false)).toBe('return a');
  });

  it('unquotes only a single complete literal', () => {
    expect(unquoteLiteral('"abc"')).toBe('abc');
    expect(unquoteLiteral("'a\\'b'")).toBe("a\\'b");
    expect(unquoteLiteral('"a" + "b"')).toBeNull();
    expect(unquoteLiteral('"')).toBeNull();
  });

  it('normalizes output lines (CRLF, trailing spaces, trailing blank lines)', () => {
    expect(normalizeOutputLines('a  \r\nb\r\n\n\n')).toEqual(['a', 'b']);
    expect(normalizeOutputLines('')).toEqual([]);
  });

  it('compares output lines structurally when both sides are literals', () => {
    expect(outputLineEquals('[1, "a"]', "[1,'a']")).toBe(true);
    expect(outputLineEquals('[1, "a"]', '[ 1, "a" ]')).toBe(true);
    expect(outputLineEquals('{ a: 1 }', '{a:1}')).toBe(true);
    expect(outputLineEquals('5', '"5"')).toBe(false);
    expect(outputLineEquals('hello world', 'hello   world')).toBe(true);
    expect(outputLineEquals('hello', '"hello"')).toBe(false);
    const cmp = compareOutput(['1', '2'], '1\n3\n4');
    expect(cmp).toMatchObject({
      matched: 1,
      total: 3,
      equal: false,
      matches: [true, false, false],
    });
  });
});

describe('PRNG', () => {
  it('matches the SplitMix64 reference vector for seed 0', () => {
    let state = 0n;
    const outputs: bigint[] = [];
    for (let i = 0; i < 3; i++) {
      const step = splitmix64(state);
      state = step.state;
      outputs.push(step.value);
    }
    expect(outputs).toEqual([0xe220a8397b1dcdafn, 0x6e789e6aa1b965f4n, 0x06c45d188009454fn]);
  });

  it('matches xoshiro128** reference outputs for state [1, 2, 3, 4]', () => {
    const next = xoshiro128ss([1, 2, 3, 4]);
    expect([next(), next(), next()]).toEqual([11520, 0, 5927040]);
  });

  it('is deterministic per seed and differs across seeds', () => {
    const a = createRng(0xa91f2cn);
    const b = createRng(0xa91f2cn);
    const c = createRng(0xa91f2dn);
    const draw = (rng: ReturnType<typeof createRng>) =>
      Array.from({ length: 8 }, () => rng.nextUint32());
    const first = draw(a);
    expect(draw(b)).toEqual(first);
    expect(draw(c)).not.toEqual(first);
  });

  it('draws integers inside the range and covers it', () => {
    const rng = createRng(42n);
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i++) {
      const v = rng.int(-3, 3);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect(seen.size).toBe(7);
    expect(() => rng.int(5, 1)).toThrow(RangeError);
  });

  it('shuffles deterministically without losing items', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const shuffled = createRng(seedFromString('attempt-1')).shuffle(items);
    expect(createRng(seedFromString('attempt-1')).shuffle(items)).toEqual(shuffled);
    expect([...shuffled].sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('hashes strings (UTF-8) and derives seed chains stably', () => {
    expect(seedFromString('가')).toBe(seedFromString('가'));
    expect(seedFromString('a')).not.toBe(seedFromString('b'));
    expect(deriveSeed(1n)).toBe(splitmix64(1n).value);
  });
});
