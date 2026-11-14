import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { setupDb, tmpDir } from '../../test/helpers.ts';
import { UserDb } from './connection.ts';
import { MIGRATIONS_DIR, MigrationError, migrateUserDb, schemaState } from './migrate.ts';

/** Copies the real migrations and appends one more migration with the given SQL. */
function migrationsWithExtra(sql: string) {
  const dir = tmpDir('proginone-migrations-');
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; when: number; tag: string; version: string; breakpoints: boolean }[];
  };
  const last = journal.entries.at(-1);
  if (!last) throw new Error('empty journal');
  const tag = '0099_extra';
  journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1000, tag });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(join(dir, `${tag}.sql`), sql);
  return dir;
}

describe('migrateUserDb', () => {
  it('initializes an empty database without a backup', async () => {
    const userDb = new UserDb(join(tmpDir(), 'user.db')).open();
    const backup = vi.fn(() => Promise.resolve('unused'));
    expect(await migrateUserDb(userDb, { backup })).toEqual(['0000_init']);
    expect(backup).not.toHaveBeenCalled();
    expect(schemaState(userDb.sqlite)).toMatchObject({ current: '0000_init', pending: [] });
  });

  it('is a no-op when up to date', async () => {
    const { userDb } = await setupDb();
    const backup = vi.fn(() => Promise.resolve('unused'));
    expect(await migrateUserDb(userDb, { backup })).toEqual([]);
    expect(backup).not.toHaveBeenCalled();
  });

  it('backs up first and applies a new migration', async () => {
    const { userDb, backups } = await setupDb();
    const dir = migrationsWithExtra('CREATE TABLE `extra` (`id` text PRIMARY KEY NOT NULL);');
    const applied = await migrateUserDb(userDb, {
      backup: () => backups.create('pre-migration').then((b) => b.path),
      migrationsDir: dir,
    });
    expect(applied).toEqual(['0099_extra']);
    expect(backups.list(['pre-migration'])).toHaveLength(1);
  });

  it('restores the backup and throws when a migration fails', async () => {
    const { userDb, backups } = await setupDb();
    userDb.sqlite.prepare("INSERT INTO app_meta (key, value) VALUES ('marker', 'before')").run();
    const dir = migrationsWithExtra(
      'CREATE TABLE `oops` (`id` text);\n--> statement-breakpoint\nTHIS IS NOT SQL;',
    );

    const err = await migrateUserDb(userDb, {
      backup: () => backups.create('pre-migration').then((b) => b.path),
      migrationsDir: dir,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as MigrationError).backupPath).toContain('pre-migration');

    const reopened = new UserDb(userDb.path).open();
    const marker = reopened.sqlite.prepare("SELECT value FROM app_meta WHERE key = 'marker'").get();
    expect(marker).toEqual({ value: 'before' });
    expect(schemaState(reopened.sqlite)).toMatchObject({ current: '0000_init', pending: [] });
    const oops = reopened.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE name = 'oops'")
      .get();
    expect(oops).toBeUndefined();
  });

  it('refuses a database written by a newer app', async () => {
    const { userDb } = await setupDb();
    userDb.sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run('future', Date.now() + 10 ** 12);
    await expect(migrateUserDb(userDb, { backup: () => Promise.resolve('') })).rejects.toThrow(
      '더 새로운 버전',
    );
  });
});
