import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MaintenanceState } from '../../http/security.ts';
import { BackupService } from '../../services/backup/service.ts';
import { setupDb, silentLog, tmpDir } from '../../test/helpers.ts';
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

/** Copies the real migrations up to and including `tag` (an older release's schema). */
function migrationsUpTo(tag: string) {
  const dir = tmpDir('proginone-migrations-');
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const keep = journal.entries.findIndex((e) => e.tag === tag);
  for (const e of journal.entries.slice(keep + 1)) rmSync(join(dir, `${e.tag}.sql`));
  journal.entries = journal.entries.slice(0, keep + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe('migrateUserDb', () => {
  it('initializes an empty database without a backup', async () => {
    const userDb = new UserDb(join(tmpDir(), 'user.db')).open();
    const backup = vi.fn(() => Promise.resolve('unused'));
    expect(await migrateUserDb(userDb, { backup })).toEqual(['0000_init', '0001_learning_records']);
    expect(backup).not.toHaveBeenCalled();
    expect(schemaState(userDb.sqlite)).toMatchObject({
      current: '0001_learning_records',
      pending: [],
    });
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
    expect(schemaState(reopened.sqlite)).toMatchObject({
      current: '0001_learning_records',
      pending: [],
    });
    const oops = reopened.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE name = 'oops'")
      .get();
    expect(oops).toBeUndefined();
  });

  it('upgrades a 0000 database with data to 0001 after a pre-migration backup', async () => {
    const dataDir = tmpDir();
    const userDb = new UserDb(join(dataDir, 'user.db')).open();
    await migrateUserDb(userDb, {
      backup: () => Promise.resolve(''),
      migrationsDir: migrationsUpTo('0000_init'),
    });
    expect(schemaState(userDb.sqlite).pending).toEqual(['0001_learning_records']);
    userDb.sqlite
      .prepare(
        "INSERT INTO learners (id, timezone, day_start_hour, created_at) VALUES ('L1', 'Asia/Seoul', 4, 1)",
      )
      .run();
    userDb.sqlite
      .prepare(
        "INSERT INTO settings (learner_id, key, value_json, updated_at) VALUES ('L1', 'theme', '\"dark\"', 2)",
      )
      .run();
    const backups = new BackupService({
      userDb,
      backupDir: join(dataDir, 'backups'),
      appVersion: '0.1.0',
      log: silentLog,
      maintenance: new MaintenanceState(),
      migrate: () => Promise.resolve([]),
    });
    const backup = vi.fn(() => backups.create('pre-migration').then((b) => b.path));

    expect(await migrateUserDb(userDb, { backup })).toEqual(['0001_learning_records']);

    expect(backup).toHaveBeenCalledOnce();
    const [saved0] = backups.list(['pre-migration']);
    if (!saved0) throw new Error('no pre-migration backup');
    const saved = new UserDb(saved0.path).open();
    expect(schemaState(saved.sqlite).current).toBe('0000_init');
    expect(saved.sqlite.prepare('SELECT id FROM learners').all()).toEqual([{ id: 'L1' }]);
    saved.close();
    expect(userDb.sqlite.prepare('SELECT id, timezone FROM learners').all()).toEqual([
      { id: 'L1', timezone: 'Asia/Seoul' },
    ]);
    expect(userDb.sqlite.prepare('SELECT value_json FROM settings').get()).toEqual({
      value_json: '"dark"',
    });
    const tables = userDb.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'lesson_progress',
        'practice_sets',
        'practice_set_items',
        'attempts',
        'submissions',
        'hint_events',
        'exercise_snapshots',
        'concept_mastery',
        'mastery_evidence',
        'concept_memory',
        'review_logs',
        'pending_ratings',
        'exercise_reports',
        'daily_activity',
      ]),
    );
    // New tables enforce their enum and JSON constraints.
    expect(() =>
      userDb.sqlite
        .prepare(
          "INSERT INTO daily_activity (learner_id, date, active_ms) VALUES ('L1', 'today', 0)",
        )
        .run(),
    ).toThrow(/CHECK/);
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
