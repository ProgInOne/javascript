import { describe, expect, it } from 'vitest';

import { consoleEntriesToLines, formatConsoleArgs, formatValue } from './console-format.ts';
import type { ConsoleEntry, SerializedValue } from './run-protocol.ts';

const num = (v: number): SerializedValue => ({ t: 'number', v });
const str = (v: string): SerializedValue => ({ t: 'string', v });

describe('ProgInOne console format', () => {
  it('prints top-level strings raw and nested strings in double quotes', () => {
    expect(formatConsoleArgs([str('a b')])).toBe('a b');
    expect(formatConsoleArgs([{ t: 'array', items: [num(1), str('a')], length: 2 }])).toBe(
      '[1, "a"]',
    );
    expect(formatConsoleArgs([str('x'), num(3)])).toBe('x 3');
  });

  it('formats objects with spacing, class names and quoted keys', () => {
    const obj: SerializedValue = {
      t: 'object',
      className: 'Object',
      entries: [
        ['a', num(1)],
        ['b-c', { t: 'array', items: [], length: 0 }],
      ],
    };
    expect(formatValue(obj)).toBe('{ a: 1, "b-c": [] }');
    expect(formatValue({ t: 'object', className: 'Point', entries: [] })).toBe('Point {}');
    expect(formatValue({ t: 'object', className: null, entries: [] })).toBe(
      '[Object: null prototype] {}',
    );
    expect(formatValue({ t: 'object', className: 'Object', entries: [], collapsed: true })).toBe(
      '[Object]',
    );
  });

  it('formats special numbers, bigint, Map, Set and functions', () => {
    expect(formatValue({ t: 'number', v: 'NaN' })).toBe('NaN');
    expect(formatValue({ t: 'number', v: '-0' })).toBe('-0');
    expect(formatValue({ t: 'bigint', v: '12' })).toBe('12n');
    expect(formatValue({ t: 'map', entries: [[str('a'), num(1)]] })).toBe('Map(1) { "a" => 1 }');
    expect(formatValue({ t: 'set', items: [] })).toBe('Set(0) {}');
    expect(formatValue({ t: 'function', name: 'f', kind: 'function' })).toBe('[Function: f]');
    expect(formatValue({ t: 'function', name: '', kind: 'arrow' })).toBe('[Function (anonymous)]');
    expect(formatValue({ t: 'function', name: 'A', kind: 'class' })).toBe('[class A]');
  });

  it('marks truncation and circular references', () => {
    expect(formatValue({ t: 'array', items: [num(1)], length: 3, truncated: true })).toBe(
      '[1, ... 2 more items]',
    );
    expect(
      formatValue({
        t: 'object',
        className: 'Object',
        refId: 1,
        entries: [['self', { t: 'circular', refId: 1 }]],
      }),
    ).toBe('<ref *1> { self: [Circular *1] }');
  });

  it('turns output entries into lines and skips non-output levels', () => {
    const entry = (level: ConsoleEntry['level'], args: SerializedValue[]): ConsoleEntry => ({
      seq: 0,
      level,
      args,
      at: 0,
    });
    expect(
      consoleEntriesToLines([
        entry('log', [str('a\nb')]),
        entry('alert', [str('hidden')]),
        entry('error', [{ t: 'error', name: 'TypeError', message: 'x' }]),
      ]),
    ).toEqual(['a', 'b', 'TypeError: x']);
  });
});
