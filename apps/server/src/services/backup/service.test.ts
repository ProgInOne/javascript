import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { backupMetaSchema } from '@proginone/shared';
import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { setupDb } from '../../test/helpers.ts';

const marker = (sqlite: Database.Database) =>
  (
    sqlite.prepare("SELECT value FROM app_meta WHERE key = 'marker'").get() as
      { value: string } | undefined
  )?.value;

describe('BackupService', () => {
  it('creates a verified backup with metadata', async () => {
    const { backups } = await setupDb();
    const entry = await backups.create('manual');
    const meta = backupMetaSchema.parse(
      JSON.parse(readFileSync(entry.path.replace('_user.db', '_user.meta.json'), 'utf8')),
    );
    expect(meta).toMatchObject({
      kind: 'manual',
      appVersion: '0.1.0',
      schemaMigration: '0001_learning_records',
      integrityCheck: 'ok',
    });
    expect(entry.id).toMatch(/^manual:\d{4}-\d{2}-\d{2}T\d{9}Z$/);
    expect(backups.list().map((b) => b.id)).toEqual([entry.id]);
    // A backup is one self-contained file plus its metadata (no WAL side files).
    expect(readdirSync(dirname(entry.path))).toHaveLength(2);
  });

  it('keeps only the newest 14 daily backups', async () => {
    let t = Date.UTC(2026, 0, 1);
    const { backups } = await setupDb({ now: () => new Date((t += 86_400_000)) });
    for (let i = 0; i < 16; i++) await backups.create('daily');
    const daily = backups.list(['daily']);
    expect(daily).toHaveLength(14);
    expect(daily.at(-1)?.createdAt).toBe(new Date(Date.UTC(2026, 0, 4)).toISOString());
  });

  it('never deletes manual backups', async () => {
    let t = Date.UTC(2026, 0, 1);
    const { backups } = await setupDb({ now: () => new Date((t += 1000)) });
    for (let i = 0; i < 20; i++) await backups.create('manual');
    expect(backups.list(['manual'])).toHaveLength(20);
  });

  it('restores a backup, keeping a pre-restore safety copy', async () => {
    const { userDb, backups, maintenance } = await setupDb();
    userDb.sqlite.prepare("INSERT INTO app_meta (key, value) VALUES ('marker', 'old')").run();
    const snapshot = await backups.create('manual');
    userDb.sqlite.prepare("UPDATE app_meta SET value = 'new' WHERE key = 'marker'").run();

    await backups.restore(snapshot.id);

    expect(marker(userDb.sqlite)).toBe('old');
    expect(maintenance.active).toBe(false);
    expect(backups.list(['pre-restore'])).toHaveLength(1);
  });

  it('rejects a tampered backup without touching the database', async () => {
    const { userDb, backups } = await setupDb();
    userDb.sqlite.prepare("INSERT INTO app_meta (key, value) VALUES ('marker', 'live')").run();
    const snapshot = await backups.create('manual');
    writeFileSync(snapshot.path, Buffer.concat([readFileSync(snapshot.path), Buffer.from('x')]));

    await expect(backups.restore(snapshot.id)).rejects.toMatchObject({ code: 'RESTORE_FAILED' });
    expect(marker(userDb.sqlite)).toBe('live');
    expect(backups.list(['pre-restore'])).toHaveLength(0);
  });

  it('rejects a backup from a newer schema', async () => {
    const { userDb, backups } = await setupDb();
    userDb.sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run('future', Date.now() + 10 ** 12);
    const snapshot = await backups.create('manual');
    await expect(backups.restore(snapshot.id)).rejects.toMatchObject({
      code: 'RESTORE_FAILED',
      details: { reason: 'newer-schema' },
    });
  });

  it('returns BACKUP_NOT_FOUND for unknown or malformed ids', async () => {
    const { backups } = await setupDb();
    expect(() => backups.get('manual:nope')).toThrow(
      expect.objectContaining({ code: 'BACKUP_NOT_FOUND' }),
    );
    expect(() => backups.get('../../etc/passwd')).toThrow(
      expect.objectContaining({ code: 'BACKUP_NOT_FOUND' }),
    );
  });
});
