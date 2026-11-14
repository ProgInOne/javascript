import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const lockSchema = z.object({ pid: z.number().int(), url: z.string(), startedAt: z.string() });
export type LockInfo = z.infer<typeof lockSchema>;

export type AcquireResult =
  { acquired: true; release: () => void } | { acquired: false; running: LockInfo };

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

function readLock(path: string): LockInfo | null {
  try {
    return lockSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null; // unreadable or corrupt: treat as stale
  }
}

/**
 * Single-instance lock at `<dataDir>/server.lock`. Creation is atomic (`wx`); a lock whose
 * process is gone is considered stale and replaced. A second instance gets the running URL so it
 * can open the browser there and exit.
 */
export function acquireInstanceLock(
  dataDir: string,
  info: Omit<LockInfo, 'pid' | 'startedAt'>,
  { pid = process.pid, alive = isAlive }: { pid?: number; alive?: (pid: number) => boolean } = {},
): AcquireResult {
  const path = join(dataDir, 'server.lock');
  const body = JSON.stringify({ pid, url: info.url, startedAt: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, body, { flag: 'wx' });
      let released = false;
      return {
        acquired: true,
        release: () => {
          if (released) return;
          released = true;
          if (readLock(path)?.pid === pid) rmSync(path, { force: true });
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const existing = readLock(path);
      if (existing && existing.pid !== pid && alive(existing.pid)) {
        return { acquired: false, running: existing };
      }
      rmSync(path, { force: true }); // stale
    }
  }
  throw new Error(`인스턴스 잠금을 얻지 못했습니다: ${path}`);
}
