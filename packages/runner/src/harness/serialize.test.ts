/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-extraneous-class --
   Function kinds are told apart from real (empty) functions and classes. */
import { describe, expect, it } from 'vitest';
import { formatConsoleArgs, serializedValueSchema } from '@proginone/run-contract';
import { createSerializer, deserialize, estimateSize } from './serialize.ts';

const ser = createSerializer();

describe('createSerializer', () => {
  it.each<[string, unknown, unknown]>([
    ['undefined', undefined, { t: 'undefined' }],
    ['null', null, { t: 'null' }],
    ['boolean', true, { t: 'boolean', v: true }],
    ['number', 1.5, { t: 'number', v: 1.5 }],
    ['NaN', NaN, { t: 'number', v: 'NaN' }],
    ['Infinity', Infinity, { t: 'number', v: 'Infinity' }],
    ['-Infinity', -Infinity, { t: 'number', v: '-Infinity' }],
    ['-0', -0, { t: 'number', v: '-0' }],
    ['bigint', 12n, { t: 'bigint', v: '12' }],
    ['string', 'hi', { t: 'string', v: 'hi' }],
    ['symbol', Symbol('s'), { t: 'symbol', description: 's' }],
    ['symbol without description', Symbol(), { t: 'symbol' }],
    ['date', new Date(0), { t: 'date', iso: '1970-01-01T00:00:00.000Z' }],
    ['invalid date', new Date(NaN), { t: 'date', iso: 'Invalid Date' }],
    ['regexp', /a+/gi, { t: 'regexp', source: 'a+', flags: 'gi' }],
    ['error', new TypeError('boom'), { t: 'error', name: 'TypeError', message: 'boom' }],
    ['promise', Promise.resolve(1), { t: 'promise' }],
  ])('serializes %s', (_, value, expected) => {
    expect(ser(value)).toEqual(expected);
  });

  it.each<[string, unknown, string]>([
    ['function', function named() {}, 'function'],
    ['arrow', (a: number) => a, 'arrow'],
    ['async arrow', async () => {}, 'arrow'],
    ['class', class K {}, 'class'],
    ['async function', async function af() {}, 'async'],
    ['generator', function* g() {}, 'generator'],
    ['native', Math.max, 'native'],
  ])('tells %s kinds apart', (_, fn, kind) => {
    expect(ser(fn)).toMatchObject({ t: 'function', kind });
  });

  it('keeps structure of arrays, objects, maps and sets', () => {
    expect(ser({ a: [1, 'x'], m: new Map([['k', 1]]), s: new Set([true]) })).toEqual({
      t: 'object',
      className: 'Object',
      entries: [
        [
          'a',
          {
            t: 'array',
            items: [
              { t: 'number', v: 1 },
              { t: 'string', v: 'x' },
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
                { t: 'number', v: 1 },
              ],
            ],
            size: 1,
          },
        ],
        ['s', { t: 'set', items: [{ t: 'boolean', v: true }], size: 1 }],
      ],
    });
  });

  it('counts holes and reports class names', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(ser([1, , , 4])).toEqual({
      t: 'array',
      items: [{ t: 'number', v: 1 }, { t: 'undefined' }, { t: 'undefined' }, { t: 'number', v: 4 }],
      length: 4,
      holes: 2,
    });
    class Point {
      x = 1;
    }
    expect(ser(new Point())).toMatchObject({ t: 'object', className: 'Point' });
    expect(ser(Object.create(null))).toMatchObject({ t: 'object', className: null });
  });

  it('marks circular references like Node (only ancestors, numbered on the container)', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a['self'] = a;
    const out = ser(a);
    expect(out).toMatchObject({
      refId: 1,
      entries: [
        ['name', { t: 'string', v: 'a' }],
        ['self', { t: 'circular', refId: 1 }],
      ],
    });
    expect(formatConsoleArgs([out])).toBe(
      "<ref *1> { name: 'a', self: [Circular *1] }".replace(/'/g, '"'),
    );
    // The same object twice side by side is not circular.
    const shared = { x: 1 };
    expect(ser([shared, shared])).toEqual({
      t: 'array',
      items: [
        { t: 'object', className: 'Object', entries: [['x', { t: 'number', v: 1 }]] },
        { t: 'object', className: 'Object', entries: [['x', { t: 'number', v: 1 }]] },
      ],
      length: 2,
    });
  });

  it('never runs getters', () => {
    let calls = 0;
    const o = {
      get x() {
        calls++;
        return 1;
      },
    };
    expect(ser(o)).toMatchObject({ entries: [['x', { t: 'getter' }]] });
    expect(calls).toBe(0);
  });

  it('limits depth, item count and string length', () => {
    const small = createSerializer({ maxString: 5, maxItems: 2, maxDepth: 2 });
    expect(small('abcdefgh')).toEqual({ t: 'string', v: 'abcde', truncated: true });
    expect(small([1, 2, 3])).toMatchObject({ length: 3, truncated: true, items: [{}, {}] });
    expect(small({ a: 1, b: 2, c: 3 })).toMatchObject({ truncated: true });
    expect(small({ a: { b: { c: 1 } } })).toMatchObject({
      entries: [['a', { entries: [['b', { t: 'object', collapsed: true, entries: [] }]] }]],
    });
  });

  it('turns failing values into unserializable instead of throwing', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(ser(proxy)).toMatchObject({ t: 'unserializable' });
    const trap = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('trap');
        },
      },
    );
    expect(ser(trap)).toEqual({ t: 'unserializable', reason: 'trap' });
  });

  it('is not fooled by learner changes to built-in prototypes', () => {
    const push = Array.prototype.push;
    const keys = Object.keys;
    const stringify = JSON.stringify;
    try {
      Array.prototype.push = () => 0;
      Object.keys = () => [];
      JSON.stringify = () => '{}';
      expect(ser({ a: [1, 2] })).toMatchObject({
        entries: [['a', { t: 'array', items: [{ v: 1 }, { v: 2 }] }]],
      });
    } finally {
      Array.prototype.push = push;
      Object.keys = keys;
      JSON.stringify = stringify;
    }
  });

  it('always produces values the protocol schema accepts', () => {
    const values: unknown[] = [
      { nested: { deep: { deeper: { deepest: { bottom: { x: [1, 2] } } } } } },
      new Map([[{ k: 1 }, new Set([1n])]]),
      [undefined, null, NaN, -0, Symbol('q'), () => 1],
      new Error('e'),
    ];
    for (const v of values) expect(serializedValueSchema.safeParse(ser(v)).success).toBe(true);
  });
});

describe('deserialize', () => {
  it('rebuilds step arguments as real values', () => {
    const original = { list: [1, 'a', null], m: new Map([['k', new Set([1n])]]), d: new Date(0) };
    const back = deserialize(ser(original)) as typeof original;
    expect(back).toEqual(original);
    expect(back.m).toBeInstanceOf(Map);
    expect(Object.is(deserialize({ t: 'number', v: '-0' }), -0)).toBe(true);
    expect(deserialize({ t: 'number', v: 'NaN' })).toBeNaN();
  });

  it('restores circular references', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    const back = deserialize(ser(a)) as Record<string, unknown>;
    expect(back['self']).toBe(back);
  });
});

describe('estimateSize', () => {
  it('grows with content', () => {
    expect(estimateSize({ t: 'string', v: 'x'.repeat(100) })).toBeGreaterThan(100);
    expect(estimateSize(null)).toBe(8);
  });
});
