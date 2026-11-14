import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { UserDb } from '../db/user/connection.ts';
import { migrateUserDb } from '../db/user/migrate.ts';
import { MaintenanceState } from '../http/security.ts';
import { BackupService } from '../services/backup/service.ts';

export const silentLog = pino({ level: 'silent' });
export const tmpDir = (prefix = 'proginone-test-') => mkdtempSync(join(tmpdir(), prefix));

/** A migrated user.db plus a BackupService in a fresh temp data directory. */
export async function setupDb(options: { now?: () => Date; appVersion?: string } = {}) {
  const dataDir = tmpDir();
  const userDb = new UserDb(join(dataDir, 'user.db')).open();
  const maintenance = new MaintenanceState();
  const backups = new BackupService({
    userDb,
    backupDir: join(dataDir, 'backups'),
    appVersion: options.appVersion ?? '0.1.0',
    log: silentLog,
    maintenance,
    migrate: (backup) => migrateUserDb(userDb, { backup }),
    ...(options.now ? { now: options.now } : {}),
  });
  await migrateUserDb(userDb, {
    backup: () => backups.create('pre-migration').then((b) => b.path),
  });
  return { dataDir, userDb, backups, maintenance };
}
