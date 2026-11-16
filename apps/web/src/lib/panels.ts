import { useCallback, useEffect, useState } from 'react';

// Learning screen layout state (ui-ux.md 반응형과 패널 규칙, D-067): panel sizes and collapsed
// panels are kept per browser in localStorage, per screen and exercise type. They are view
// preferences, not learning records, so they are not sent to the server or backed up.

const PREFIX = 'proginone:panel:';

/** Storage keys, all under `proginone:panel:`. */
export const PANEL_KEYS = {
  /** Problem panel share of the practice two-column layout, per exercise type. */
  practiceSplit: (typeId: string) => `practice-split:${typeId}`,
  /** Editor height in pixels (code workspace), or absent for the natural height. */
  editorHeight: 'editor-height',
  /** Results area (tests / console) collapsed to its header. */
  resultsCollapsed: 'results-collapsed',
  /** Reading mode side column ("이 단원의 개념", 목차) collapsed. */
  lessonAside: 'lesson-aside-collapsed',
  /** Tutor drawer was open when the learner last left a learning screen. */
  tutorOpen: 'tutor-open',
} as const;

export function readPanel(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writePanel(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    // Storage unavailable (private mode, quota): the layout is simply not remembered.
  }
}

/**
 * A layout value remembered in localStorage. `parse` validates the stored text and returns
 * `undefined` for anything unusable (old format, out of range), which falls back to `fallback`.
 * Setting `null` forgets the value (back to the default).
 */
export function usePanelState<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T | undefined,
  serialize: (value: T) => string = String,
): [T, (value: T | null) => void] {
  const read = useCallback((): T => {
    const raw = readPanel(key);
    if (raw === null) return fallback;
    return parse(raw) ?? fallback;
    // `parse` and `fallback` are expected to be stable per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const [state, setState] = useState<{ key: string; value: T }>(() => ({ key, value: read() }));
  // Another key (another exercise type) reads its own value.
  const value = state.key === key ? state.value : read();
  if (state.key !== key) setState({ key, value });
  const set = useCallback(
    (next: T | null) => {
      writePanel(key, next === null ? null : serialize(next));
      setState({ key, value: next ?? fallback });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [value, set];
}

export const parseBoolean = (raw: string): boolean | undefined =>
  raw === 'true' ? true : raw === 'false' ? false : undefined;

/** A number within [min, max], or undefined. */
export const parseNumberIn =
  (min: number, max: number) =>
  (raw: string): number | undefined => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
  };

/** `window.matchMedia(query).matches`, kept current. False where matchMedia is missing. */
export function useMediaQuery(query: string): boolean {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => {
      setMatches(list.matches);
    };
    update();
    list.addEventListener('change', update);
    return () => {
      list.removeEventListener('change', update);
    };
  }, [query]);
  return matches;
}

/** Width at which the learning screen shows panels side by side (ui-ux.md standard 이상). */
export const WIDE_QUERY = '(min-width: 1280px)';
