import { readFileSync } from 'node:fs';
import { systemClock, type Clock } from './clock.ts';

/**
 * E2E only: a clock shifted by the integer milliseconds written in `path` (missing or invalid
 * file = no shift). The server uses it only when `PROGINONE_TEST_CLOCK_FILE` is set at startup
 * (never in normal runs), so Playwright can move "today" forward to test next-day reviews against
 * the production build. Read on every call so tests can change it while the server runs.
 */
export function offsetFileClock(path: string, base: Clock = systemClock): Clock {
  return () => {
    let offset = 0;
    try {
      const value = Number(readFileSync(path, 'utf8').trim());
      if (Number.isSafeInteger(value)) offset = value;
    } catch {
      // no file: no shift
    }
    return base() + offset;
  };
}
