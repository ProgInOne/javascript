import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  BACKUP_KINDS,
  backupIdSchema,
  backupMetaSchema,
  type BackupKind,
  type BackupMeta,
  type BackupSummary,
} from '@proginone/shared';
import {
  checkDatabase,
  openSqlite,
  removeSideFiles,
  type UserDb,
} from '../../db/user/connection.ts';
import { schemaState } from '../../db/user/migrate.ts';
import { AppError } from '../../http/errors.ts';
import type { MaintenanceState } from '../../http/security.ts';
import type { Logger } from '../../observability/logger.ts';
import { selectExpired } from './retention.ts';

const DB_SUFFIX = '_user.db';
const META_SUFFIX = '_user.meta.json';

export interface BackupEntry extends BackupSummary {
  path: string;
  meta: BackupMeta;
}

export interface BackupServiceDeps {
  userDb: UserDb;
  backupDir: string;
  appVersion: string;
  log: Logger;
  maintenance: MaintenanceState;
  /** Re-runs startup migrations after a restore (older backups). Receives a pre-migration backup function. */
  migrate: (backup: () => Promise<string>) => Promise<unknown>;
  migrationsDir?: string;
  now?: () => Date;
}

const sha256File = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** `2026-11-13T041200123Z`: sortable, filename-safe, unique to the millisecond. */
const stampOf = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('.', '')
    .replace(/^(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');

/** Online backups of user.db with verification, retention and restore (docs/design/data-model.md#자동-백업-설계). */
export class BackupService {
  readonly #d: Required<Omit<BackupServiceDeps, 'migrationsDir'>> & {
    migrationsDir: string | undefined;
  };
  #busy: Promise<unknown> = Promise.resolve();

  constructor(deps: BackupServiceDeps) {
    this.#d = { now: () => new Date(), ...deps, migrationsDir: deps.migrationsDir };
  }

  /** Serializes backup/restore work so two jobs never touch the same files at once. */
  #exclusive<T>(job: () => Promise<T>): Promise<T> {
    const run = this.#busy.then(job, job);
    this.#busy = run.catch(() => undefined);
    return run;
  }

  #schemaTag(): string | null {
    return schemaState(this.#d.userDb.sqlite, this.#d.migrationsDir).current;
  }

  /** Creates a verified backup. `stem` overrides the file name (used for weekly copies). */
  create(kind: BackupKind, options: { stem?: string } = {}): Promise<BackupEntry> {
    return this.#exclusive(() => this.#create(kind, options));
  }

  async #create(kind: BackupKind, { stem }: { stem?: string }): Promise<BackupEntry> {
    const { userDb, backupDir, appVersion, log, now } = this.#d;
    const createdAt = now();
    const dir = join(backupDir, kind);
    mkdirSync(dir, { recursive: true });
    const name =
      stem ??
      (kind === 'pre-migration' ? `${stampOf(createdAt)}_v${appVersion}` : stampOf(createdAt));
    const dbPath = join(dir, name + DB_SUFFIX);
    const partial = `${dbPath}.partial`;
    try {
      await userDb.sqlite.backup(partial);
      // The snapshot inherits WAL mode; switch it to a self-contained single file before verifying.
      const check = new Database(partial);
      let problems: string[];
      try {
        check.pragma('journal_mode = DELETE');
        problems = checkDatabase(check);
      } finally {
        check.close();
      }
      removeSideFiles(partial);
      if (problems.length > 0) throw new Error(problems.join('; '));
      renameSync(partial, dbPath);
      const meta: BackupMeta = {
        format: 'proginone-backup',
        formatVersion: 1,
        kind,
        createdAt: createdAt.toISOString(),
        appVersion,
        schemaMigration: this.#schemaTag(),
        contentPackVersion: null, // content.db arrives in M4
        sizeBytes: statSync(dbPath).size,
        sha256: sha256File(dbPath),
        integrityCheck: 'ok',
      };
      writeFileSync(join(dir, name + META_SUFFIX), `${JSON.stringify(meta, null, 2)}\n`);
      log.info({ kind, path: dbPath }, 'backup created');
      this.#prune(kind);
      return { ...this.#summary(kind, name, meta), path: dbPath, meta };
    } catch (e) {
      rmSync(partial, { force: true });
      removeSideFiles(partial);
      log.error({ err: e, kind }, 'backup failed');
      throw new AppError('BACKUP_FAILED', 500, '백업을 만들지 못했습니다.', { cause: e });
    }
  }

  /** Copies an existing verified backup under another kind (daily → weekly). */
  copyAs(entry: BackupEntry, kind: BackupKind, stem: string): void {
    const dir = join(this.#d.backupDir, kind);
    mkdirSync(dir, { recursive: true });
    copyFileSync(entry.path, join(dir, stem + DB_SUFFIX));
    writeFileSync(
      join(dir, stem + META_SUFFIX),
      `${JSON.stringify({ ...entry.meta, kind }, null, 2)}\n`,
    );
    this.#prune(kind);
  }

  #summary(kind: BackupKind, stem: string, meta: BackupMeta): BackupSummary {
    return {
      id: `${kind}:${stem}`,
      kind,
      createdAt: meta.createdAt,
      appVersion: meta.appVersion,
      schemaMigration: meta.schemaMigration,
      sizeBytes: meta.sizeBytes,
    };
  }

  /** All readable backups, newest first. Files with missing or invalid metadata are skipped. */
  list(kinds: readonly BackupKind[] = BACKUP_KINDS): BackupEntry[] {
    const out: BackupEntry[] = [];
    for (const kind of kinds) {
      const dir = join(this.#d.backupDir, kind);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(META_SUFFIX)) continue;
        const stem = file.slice(0, -META_SUFFIX.length);
        const path = join(dir, stem + DB_SUFFIX);
        if (!existsSync(path)) continue;
        try {
          const meta = backupMetaSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
          out.push({ ...this.#summary(kind, stem, meta), path, meta });
        } catch (e) {
          this.#d.log.warn(
            { err: e, file: join(dir, file) },
            'skipping unreadable backup metadata',
          );
        }
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): BackupEntry {
    const parsed = backupIdSchema.safeParse(id);
    const entry = parsed.success ? this.list().find((e) => e.id === id) : undefined;
    if (!entry)
      throw new AppError('BACKUP_NOT_FOUND', 404, '백업을 찾을 수 없습니다.', { details: { id } });
    return entry;
  }

  #prune(kind: BackupKind): void {
    try {
      const entries = this.list([kind]);
      for (const id of selectExpired(kind, entries)) {
        const e = entries.find((x) => x.id === id);
        if (!e) continue;
        rmSync(e.path, { force: true });
        rmSync(e.path.slice(0, -DB_SUFFIX.length) + META_SUFFIX, { force: true });
      }
    } catch (e) {
      this.#d.log.warn({ err: e, kind }, 'backup retention cleanup failed'); // never fails the backup
    }
  }

  /** Checks a backup before restoring: checksum, integrity, and schema not newer than this app. */
  verify(entry: BackupEntry): void {
    const fail = (reason: string, message: string) => {
      throw new AppError('RESTORE_FAILED', 409, message, { details: { reason, id: entry.id } });
    };
    if (sha256File(entry.path) !== entry.meta.sha256)
      fail('checksum', '백업 파일이 손상되었습니다.');
    const db = openSqlite(entry.path, { readonly: true });
    try {
      if (checkDatabase(db).length > 0) fail('integrity', '백업 파일이 손상되었습니다.');
      if (schemaState(db, this.#d.migrationsDir).newerThanApp) {
        fail('newer-schema', '더 새로운 버전의 앱에서 만든 백업이라 복원할 수 없습니다.');
      }
    } finally {
      db.close();
    }
  }

  /** Restore flow from docs/design/data-model.md#복원-절차. */
  async restore(id: string): Promise<BackupEntry> {
    const entry = this.get(id);
    this.verify(entry);
    return this.#exclusive(async () => {
      const { userDb, maintenance, log, migrate } = this.#d;
      const safety = await this.#create('pre-restore', {});
      maintenance.enter('restore');
      try {
        userDb.close();
        removeSideFiles(userDb.path);
        copyFileSync(entry.path, userDb.path);
        userDb.open();
        await migrate(() => this.#create('pre-migration', {}).then((b) => b.path));
        log.info({ id }, 'backup restored');
        return entry;
      } catch (e) {
        log.error({ err: e, id }, 'restore failed; rolling back to pre-restore backup');
        if (userDb.isOpen) userDb.close();
        removeSideFiles(userDb.path);
        copyFileSync(safety.path, userDb.path);
        userDb.open();
        throw new AppError('RESTORE_FAILED', 500, '복원에 실패해 복원 전 상태로 되돌렸습니다.', {
          cause: e,
        });
      } finally {
        maintenance.exit();
      }
    });
  }
}
