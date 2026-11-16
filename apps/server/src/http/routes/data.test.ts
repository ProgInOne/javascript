import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  apiErrorSchema,
  backupCheckSchema,
  backupListSchema,
  backupLocationChangeSchema,
  backupLocationSchema,
  resetResponseSchema,
} from '@proginone/shared';
import { describe, expect, it, vi } from 'vitest';
import { ensureLearner } from '../../db/user/learners.ts';
import { UserDb } from '../../db/user/connection.ts';
import { migrateUserDb, schemaState } from '../../db/user/migrate.ts';
import { BackupLocationService } from '../../services/backup/location.ts';
import { BackupService } from '../../services/backup/service.ts';
import { ContentAccess } from '../../services/curriculum/content-access.ts';
import {
  DataResetService,
  KEPT_TABLES,
  learningTables,
} from '../../services/data/reset-service.ts';
import type { PracticeServices } from '../../services/practice/index.ts';
import { SettingsService } from '../../services/settings/service.ts';
import { migrationsUpTo, setupDb, silentLog, tmpDir } from '../../test/helpers.ts';
import { createApp } from '../app.ts';
import { MaintenanceState, TOKEN_HEADER } from '../security.ts';

async function setup(options: { fixedByEnv?: boolean } = {}) {
  const ctx = await setupDb();
  const home = tmpDir('proginone-home-');
  const settings = new SettingsService({ userDb: ctx.userDb, log: silentLog });
  const location = new BackupLocationService({
    backups: ctx.backups,
    dataDir: ctx.dataDir,
    defaultDir: join(ctx.dataDir, 'backups'),
    fixedByEnv: options.fixedByEnv ?? false,
    log: silentLog,
    home,
  });
  const app = createApp({
    config: { port: 4310, mode: 'production' },
    log: silentLog,
    token: 't',
    backups: ctx.backups,
    backupLocation: location,
    dataReset: new DataResetService({ userDb: ctx.userDb, backups: ctx.backups, log: silentLog }),
    settings,
    content: ContentAccess.unavailable(),
    practice: {} as PracticeServices,
    maintenance: ctx.maintenance,
  });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`http://127.0.0.1:4310/api/v1${path}`, {
      method,
      headers: {
        host: '127.0.0.1:4310',
        [TOKEN_HEADER]: 't',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const errorOf = async (res: Response) => apiErrorSchema.parse(await res.json()).error;
  return { ...ctx, home, settings, call, errorOf };
}

const count = (ctx: { userDb: UserDb }, table: string) =>
  (ctx.userDb.sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;

/** A learner with a goal, lesson progress and onboarding done. */
function seedLearning(userDb: UserDb) {
  const learner = ensureLearner(userDb);
  userDb.sqlite
    .prepare("UPDATE learners SET onboarded_at = 1, experience_level = 'some' WHERE id = ?")
    .run(learner.id);
  userDb.sqlite
    .prepare(
      'INSERT INTO goals (id, learner_id, daily_minutes, weekly_days, effective_from) VALUES (?, ?, 45, 5, 1)',
    )
    .run('G1', learner.id);
  userDb.sqlite
    .prepare(
      "INSERT INTO lesson_progress (learner_id, lesson_id, status, updated_at) VALUES (?, 'js.l1', 'completed', 1)",
    )
    .run(learner.id);
  return learner;
}

describe('backup location', () => {
  it('reports the default folder', async () => {
    const { call, dataDir } = await setup();
    const location = backupLocationSchema.parse(
      await (await call('GET', '/backups/location')).json(),
    );
    expect(location).toMatchObject({
      path: join(dataDir, 'backups'),
      defaultPath: join(dataDir, 'backups'),
      source: 'default',
      editable: true,
      cloudSynced: false,
    });
  });

  it('moves new backups to a new folder, keeps the old ones, and saves config.json', async () => {
    const { call, dataDir, backups } = await setup();
    await backups.create('manual');
    const target = join(tmpDir('proginone-target-'), 'ProgInOne Backups');

    const res = await call('PUT', '/backups/location', { path: target });
    expect(res.status).toBe(200);
    const change = backupLocationChangeSchema.parse(await res.json());
    expect(change.location).toMatchObject({ path: realpathSync(target), source: 'config' });
    expect(change.previousPath).toBe(join(dataDir, 'backups'));
    expect(change.backup.kind).toBe('manual');
    // The proof backup is in the new folder, which now holds the list; the old backups stay.
    expect(existsSync(join(realpathSync(target), 'manual'))).toBe(true);
    const list = backupListSchema.parse(await (await call('GET', '/backups')).json());
    expect(list.backups.map((b) => b.id)).toEqual([change.backup.id]);
    expect(existsSync(join(dataDir, 'backups', 'manual'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8'))).toEqual({
      backupDir: realpathSync(target),
    });

    // Going back to the default removes the key again.
    const back = await call('PUT', '/backups/location', { path: join(dataDir, 'backups') });
    expect(back.status).toBe(200);
    expect(JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8'))).toEqual({});
  });

  it('expands ~ to the home folder and flags cloud-synced folders', async () => {
    const { call, home } = await setup();
    mkdirSync(join(home, 'Dropbox'));
    const res = await call('PUT', '/backups/location', { path: '~/Dropbox/ProgInOne' });
    expect(res.status).toBe(200);
    const change = backupLocationChangeSchema.parse(await res.json());
    expect(change.location.path).toBe(join(realpathSync(home), 'Dropbox', 'ProgInOne'));
    expect(change.location.cloudSynced).toBe(true);
  });

  it.each([
    ['relative path', 'backups', 'not-absolute'],
    ['traversal', '/tmp/../etc', 'traversal'],
    [
      'encoded traversal stays literal but has no parent',
      '/nonexistent-root-dir/%2e%2e/x',
      'parent-missing',
    ],
    ['NUL byte', '/tmp/a\u0000b', 'invalid-characters'],
    ['newline', '/tmp/a\nb', 'invalid-characters'],
    ['filesystem root', '/', 'root'],
    ['deep missing tree', '/tmp/proginone-nope-1/nope-2/nope-3', 'parent-missing'],
  ])('refuses a %s', async (_name, path, reason) => {
    const { call, errorOf, backups, dataDir } = await setup();
    const res = await call('PUT', '/backups/location', { path });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({
      code: 'BACKUP_LOCATION_INVALID',
      details: { reason },
    });
    expect(backups.backupDir).toBe(join(dataDir, 'backups'));
    expect(existsSync(join(dataDir, 'config.json'))).toBe(false);
  });

  it('refuses the data folder and its ancestors', async () => {
    const { call, errorOf, dataDir } = await setup();
    for (const path of [dataDir, join(dataDir, '..')]) {
      const res = await call('PUT', '/backups/location', { path: realpathSync(path) });
      expect((await errorOf(res)).details).toEqual({ reason: 'contains-data' });
    }
  });

  it('refuses a symlinked folder, a file, and a folder with other files', async () => {
    const { call, errorOf } = await setup();
    const base = tmpDir('proginone-target-');
    mkdirSync(join(base, 'real'));
    symlinkSync(join(base, 'real'), join(base, 'link'));
    writeFileSync(join(base, 'file.txt'), 'x');
    mkdirSync(join(base, 'docs'));
    writeFileSync(join(base, 'docs', 'report.pdf'), 'x');

    const reasonOf = async (path: string) =>
      (await errorOf(await call('PUT', '/backups/location', { path }))).details?.['reason'];
    expect(await reasonOf(join(base, 'link'))).toBe('symlink');
    expect(await reasonOf(join(base, 'file.txt'))).toBe('not-directory');
    expect(await reasonOf(join(base, 'docs'))).toBe('not-empty');
    // A new folder under a symlinked parent is stored by its real path.
    const res = await call('PUT', '/backups/location', { path: join(base, 'link', 'new') });
    expect(backupLocationChangeSchema.parse(await res.json()).location.path).toBe(
      join(realpathSync(base), 'real', 'new'),
    );
  });

  it('rejects unknown body keys and over-long paths', async () => {
    const { call, errorOf } = await setup();
    const extra = await call('PUT', '/backups/location', { path: '/tmp/x', move: true });
    expect((await errorOf(extra)).code).toBe('VALIDATION_FAILED');
    const long = await call('PUT', '/backups/location', { path: `/${'a'.repeat(2000)}` });
    expect((await errorOf(long)).code).toBe('VALIDATION_FAILED');
  });

  it('is read-only when PROGINONE_BACKUP_DIR fixes it', async () => {
    const { call, errorOf } = await setup({ fixedByEnv: true });
    const location = backupLocationSchema.parse(
      await (await call('GET', '/backups/location')).json(),
    );
    expect(location).toMatchObject({ source: 'env', editable: false });
    const res = await call('PUT', '/backups/location', { path: tmpDir() });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('BACKUP_LOCATION_LOCKED');
  });
});

describe('backup check and restore', () => {
  it('checks a healthy backup', async () => {
    const { call, backups } = await setup();
    const b = await backups.create('manual');
    const res = await call('GET', `/backups/${encodeURIComponent(b.id)}/check`);
    expect(backupCheckSchema.parse(await res.json())).toEqual({
      id: b.id,
      ok: true,
      problem: null,
      migrationNeeded: false,
    });
  });

  it('refuses to restore a corrupted file and leaves the data alone', async () => {
    const { call, errorOf, backups, userDb } = await setup();
    seedLearning(userDb);
    const b = await backups.create('manual');
    // Garbage with a matching checksum: only the SQLite check can catch it.
    writeFileSync(b.path, 'not a database');
    const meta = JSON.parse(
      readFileSync(b.path.replace('_user.db', '_user.meta.json'), 'utf8'),
    ) as {
      sha256: string;
    };
    meta.sha256 = createHash('sha256').update('not a database').digest('hex');
    writeFileSync(b.path.replace('_user.db', '_user.meta.json'), JSON.stringify(meta));

    const check = backupCheckSchema.parse(
      await (await call('GET', `/backups/${encodeURIComponent(b.id)}/check`)).json(),
    );
    expect(check).toMatchObject({ ok: false, problem: 'integrity' });
    const res = await call('POST', `/backups/${encodeURIComponent(b.id)}/restore`);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({
      code: 'RESTORE_FAILED',
      details: { reason: 'integrity' },
    });
    expect(count({ userDb }, 'goals')).toBe(1);
    expect(backups.list(['pre-restore'])).toHaveLength(0);
  });

  it('restores an older-schema backup and migrates it', async () => {
    const { call, backups, userDb, dataDir } = await setup();
    // An older app (schema 0004) wrote a backup into the same folder.
    const oldDir = migrationsUpTo('0004_goals');
    const oldDb = new UserDb(join(tmpDir(), 'user.db')).open();
    await migrateUserDb(oldDb, { backup: () => Promise.resolve(''), migrationsDir: oldDir });
    seedLearning(oldDb);
    const oldBackups = new BackupService({
      userDb: oldDb,
      backupDir: join(dataDir, 'backups'),
      appVersion: '0.1.0',
      log: silentLog,
      maintenance: new MaintenanceState(),
      migrate: () => Promise.resolve(),
      migrationsDir: oldDir,
    });
    const old = await oldBackups.create('manual');
    oldDb.close();
    expect(old.meta.schemaMigration).toBe('0004_goals');

    const check = backupCheckSchema.parse(
      await (await call('GET', `/backups/${encodeURIComponent(old.id)}/check`)).json(),
    );
    expect(check).toMatchObject({ ok: true, migrationNeeded: true });
    const res = await call('POST', `/backups/${encodeURIComponent(old.id)}/restore`);
    expect(res.status).toBe(200);

    const state = schemaState(userDb.sqlite);
    expect(state.current).toBe(state.latest);
    expect(count({ userDb }, 'goals')).toBe(1);
    expect(count({ userDb }, 'session_summaries')).toBe(0); // the 0005 table exists now
    expect(backups.list(['pre-restore'])).toHaveLength(1);
    expect(backups.list(['pre-migration']).length).toBeGreaterThanOrEqual(1);
  });

  it('stops AI turns before replacing the database', async () => {
    const { userDb, maintenance, dataDir } = await setupDb();
    const interrupt = vi.fn(() => {
      expect(maintenance.active).toBe(true);
    });
    const backups = new BackupService({
      userDb,
      backupDir: join(dataDir, 'backups'),
      appVersion: '0.1.0',
      log: silentLog,
      maintenance,
      migrate: (backup) => migrateUserDb(userDb, { backup }),
      interrupt,
    });
    const b = await backups.create('manual');
    await backups.restore(b.id);
    expect(interrupt).toHaveBeenCalledOnce();
  });
});

describe('learning data reset', () => {
  it('requires the typed confirmation', async () => {
    const { call, errorOf, userDb } = await setup();
    seedLearning(userDb);
    for (const body of [{}, { confirm: '초기화 ' }, { confirm: 'reset' }]) {
      const res = await call('POST', '/data/reset', body);
      expect(res.status).toBe(400);
      expect((await errorOf(res)).code).toBe('VALIDATION_FAILED');
    }
    expect(count({ userDb }, 'goals')).toBe(1);
  });

  it('backs up, wipes learning records, keeps settings, and asks for onboarding again', async () => {
    const { call, userDb, settings, backups } = await setup();
    const learner = seedLearning(userDb);
    settings.update({ theme: 'dark' });

    const res = await call('POST', '/data/reset', { confirm: '초기화' });
    expect(res.status).toBe(200);
    const { backup } = resetResponseSchema.parse(await res.json());
    expect(backup.kind).toBe('pre-reset');

    for (const table of learningTables(userDb.sqlite)) expect(count({ userDb }, table)).toBe(0);
    expect(settings.get().theme).toBe('dark');
    const after = ensureLearner(userDb);
    expect(after).toMatchObject({
      id: learner.id,
      timezone: learner.timezone,
      onboardedAt: null,
      experienceLevel: 'none',
    });

    // Restoring the pre-reset backup brings everything back.
    await backups.restore(backup.id);
    expect(count({ userDb }, 'goals')).toBe(1);
    expect(count({ userDb }, 'lesson_progress')).toBe(1);
    expect(ensureLearner(userDb).onboardedAt).not.toBeNull();
  });

  it('treats every table except the kept ones as learning data', async () => {
    const { userDb } = await setupDb();
    const all = (
      userDb.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    ).map((r) => r.name);
    const wiped = learningTables(userDb.sqlite);
    expect([...wiped, ...KEPT_TABLES].sort()).toEqual(all.sort());
    expect(wiped).toEqual(
      expect.arrayContaining(['attempts', 'goals', 'tutor_messages', 'code_drafts']),
    );
  });
});
