import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { offsetFileClock } from './test-clock.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('offsetFileClock', () => {
  it('shifts the base clock by the offset in the file, re-read on every call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-clock-'));
    dirs.push(dir);
    const file = join(dir, 'offset');
    const now = offsetFileClock(file, () => 1_000);
    expect(now()).toBe(1_000); // no file
    writeFileSync(file, '86400000\n');
    expect(now()).toBe(86_401_000);
    writeFileSync(file, 'nope');
    expect(now()).toBe(1_000);
  });
});
