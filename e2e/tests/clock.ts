import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DAY_MS = 86_400_000;

type Server = 'main' | 'journey' | 'mastery' | 'templates' | 'full';

const DATA_DIR_ENV: Readonly<Record<Server, string>> = {
  main: 'E2E_DATA_DIR',
  journey: 'E2E_JOURNEY_DATA_DIR',
  mastery: 'E2E_MASTERY_DATA_DIR',
  templates: 'E2E_TEMPLATES_DATA_DIR',
  full: 'E2E_FULL_JOURNEY_DATA_DIR',
};

function dataDirOf(server: Server): string {
  const dir = process.env[DATA_DIR_ENV[server]];
  if (!dir) throw new Error('E2E data directories are not set (run through playwright.config.ts)');
  return dir;
}

/**
 * Moves the E2E server's learning clock (PROGINONE_TEST_CLOCK_FILE, see playwright.config.ts)
 * `ms` into the future. `0` restores real time. The browser clock is not changed.
 */
export function shiftServerClock(ms: number, server: Server = 'main') {
  writeFileSync(join(dataDirOf(server), 'clock-offset-ms'), String(Math.round(ms)));
}

/**
 * Sets the server's learning clock to `epochMs` (as an offset from now, so it keeps ticking).
 * Screenshots of learning state stay stable across days when every test pins the same instant.
 */
export function setServerTime(epochMs: number, server: Server = 'main') {
  shiftServerClock(epochMs - Date.now(), server);
}
