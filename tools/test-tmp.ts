import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * One temporary root per test run (Vitest, Playwright). Tests make their own `mkdtemp` folders
 * under `os.tmpdir()` and do not delete them; pointing `TMPDIR` at a run root before any test
 * starts puts all of them in one place that the runner removes when it finishes. Child processes
 * (Vitest workers, Playwright workers and web servers) inherit the variable.
 */
const ENV = 'PROGINONE_TEST_TMP_ROOT';
const PREFIX = 'proginone-run-';
/** A root this old belongs to a run that crashed or was killed, not to one still going. */
const STALE_MS = 6 * 60 * 60 * 1000;

/** Removes run roots left by killed runs. Best effort: another run may race on the same entry. */
export function removeStaleRunRoots(base = tmpdir(), now = Date.now()): string[] {
  const removed: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(base);
  } catch {
    return removed;
  }
  for (const name of entries) {
    if (!name.startsWith(PREFIX)) continue;
    const path = join(base, name);
    try {
      if (now - statSync(path).mtimeMs < STALE_MS) continue;
      rmSync(path, { recursive: true, force: true });
      removed.push(path);
    } catch {
      // Gone already or not ours to remove.
    }
  }
  return removed;
}

/**
 * Creates the run root and points `TMPDIR` (and `TMP`/`TEMP`) at it. Returns null inside a run
 * that already has one (a worker re-reading the config), so only the creator removes it.
 */
export function startRunTempRoot(name: string): string | null {
  if (process.env[ENV]) return null;
  const base = tmpdir();
  removeStaleRunRoots(base);
  const root = mkdtempSync(join(base, `${PREFIX}${name}-`));
  process.env[ENV] = root;
  process.env['TMPDIR'] = root;
  process.env['TMP'] = root;
  process.env['TEMP'] = root;
  return root;
}

/** Removes a run root made by {@link startRunTempRoot}. */
export function removeRunTempRoot(root: string): void {
  rmSync(root, { recursive: true, force: true, maxRetries: 3 });
}
