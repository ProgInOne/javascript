/* eslint-disable @typescript-eslint/prefer-for-of --
   Index loops and captured built-ins on purpose: learner code may replace Array iterators and
   prototype methods (docs/design/code-execution-sandbox.md#하네스-무결성). */
import type { FunctionKind, SerializedValue } from '@proginone/shared';
import {
  BigIntCtor,
  create,
  DateCtor,
  defineProperty,
  dateGetTime,
  dateToISOString,
  ErrorCtor,
  fnToString,
  getOwnPropertyDescriptor,
  getPrototypeOf,
  isArray,
  MapCtor,
  mapForEach,
  mapDelete,
  mapGet,
  mapSet,
  mapSize,
  ownKeys,
  PromiseCtor,
  push,
  reExec,
  RegExpCtor,
  regExpFlags,
  regExpSource,
  SetCtor,
  setAdd,
  setForEach,
  setSize,
  strSlice,
  SymbolCtor,
  symbolDescription,
} from './intrinsics.ts';

export interface SerializeOptions {
  /** Longer strings are cut (8,000 by default, below `maxEntryBytes`; PoC S35). */
  maxString: number;
  /** Items per array/object/Map/Set. */
  maxItems: number;
  /** Nesting depth; deeper containers are `collapsed`. */
  maxDepth: number;
  /** `Node` constructor in DOM mode, so elements show as `dom` values. */
  nodeCtor?: abstract new () => object;
}

export const DEFAULT_SERIALIZE_OPTIONS: SerializeOptions = {
  maxString: 8_000,
  maxItems: 100,
  maxDepth: 6,
};

