import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DAY_MS = 86_400_000;

/**
 * Moves the E2E server's learning clock (PROGINONE_TEST_CLOCK_FILE, see playwright.config.ts)
 * `ms` into the future. `0` restores real time. The browser clock is not changed.
 */
export function shiftServerClock(ms: number) {
  const dataDir = process.env['E2E_DATA_DIR'];
  if (!dataDir) throw new Error('E2E_DATA_DIR is not set (run through playwright.config.ts)');
  writeFileSync(join(dataDir, 'clock-offset-ms'), String(ms));
}
