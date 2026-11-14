/** Joins class names, skipping falsy values. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/**
 * Drops `undefined` values so optional props can be forwarded to Radix components
 * under `exactOptionalPropertyTypes` (where `prop={undefined}` is not allowed).
 */
export function defined<T extends object>(props: T): Defined<T> {
  return Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Defined<T>;
}
