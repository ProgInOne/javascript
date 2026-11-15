import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MaintenanceState } from '../../http/security.ts';
import { BackupService } from '../../services/backup/service.ts';
import { migrationsUpTo, setupDb, silentLog, tmpDir } from '../../test/helpers.ts';
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
    expect(await migrateUserDb(userDb, { backup })).toEqual([
      '0000_init',
      '0001_learning_records',
      '0002_ai_tutor',
      '0003_engine_v02',
      '0004_goals',
      '0005_session_summaries',
    ]);
    expect(backup).not.toHaveBeenCalled();
    expect(schemaState(userDb.sqlite)).toMatchObject({
      current: '0005_session_summaries',
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
      current: '0005_session_summaries',
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
    expect(schemaState(userDb.sqlite).pending).toEqual([
      '0001_learning_records',
      '0002_ai_tutor',
      '0003_engine_v02',
      '0004_goals',
      '0005_session_summaries',
    ]);
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

    expect(await migrateUserDb(userDb, { backup })).toEqual([
      '0001_learning_records',
      '0002_ai_tutor',
      '0003_engine_v02',
      '0004_goals',
      '0005_session_summaries',
    ]);

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

  it('upgrades a 0001 database with learning records to 0002 (tutor tables)', async () => {
    const dataDir = tmpDir();
    const userDb = new UserDb(join(dataDir, 'user.db')).open();
    await migrateUserDb(userDb, {
      backup: () => Promise.resolve(''),
      migrationsDir: migrationsUpTo('0001_learning_records'),
    });
    userDb.sqlite
      .prepare(
        "INSERT INTO learners (id, timezone, day_start_hour, created_at) VALUES ('L1', 'Asia/Seoul', 4, 1)",
      )
      .run();
    userDb.sqlite
      .prepare(
        "INSERT INTO hint_events (id, learner_id, exercise_id, kind, level, created_at) VALUES ('H1', 'L1', 'ex', 'hint', 1, 2)",
      )
      .run();
    const backup = vi.fn(() => Promise.resolve(join(dataDir, 'unused')));
    expect(await migrateUserDb(userDb, { backup })).toEqual([
      '0002_ai_tutor',
      '0003_engine_v02',
      '0004_goals',
      '0005_session_summaries',
    ]);
    expect(backup).toHaveBeenCalledOnce();
    expect(userDb.sqlite.prepare('SELECT id FROM hint_events').all()).toEqual([{ id: 'H1' }]);
    userDb.sqlite
      .prepare(
        "INSERT INTO tutor_threads (id, learner_id, scope_type, provider, created_at, last_message_at) VALUES ('T1', 'L1', 'general', 'mock', 1, 1)",
      )
      .run();
    expect(() =>
      userDb.sqlite
        .prepare(
          "INSERT INTO tutor_messages (id, thread_id, role, content, status, created_at) VALUES ('M1', 'T1', 'tutor', '', 'typing', 1)",
        )
        .run(),
    ).toThrow(/CHECK/);
    expect(() =>
      userDb.sqlite
        .prepare(
          "INSERT INTO ai_calls (id, learner_id, task_name, task_version, base_version, provider, status, context_manifest_json, created_at) VALUES ('A1', 'L1', 't', 1, 1, 'mock', 'weird', '[]', 1)",
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it('upgrades a 0002 database to 0003 (misconception observations, relearning)', async () => {
    const dataDir = tmpDir();
    const userDb = new UserDb(join(dataDir, 'user.db')).open();
    await migrateUserDb(userDb, {
      backup: () => Promise.resolve(''),
      migrationsDir: migrationsUpTo('0002_ai_tutor'),
    });
    userDb.sqlite
      .prepare(
        "INSERT INTO learners (id, timezone, day_start_hour, created_at) VALUES ('L1', 'Asia/Seoul', 4, 1)",
      )
      .run();
    const backup = vi.fn(() => Promise.resolve(join(dataDir, 'unused')));
    expect(await migrateUserDb(userDb, { backup })).toEqual([
      '0003_engine_v02',
      '0004_goals',
      '0005_session_summaries',
    ]);
    expect(backup).toHaveBeenCalledOnce();
    const insert = (id: string, mc: string, status: string, evidence: string, extra = '') =>
      userDb.sqlite
        .prepare(
          `INSERT INTO misconception_observations (id, learner_id, misconception_id, concept_id, status, source, evidence_attempt_ids_json, first_seen_at, last_seen_at${extra ? ', ai_description' : ''}) VALUES (?, 'L1', ?, 'c', ?, ?, ?, 1, 1${extra ? ', ?' : ''})`,
        )
        .run(
          id,
          mc,
          status,
          mc.startsWith('ai.') ? 'ai' : 'distractor',
          evidence,
          ...(extra ? [extra] : []),
        );
    insert('O1', 'mc.a', 'confirmed', '["A1"]');
    // FR-AI-09: no evidence, no row.
    expect(() => insert('O2', 'mc.b', 'suspected', '[]')).toThrow(/CHECK/);
    // One active observation per misconception; closed rows may coexist.
    expect(() => insert('O3', 'mc.a', 'suspected', '["A2"]')).toThrow(/UNIQUE/);
    insert('O4', 'mc.a', 'resolved', '["A3"]');
    // AI-proposed misconceptions need a description.
    expect(() => insert('O5', 'ai.X', 'suspected', '["A4"]')).toThrow(/CHECK/);
    insert('O6', 'ai.X', 'suspected', '["A4"]', '설명');
    expect(() =>
      userDb.sqlite
        .prepare(
          "INSERT INTO remediation_suggestions (id, learner_id, concept_id, attempt_id, trigger, kind, detail_json, created_at) VALUES ('R1', 'L1', 'c', 'A1', 'set_consecutive_failures', 'nap', '{}', 1)",
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it('upgrades a 0003 database to 0004 (goals with history)', async () => {
    const dataDir = tmpDir();
    const userDb = new UserDb(join(dataDir, 'user.db')).open();
    await migrateUserDb(userDb, {
      backup: () => Promise.resolve(''),
      migrationsDir: migrationsUpTo('0003_engine_v02'),
    });
    userDb.sqlite
      .prepare(
        "INSERT INTO learners (id, timezone, day_start_hour, created_at) VALUES ('L1', 'Asia/Seoul', 4, 1)",
      )
      .run();
    const backup = vi.fn(() => Promise.resolve(join(dataDir, 'unused')));
    expect(await migrateUserDb(userDb, { backup })).toEqual([
      '0004_goals',
      '0005_session_summaries',
    ]);
    const insert = (id: string, minutes: number, to: number | null, date: string | null = null) =>
      userDb.sqlite
        .prepare(
          'INSERT INTO goals (id, learner_id, daily_minutes, weekly_days, target_date, effective_from, effective_to) VALUES (?, ?, ?, 5, ?, 1, ?)',
        )
        .run(id, 'L1', minutes, date, to);
    insert('G1', 30, 2);
    insert('G2', 45, null, '2026-12-31');
    // One current goal per learner.
    expect(() => insert('G3', 20, null)).toThrow(/UNIQUE/);
    expect(() => insert('G4', 600, 3)).toThrow(/CHECK/);
    expect(() => insert('G5', 30, 3, 'next week')).toThrow(/CHECK/);
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
  it('upgrades a 0004 database to 0005 (session summaries)', async () => {
    const dataDir = tmpDir();
    const userDb = new UserDb(join(dataDir, 'user.db')).open();
    await migrateUserDb(userDb, {
      backup: () => Promise.resolve(''),
      migrationsDir: migrationsUpTo('0004_goals'),
    });
    userDb.sqlite
      .prepare(
        "INSERT INTO learners (id, timezone, day_start_hour, created_at) VALUES ('L1', 'Asia/Seoul', 4, 1)",
      )
      .run();
    userDb.sqlite
      .prepare(
        "INSERT INTO tutor_threads (id, learner_id, scope_type, provider, created_at, last_message_at) VALUES ('T1', 'L1', 'general', 'mock', 1, 1)",
      )
      .run();
    const backup = vi.fn(() => Promise.resolve(join(dataDir, 'unused')));
    expect(await migrateUserDb(userDb, { backup })).toEqual(['0005_session_summaries']);
    const insert = (id: string, source: string, json: string) =>
      userDb.sqlite
        .prepare(
          "INSERT INTO session_summaries (id, learner_id, scope_type, scope_id, source, summary_json, concept_ids_json, message_count, covered_until, created_at) VALUES (?, 'L1', 'tutor_thread', 'T1', ?, ?, '[]', 2, 1, 1)",
        )
        .run(id, source, json);
    insert('S1', 'ai', '{}');
    expect(() => insert('S2', 'guess', '{}')).toThrow(/CHECK/);
    expect(() => insert('S3', 'ai', 'not json')).toThrow(/CHECK/);
    userDb.sqlite
      .prepare("INSERT INTO session_summary_concepts (summary_id, concept_id) VALUES ('S1', 'c')")
      .run();
    userDb.sqlite.prepare("DELETE FROM session_summaries WHERE id = 'S1'").run();
    expect(userDb.sqlite.prepare('SELECT * FROM session_summary_concepts').all()).toEqual([]);
  });
});
