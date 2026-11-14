import { formatValue, type SerializedValue } from '@proginone/shared';

import { numberValue } from './literal.ts';

/**
 * Structural comparison of {@link SerializedValue}s, following the deep-equality rules in
 * docs/design/content-and-exercises.md#call-체크:
 *
 * - primitives as `Object.is`, except `+0` equals `-0` unless `strict`
 * - arrays by length and items; plain objects by own key set and values (key order ignored)
 * - Map/Set by content (order ignored), Date by ISO string, RegExp by source and flags
 * - functions never equal (reference identity cannot be observed); circular, truncated,
 *   collapsed and unserializable values never equal (the comparison would be unsound)
 */

export interface ValueDiff {
  /** Path from the root, e.g. `[2].price`; empty string for the root. */
  path: string;
  expected: string;
  actual: string;
  reason: 'MISMATCH' | 'CIRCULAR_VALUE' | 'TRUNCATED_VALUE';
}

export interface CompareOptions {
  /** Distinguish `+0` and `-0` (`strictEquals`). */
  strict?: boolean;
}

export function valuesEqual(
  expected: SerializedValue,
  actual: SerializedValue,
  options: CompareOptions = {},
): boolean {
  return diffValues(expected, actual, options) === null;
}

/** First difference between two values, or null when they are equal. */
export function diffValues(
  expected: SerializedValue,
  actual: SerializedValue,
  options: CompareOptions = {},
): ValueDiff | null {
  return diff(expected, actual, '', options.strict ?? false);
}

function mismatch(
  path: string,
  expected: SerializedValue,
  actual: SerializedValue,
  reason: ValueDiff['reason'] = 'MISMATCH',
): ValueDiff {
  return { path, expected: formatValue(expected), actual: formatValue(actual), reason };
}

function diff(
  e: SerializedValue,
  a: SerializedValue,
  path: string,
  strict: boolean,
): ValueDiff | null {
  if (a.t === 'circular' || e.t === 'circular') return mismatch(path, e, a, 'CIRCULAR_VALUE');
  if (isIncomplete(a) || isIncomplete(e)) return mismatch(path, e, a, 'TRUNCATED_VALUE');
  if (e.t !== a.t) return mismatch(path, e, a);

  switch (e.t) {
    case 'undefined':
    case 'null':
    case 'promise':
    case 'getter':
      return null;
    case 'boolean':
    case 'bigint':
      return e.v === (a as typeof e).v ? null : mismatch(path, e, a);
    case 'string':
      return e.v === (a as typeof e).v ? null : mismatch(path, e, a);
    case 'number': {
      const x = toNumber(e.v);
      const y = toNumber((a as typeof e).v);
      const same = strict ? Object.is(x, y) : x === y || (Number.isNaN(x) && Number.isNaN(y));
      return same ? null : mismatch(path, e, a);
    }
    case 'symbol':
      return e.description === (a as typeof e).description ? null : mismatch(path, e, a);
    case 'date':
      return e.iso === (a as typeof e).iso ? null : mismatch(path, e, a);
    case 'regexp': {
      const other = a as typeof e;
      return e.source === other.source && sortFlags(e.flags) === sortFlags(other.flags)
        ? null
        : mismatch(path, e, a);
    }
    case 'error': {
      const other = a as typeof e;
      return e.name === other.name && e.message === other.message ? null : mismatch(path, e, a);
    }
    case 'dom': {
      const other = a as typeof e;
      return e.nodeName === other.nodeName && e.id === other.id && e.preview === other.preview
        ? null
        : mismatch(path, e, a);
    }
    case 'array': {
      const other = a as typeof e;
      if (e.length !== other.length || (e.holes ?? 0) !== (other.holes ?? 0)) {
        return { ...mismatch(path, e, a), path: `${path}.length` };
      }
      for (let i = 0; i < e.items.length; i++) {
        const d = diff(e.items[i] ?? UNDEF, other.items[i] ?? UNDEF, `${path}[${i}]`, strict);
        if (d) return d;
      }
      return null;
    }
    case 'object': {
      const other = a as typeof e;
      if ((e.className ?? 'Object') !== (other.className ?? 'Object')) return mismatch(path, e, a);
      const left = toEntryMap(e.entries);
      const right = toEntryMap(other.entries);
      if (!left || !right) return mismatch(path, e, a);
      for (const [key, value] of left) {
        const childPath = `${path}${formatPathKey(key)}`;
        const actualValue = right.get(key);
        if (actualValue === undefined) {
          return {
            path: childPath,
            expected: formatValue(value),
            actual: '(없음)',
            reason: 'MISMATCH',
          };
        }
        const d = diff(value, actualValue, childPath, strict);
        if (d) return d;
      }
      for (const [key, value] of right) {
        if (!left.has(key)) {
          return {
            path: `${path}${formatPathKey(key)}`,
            expected: '(없음)',
            actual: formatValue(value),
            reason: 'MISMATCH',
          };
        }
      }
      return null;
    }
    case 'set': {
      const other = a as typeof e;
      return unorderedEqual(e.items, other.items, (x, y) => diff(x, y, path, strict) === null)
        ? null
        : mismatch(path, e, a);
    }
    case 'map': {
      const other = a as typeof e;
      return unorderedEqual(
        e.entries,
        other.entries,
        ([k1, v1], [k2, v2]) =>
          diff(k1, k2, path, strict) === null && diff(v1, v2, path, strict) === null,
      )
        ? null
        : mismatch(path, e, a);
    }
    case 'function':
    case 'unserializable':
      return mismatch(path, e, a);
  }
}

const UNDEF: SerializedValue = { t: 'undefined' };

function isIncomplete(value: SerializedValue): boolean {
  switch (value.t) {
    case 'string':
    case 'array':
    case 'map':
    case 'set':
      return value.truncated === true;
    case 'object':
      return value.truncated === true || value.collapsed === true;
    default:
      return false;
  }
}

function toEntryMap(entries: [string, SerializedValue][]): Map<string, SerializedValue> | null {
  const map = new Map<string, SerializedValue>(entries);
  return map.size === entries.length ? map : null;
}

function unorderedEqual<T>(left: T[], right: T[], equal: (x: T, y: T) => boolean): boolean {
  if (left.length !== right.length) return false;
  const used = new Array<boolean>(right.length).fill(false);
  outer: for (const x of left) {
    for (let j = 0; j < right.length; j++) {
      if (!used[j] && equal(x, right[j] as T)) {
        used[j] = true;
        continue outer;
      }
    }
    return false;
  }
  return true;
}

function sortFlags(flags: string): string {
  return flags.split('').sort().join('');
}

function formatPathKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

export function toNumber(v: number | 'NaN' | 'Infinity' | '-Infinity' | '-0'): number {
  switch (v) {
    case 'NaN':
      return NaN;
    case 'Infinity':
      return Infinity;
    case '-Infinity':
      return -Infinity;
    case '-0':
      return -0;
    default:
      return v;
  }
}

/** JSON value as written in YAML specs. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Converts a JSON value from a spec into a {@link SerializedValue} for comparison. */
export function fromJson(value: JsonValue): SerializedValue {
  if (value === null) return { t: 'null' };
  if (typeof value === 'boolean') return { t: 'boolean', v: value };
  if (typeof value === 'number') return numberValue(value);
  if (typeof value === 'string') return { t: 'string', v: value };
  if (Array.isArray(value)) return { t: 'array', items: value.map(fromJson), length: value.length };
  return {
    t: 'object',
    className: 'Object',
    entries: Object.entries(value).map(([k, v]) => [k, fromJson(v)]),
  };
}