const NATIVE = /\{\s*\[native code\]\s*\}\s*$/;
const CLASS = /^class[\s{]/;
const ASYNC = /^async[\s(]/;
const GENERATOR = /^(async\s*)?function\s*\*/;
const ARROW = /^(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/;

/** Reads an own data property without running getters. */
function dataValue(target: object, key: PropertyKey): unknown {
  const d = getOwnPropertyDescriptor(target, key);
  return d && 'value' in d ? d.value : undefined;
}

function functionName(f: object): string {
  const name = dataValue(f, 'name');
  return typeof name === 'string' ? name : '';
}

function functionKind(source: string): FunctionKind {
  if (reExec(NATIVE, source)) return 'native';
  if (reExec(CLASS, source)) return 'class';
  if (reExec(GENERATOR, source)) return 'generator';
  if (reExec(ARROW, source)) return 'arrow';
  if (reExec(ASYNC, source)) return 'async';
  return 'function';
}

function className(v: object): string | null {
  const proto = getPrototypeOf(v) as object | null;
  if (proto === null) return null;
  const ctor = dataValue(proto, 'constructor');
  return typeof ctor === 'function' ? functionName(ctor) || 'Object' : 'Object';
}

function stringField(v: object, key: string): string {
  // Errors keep `name` on the prototype and `message` on the instance; both are data properties
  // unless learner code changed them, and getters are not run.
  let target: object | null = v;
  for (let depth = 0; target && depth < 8; depth++) {
    const d = getOwnPropertyDescriptor(target, key);
    if (d) return 'value' in d && typeof d.value === 'string' ? d.value : '';
    target = getPrototypeOf(target) as object | null;
  }
  return '';
}

/**
 * Creates a serializer bound to captured built-ins. Never runs getters, never throws: values that
 * fail (e.g. revoked proxies) become `unserializable`.
 */
export function createSerializer(options: SerializeOptions = DEFAULT_SERIALIZE_OPTIONS) {
  const { maxString, maxItems, maxDepth, nodeCtor } = options;

  type Container = Extract<SerializedValue, { t: 'array' | 'object' | 'map' | 'set' }>;
  interface Walk {
    /** Containers currently being serialized (the ancestors of the current value). */
    open: Map<object, Container>;
    nextRef: number;
  }

  /**
   * Fills `out` with `obj`'s children while `obj` counts as an ancestor. Only ancestors are
   * circular; a value that merely appears twice is serialized twice, like Node's inspect.
   */
  const within = (obj: object, out: Container, walk: Walk, fill: () => void): Container => {
    mapSet(walk.open, obj, out);
    try {
      fill();
    } finally {
      mapDelete(walk.open, obj);
    }
    return out;
  };

  const serialize = (v: unknown, depth: number, walk: Walk): SerializedValue => {
    try {
      if (v === undefined) return { t: 'undefined' };
      if (v === null) return { t: 'null' };
      switch (typeof v) {
        case 'boolean':
          return { t: 'boolean', v };
        case 'number':
          if (v !== v) return { t: 'number', v: 'NaN' };
          if (v === Infinity) return { t: 'number', v: 'Infinity' };
          if (v === -Infinity) return { t: 'number', v: '-Infinity' };
          if (v === 0 && 1 / v < 0) return { t: 'number', v: '-0' };
          return { t: 'number', v };
        case 'bigint':
          return { t: 'bigint', v: `${v}` };
        case 'string':
          return v.length > maxString
            ? { t: 'string', v: strSlice(v, 0, maxString), truncated: true }
            : { t: 'string', v };
        case 'symbol': {
          const description = symbolDescription(v);
          return description === null ? { t: 'symbol' } : { t: 'symbol', description };
        }
        case 'function': {
          let source = '';
          try {
            source = fnToString(v);
          } catch {
            source = '';
          }
          return {
            t: 'function',
            name: functionName(v),
            kind: functionKind(source),
            preview: strSlice(source, 0, 80),
          };
        }
        default:
          break;
      }
      const obj = v;
      const ancestor = mapGet(walk.open, obj);
      if (ancestor) {
        // Node numbers the referenced container (`<ref *1>`) and the reference (`[Circular *1]`).
        ancestor.refId ??= walk.nextRef++;
        return { t: 'circular', refId: ancestor.refId };
      }

      if (obj instanceof ErrorCtor) {
        return { t: 'error', name: stringField(obj, 'name'), message: stringField(obj, 'message') };
      }
      if (obj instanceof DateCtor) {
        const time = dateGetTime(obj);
        return { t: 'date', iso: time !== time ? 'Invalid Date' : dateToISOString(obj) };
      }
      if (obj instanceof RegExpCtor) {
        return { t: 'regexp', source: regExpSource(obj), flags: regExpFlags(obj) };
      }
      if (obj instanceof PromiseCtor) return { t: 'promise' };
      if (nodeCtor && obj instanceof nodeCtor) return serializeNode(obj);

      const collapsed = depth >= maxDepth;
      if (isArray(obj)) {
        const length = dataValue(obj, 'length') as number;
        const items: SerializedValue[] = [];
        if (collapsed) return { t: 'array', items, length, truncated: length > 0 };
        const out: Container = { t: 'array', items, length };
        return within(obj, out, walk, () => {
          let holes = 0;
          const end = length < maxItems ? length : maxItems;
          for (let i = 0; i < end; i++) {
            const d = getOwnPropertyDescriptor(obj, `${i}`);
            if (!d) {
              // An empty slot; `holes` tells it apart from a stored `undefined`.
              holes++;
              push(items, { t: 'undefined' });
              continue;
            }
            push(items, 'value' in d ? serialize(d.value, depth + 1, walk) : { t: 'getter' });
          }
          if (holes > 0) out.holes = holes;
          if (length > maxItems) out.truncated = true;
        });
      }
      if (obj instanceof MapCtor) {
        const size = mapSize(obj);
        const entries: [SerializedValue, SerializedValue][] = [];
        const out: Container = { t: 'map', entries, size };
        if (collapsed) return size > 0 ? { ...out, truncated: true } : out;
        return within(obj, out, walk, () => {
          mapForEach(obj as Map<unknown, unknown>, (val, key) => {
            if (entries.length < maxItems) {
              push(entries, [serialize(key, depth + 1, walk), serialize(val, depth + 1, walk)]);
            }
          });
          if (size > entries.length) out.truncated = true;
        });
      }
      if (obj instanceof SetCtor) {
        const size = setSize(obj);
        const items: SerializedValue[] = [];
        const out: Container = { t: 'set', items, size };
        if (collapsed) return size > 0 ? { ...out, truncated: true } : out;
        return within(obj, out, walk, () => {
          setForEach(obj as Set<unknown>, (val) => {
            if (items.length < maxItems) push(items, serialize(val, depth + 1, walk));
          });
          if (size > items.length) out.truncated = true;
        });
      }

      const cls = className(obj);
      const entries: [string, SerializedValue][] = [];
      if (collapsed) return { t: 'object', className: cls, entries, collapsed: true };
      const out: Container = { t: 'object', className: cls, entries };
      return within(obj, out, walk, () => {
        // Index loops, not for...of: learner code may replace Array.prototype[Symbol.iterator].
        const keys = ownKeys(obj);
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          if (typeof key !== 'string') continue;
          const d = getOwnPropertyDescriptor(obj, key);
          if (!d?.enumerable) continue;
          if (entries.length >= maxItems) {
            out.truncated = true;
            break;
          }
          push(entries, [
            key,
            'value' in d ? serialize(d.value, depth + 1, walk) : { t: 'getter' },
          ]);
        }
      });
    } catch (e) {
      return {
        t: 'unserializable',
        reason: e instanceof ErrorCtor ? stringField(e, 'message') : '',
      };
    }
  };

  const serializeNode = (node: object): SerializedValue => {
    const n = node as Partial<Element> & { nodeName?: string; textContent?: string | null };
    const out: Extract<SerializedValue, { t: 'dom' }> = {
      t: 'dom',
      nodeName: typeof n.nodeName === 'string' ? n.nodeName : '#node',
      preview: strSlice(
        typeof n.outerHTML === 'string' ? n.outerHTML : (n.textContent ?? ''),
        0,
        200,
      ),
    };
    if (typeof n.id === 'string' && n.id !== '') out.id = n.id;
    if (n.classList && n.classList.length > 0) {
      const classes: string[] = [];
      for (let i = 0; i < n.classList.length && i < maxItems; i++) {
        const c = n.classList.item(i);
        if (c !== null) push(classes, c);
      }
      out.classes = classes;
    }
    return out;
  };

  return (value: unknown): SerializedValue =>
    serialize(value, 0, { open: new MapCtor<object, Container>(), nextRef: 1 });
}

/**
 * Turns step arguments (`SerializedValue`, from `CheckBundle`) back into values of the harness
 * realm, so `Array.isArray`, `instanceof Map` and friends behave for the learner's function.
 * Kinds that cannot be rebuilt (functions, DOM nodes, promises, getters) become `undefined`.
 * `circular` refers back to the container carrying the same `refId`.
 */
export function deserialize(value: SerializedValue): unknown {
  const refs = new MapCtor<number, unknown>();
  const keep = <T>(refId: number | undefined, container: T): T => {
    if (refId !== undefined) mapSet(refs, refId, container);
    return container;
  };
  const build = (v: SerializedValue): unknown => {
    switch (v.t) {
      case 'undefined':
        return undefined;
      case 'null':
        return null;
      case 'boolean':
      case 'string':
        return v.v;
      case 'number':
        if (typeof v.v === 'number') return v.v;
        return v.v === 'NaN'
          ? NaN
          : v.v === 'Infinity'
            ? Infinity
            : v.v === '-Infinity'
              ? -Infinity
              : -0;
      case 'bigint':
        return BigIntCtor(v.v);
      case 'symbol':
        return SymbolCtor(v.description);
      case 'array': {
        const out = keep<unknown[]>(v.refId, []);
        for (let i = 0; i < v.items.length; i++) {
          const item = v.items[i];
          if (item) push(out, build(item));
        }
        return out;
      }
      case 'object': {
        const out = keep<Record<string, unknown>>(
          v.refId,
          v.className === null ? (create(null) as Record<string, unknown>) : {},
        );
        for (let i = 0; i < v.entries.length; i++) {
          const entry = v.entries[i];
          if (!entry) continue;
          defineProperty(out, entry[0], {
            value: build(entry[1]),
            writable: true,
            enumerable: true,
            configurable: true,
          });
        }
        return out;
      }
      case 'map': {
        const out = keep(v.refId, new MapCtor<unknown, unknown>());
        for (let i = 0; i < v.entries.length; i++) {
          const entry = v.entries[i];
          if (!entry) continue;
          mapSet(out, build(entry[0]), build(entry[1]));
        }
        return out;
      }
      case 'set': {
        const out = keep(v.refId, new SetCtor<unknown>());
        for (let i = 0; i < v.items.length; i++) {
          const item = v.items[i];
          if (item) setAdd(out, build(item));
        }
        return out;
      }
      case 'date':
        return new DateCtor(v.iso === 'Invalid Date' ? NaN : v.iso);
      case 'regexp':
        return new RegExpCtor(v.source, v.flags);
      case 'error': {
        const e = new ErrorCtor(v.message);
        e.name = v.name;
        return e;
      }
      case 'circular':
        return mapGet(refs, v.refId);
      default:
        return undefined;
    }
  };
  return build(value);
}

/**
 * Rough serialized size in bytes, used for the entry, observation and output budgets. Walks only
 * own properties of harness-made objects, so learner changes to prototypes do not matter.
 */
export function estimateSize(v: unknown, depth = 0): number {
  if (depth > 32) return 8;
  if (typeof v === 'string') return v.length + 2;
  if (v === null || typeof v !== 'object') return 8;
  let n = 2;
  const keys = ownKeys(v);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (typeof key !== 'string') continue;
    n += key.length + 3 + estimateSize(dataValue(v, key), depth + 1);
  }
  return n;
}
