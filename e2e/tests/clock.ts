import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DAY_MS = 86_400_000;

function dataDirOf(server: 'main' | 'journey'): string {
  const dir = process.env[server === 'main' ? 'E2E_DATA_DIR' : 'E2E_JOURNEY_DATA_DIR'];
  if (!dir) throw new Error('E2E data directories are not set (run through playwright.config.ts)');
  return dir;
}

/**
 * Moves the E2E server's learning clock (PROGINONE_TEST_CLOCK_FILE, see playwright.config.ts)
 * `ms` into the future. `0` restores real time. The browser clock is not changed.
 */
export function shiftServerClock(ms: number, server: 'main' | 'journey' = 'main') {
  writeFileSync(join(dataDirOf(server), 'clock-offset-ms'), String(Math.round(ms)));
}

/**
 * Sets the server's learning clock to `epochMs` (as an offset from now, so it keeps ticking).
 * Screenshots of learning state stay stable across days when every test pins the same instant.
 */
export function setServerTime(epochMs: number, server: 'main' | 'journey' = 'main') {
  shiftServerClock(epochMs - Date.now(), server);
}
