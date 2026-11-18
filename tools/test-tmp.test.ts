import { mkdirSync, mkdtempSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { removeStaleRunRoots } from './test-tmp.ts';

describe('removeStaleRunRoots', () => {
  it('removes only run roots older than six hours', () => {
    const base = mkdtempSync(join(tmpdir(), 'stale-'));
    const old = join(base, 'proginone-run-vitest-old');
    const fresh = join(base, 'proginone-run-vitest-new');
    const other = join(base, 'something-else');
    for (const dir of [old, fresh, other]) mkdirSync(dir);
    const now = Date.now();
    const sevenHoursAgo = (now - 7 * 60 * 60 * 1000) / 1000;
    utimesSync(old, sevenHoursAgo, sevenHoursAgo);
    utimesSync(other, sevenHoursAgo, sevenHoursAgo);

    expect(removeStaleRunRoots(base, now)).toEqual([old]);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  it('ignores a missing base folder', () => {
    expect(removeStaleRunRoots(join(tmpdir(), 'no-such-folder-xyz'))).toEqual([]);
  });
});
