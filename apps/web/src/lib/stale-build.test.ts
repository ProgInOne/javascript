import { describe, expect, it, vi } from 'vitest';
import { isStaleBuildError, reloadForNewBuild } from './stale-build.ts';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('isStaleBuildError', () => {
  it('recognizes chunk load failures in each engine', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: http://127.0.0.1:4777/assets/_setId-Ab12.js',
      'error loading dynamically imported module: http://127.0.0.1:4777/assets/x.js',
      'Importing a module script failed.',
      'Unable to preload CSS for /assets/x.css',
    ]) {
      expect(isStaleBuildError(new TypeError(message))).toBe(true);
    }
  });

  it('ignores other errors and non-errors', () => {
    expect(isStaleBuildError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isStaleBuildError('Failed to fetch dynamically imported module')).toBe(false);
    expect(isStaleBuildError(null)).toBe(false);
  });
});

describe('reloadForNewBuild', () => {
  it('reloads once, then not again within 30 s', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    let t = 1_000_000;
    const now = () => t;
    expect(reloadForNewBuild({ storage, reload, now })).toBe(true);
    t += 5_000;
    expect(reloadForNewBuild({ storage, reload, now })).toBe(false);
    t += 30_000;
    expect(reloadForNewBuild({ storage, reload, now })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does nothing without session storage', () => {
    const reload = vi.fn();
    expect(reloadForNewBuild({ storage: null, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
