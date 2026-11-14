import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireInstanceLock } from './instance-lock.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'proginone-lock-'));
const URL_A = 'http://127.0.0.1:4310';

describe('acquireInstanceLock', () => {
  it('acquires, writes info, and releases', () => {
    const dir = tmp();
    const r = acquireInstanceLock(dir, { url: URL_A }, { pid: 111 });
    expect(r.acquired).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'server.lock'), 'utf8'))).toMatchObject({
      pid: 111,
      url: URL_A,
    });
    if (r.acquired) r.release();
    expect(existsSync(join(dir, 'server.lock'))).toBe(false);
  });

  it('reports the running instance when its process is alive', () => {
    const dir = tmp();
    acquireInstanceLock(dir, { url: URL_A }, { pid: 111 });
    const second = acquireInstanceLock(
      dir,
      { url: 'http://127.0.0.1:5000' },
      { pid: 222, alive: () => true },
    );
    expect(second).toMatchObject({ acquired: false, running: { pid: 111, url: URL_A } });
  });

  it('replaces a stale lock whose process is gone', () => {
    const dir = tmp();
    acquireInstanceLock(dir, { url: URL_A }, { pid: 111 });
    const second = acquireInstanceLock(dir, { url: URL_A }, { pid: 222, alive: () => false });
    expect(second.acquired).toBe(true);
    const lock = JSON.parse(readFileSync(join(dir, 'server.lock'), 'utf8')) as { pid: number };
    expect(lock.pid).toBe(222);
  });

  it('replaces a corrupt lock file', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'server.lock'), 'garbage');
    expect(acquireInstanceLock(dir, { url: URL_A }, { pid: 333, alive: () => true }).acquired).toBe(
      true,
    );
  });

  it('does not delete a lock that another process now owns', () => {
    const dir = tmp();
    const first = acquireInstanceLock(dir, { url: URL_A }, { pid: 111 });
    writeFileSync(
      join(dir, 'server.lock'),
      JSON.stringify({ pid: 999, url: URL_A, startedAt: '' }),
    );
    if (first.acquired) first.release();
    expect(existsSync(join(dir, 'server.lock'))).toBe(true);
  });
});
