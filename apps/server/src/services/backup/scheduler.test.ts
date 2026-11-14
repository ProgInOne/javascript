import { describe, expect, it } from 'vitest';
import { setupDb, silentLog } from '../../test/helpers.ts';
import { BackupScheduler } from './scheduler.ts';

describe('BackupScheduler', () => {
  it('backs up once per local day and once per ISO week', async () => {
    let now = new Date('2026-11-16T03:00:00Z'); // Monday 12:00 in Seoul
    const { userDb, backups } = await setupDb({ now: () => now });
    const scheduler = new BackupScheduler({
      userDb,
      backups,
      log: silentLog,
      boundary: () => ({ timezone: 'Asia/Seoul', dayStartHour: 4 }),
      now: () => now,
    });

    expect(await scheduler.tick()).toEqual({ daily: true, weekly: true });
    expect(await scheduler.tick()).toEqual({ daily: false, weekly: false }); // same day

    now = new Date('2026-11-17T03:00:00Z'); // Tuesday, same week
    expect(await scheduler.tick()).toEqual({ daily: true, weekly: false });

    now = new Date('2026-11-23T03:00:00Z'); // next Monday
    expect(await scheduler.tick()).toEqual({ daily: true, weekly: true });

    expect(backups.list(['daily'])).toHaveLength(3);
    expect(backups.list(['weekly']).map((b) => b.id)).toEqual([
      'weekly:2026-W48',
      'weekly:2026-W47',
    ]);
  });
});
