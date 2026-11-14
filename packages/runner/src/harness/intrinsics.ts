/* eslint-disable @typescript-eslint/unbound-method --
   Index loops and captured built-ins on purpose: learner code may replace Array iterators and
   prototype methods (docs/design/code-execution-sandbox.md#하네스-무결성). */
/**
 * Built-ins captured before any learner code runs (docs/design/code-execution-sandbox.md#하네스-무결성).
 *
 * Lessons themselves change built-ins (e.g. adding to `Array.prototype`), and mistakes can replace
 * `JSON` or `console`. Harness code that runs after learner code (serializer, transport, steps)
 * calls built-ins only through these references, never through prototype methods on values.
 *
 * Module-level code runs when the harness bundle starts, which is before the learner's scripts.
 */
export const G = globalThis;
export const apply = Reflect.apply;
export const ownKeys = Reflect.ownKeys;
export const { defineProperty, freeze, getOwnPropertyDescriptor, getPrototypeOf, create } = Object;
export const isArray = Array.isArray;
export const ObjectCtor = Object;
export const StringCtor = String;
export const MapCtor = Map;
export const SetCtor = Set;
export const WeakMapCtor = WeakMap;
export const DateCtor = Date;
export const RegExpCtor = RegExp;
export const ErrorCtor = Error;
export const PromiseCtor = Promise;
export const MathMin = Math.min;
export const MathMax = Math.max;
export const BigIntCtor = BigInt;
export const SymbolCtor = Symbol;
export const MathRound = Math.round;
export const NumberIsInteger = Number.isInteger;

const arrayPushFn = Array.prototype.push;
const arraySliceFn = Array.prototype.slice;
const stringSliceFn = String.prototype.slice;
const stringIndexOfFn = String.prototype.indexOf;
const stringSplitFn = String.prototype.split;
const functionToStringFn = Function.prototype.toString;
const regExpExecFn = RegExp.prototype.exec;
const mapGetFn = Map.prototype.get;
const mapSetFn = Map.prototype.set;
const mapHasFn = Map.prototype.has;
const mapDeleteFn = Map.prototype.delete;
const mapForEachFn = Map.prototype.forEach;
const mapSizeGetter = getOwnPropertyDescriptor(Map.prototype, 'size')?.get;
const setForEachFn = Set.prototype.forEach;
const setAddFn = Set.prototype.add;
const setSizeGetter = getOwnPropertyDescriptor(Set.prototype, 'size')?.get;
const dateGetTimeFn = Date.prototype.getTime;
const dateToISOStringFn = Date.prototype.toISOString;
const regExpSourceGetter = getOwnPropertyDescriptor(RegExp.prototype, 'source')?.get;
const regExpFlagsGetter = getOwnPropertyDescriptor(RegExp.prototype, 'flags')?.get;
const symbolDescriptionGetter = getOwnPropertyDescriptor(Symbol.prototype, 'description')?.get;
const promiseThenFn = Promise.prototype.then;
const performanceNowFn = typeof performance === 'object' ? performance.now : undefined;
const perf = typeof performance === 'object' ? performance : undefined;
const JSONObj = JSON;
const jsonStringifyFn = JSON.stringify;

export const push = <T>(arr: T[], value: T): void => {
  apply(arrayPushFn, arr, [value]);
};
export const arraySlice = <T>(arr: ArrayLike<T>, start?: number): T[] =>
  apply(arraySliceFn, arr, start === undefined ? [] : [start]) as T[];
export const strSlice = (s: string, start: number, end?: number): string =>
  apply(stringSliceFn, s, end === undefined ? [start] : [start, end]);
export const strIndexOf = (s: string, search: string): number =>
  apply(stringIndexOfFn, s, [search]);
export const strSplit = (s: string, sep: string): string[] =>
  apply(stringSplitFn, s, [sep]) as string[];
export const fnToString = (f: unknown): string => apply(functionToStringFn, f, []);
export const reExec = (re: RegExp, s: string): RegExpExecArray | null =>
  apply(regExpExecFn, re, [s]);
export const mapGet = <K, V>(m: Map<K, V>, k: K): V | undefined =>
  apply(mapGetFn, m, [k]) as V | undefined;
export const mapSet = <K, V>(m: Map<K, V>, k: K, v: V): void => {
  apply(mapSetFn, m, [k, v]);
};
export const mapHas = <K, V>(m: Map<K, V>, k: K): boolean => apply(mapHasFn, m, [k]);
export const mapDelete = <K, V>(m: Map<K, V>, k: K): boolean => apply(mapDeleteFn, m, [k]);
export const mapSize = (m: Map<unknown, unknown>): number =>
  mapSizeGetter ? (apply(mapSizeGetter, m, []) as number) : 0;
export const mapForEach = <K, V>(m: Map<K, V>, fn: (v: V, k: K) => void): void => {
  apply(mapForEachFn, m, [fn]);
};
export const setSize = (s: Set<unknown>): number =>
  setSizeGetter ? (apply(setSizeGetter, s, []) as number) : 0;
export const setForEach = <T>(s: Set<T>, fn: (v: T) => void): void => {
  apply(setForEachFn, s, [fn]);
};
export const setAdd = <T>(s: Set<T>, v: T): void => {
  apply(setAddFn, s, [v]);
};
export const dateGetTime = (d: Date): number => apply(dateGetTimeFn, d, []);
export const dateToISOString = (d: Date): string => apply(dateToISOStringFn, d, []);
export const regExpSource = (r: RegExp): string =>
  regExpSourceGetter ? (apply(regExpSourceGetter, r, []) as string) : '';
export const regExpFlags = (r: RegExp): string =>
  regExpFlagsGetter ? (apply(regExpFlagsGetter, r, []) as string) : '';
export const symbolDescription = (s: symbol): string | null => {
  const d = symbolDescriptionGetter
    ? (apply(symbolDescriptionGetter, s, []) as unknown)
    : undefined;
  return typeof d === 'string' ? d : null;
};
export const promiseThen = <T>(
  p: Promise<T>,
  ok: (v: T) => void,
  fail: (e: unknown) => void,
): void => {
  apply(promiseThenFn, p, [ok, fail]);
};
export const now = (): number => (performanceNowFn && perf ? apply(performanceNowFn, perf, []) : 0);
export const jsonStringify = (v: unknown): string | undefined =>
  apply(jsonStringifyFn, JSONObj, [v]);
