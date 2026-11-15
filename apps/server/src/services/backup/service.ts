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
  type BackupCheck,
  type BackupKind,
  type BackupMeta,
  type BackupProblem,
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
  /** Stops work that writes user.db outside a request (AI turns) before the file is replaced. */
  interrupt?: () => void;
  migrationsDir?: string;
  now?: () => Date;
}

/** The API view of a backup (no file paths). */
export const toSummary = ({
  id,
  kind,
  createdAt,
  appVersion,
  schemaMigration,
  sizeBytes,
}: BackupSummary): BackupSummary => ({
  id,
  kind,
  createdAt,
  appVersion,
  schemaMigration,
  sizeBytes,
});

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
    this.#d = {
      now: () => new Date(),
      interrupt: () => undefined,
      ...deps,
      migrationsDir: deps.migrationsDir,
    };
  }

  /** The folder new backups go to (data-model.md#백업-위치-변경). */
  get backupDir(): string {
    return this.#d.backupDir;
  }

  /**
   * Switches to another folder and proves it is writable with a `manual` backup there. Existing
   * backups stay in the old folder. On failure the old folder stays in use.
   */
  relocate(dir: string): Promise<BackupEntry> {
    return this.#exclusive(async () => {
      const previous = this.#d.backupDir;
      this.#d.backupDir = dir;
      try {
        return await this.#create('manual', {});
      } catch (e) {
        this.#d.backupDir = previous;
        throw e;
      }
    });
  }

  /** Switches folders without a backup (rolling back a relocation that could not be saved). */
  useDir(dir: string): Promise<void> {
    return this.#exclusive(() => {
      this.#d.backupDir = dir;
      return Promise.resolve();
    });
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

  /** Inspects a backup without changing anything: checksum, integrity, schema compatibility. */
  inspect(entry: BackupEntry): { problem: BackupProblem | null; migrationNeeded: boolean } {
    if (sha256File(entry.path) !== entry.meta.sha256)
      return { problem: 'checksum', migrationNeeded: false };
    let db;
    try {
      db = openSqlite(entry.path, { readonly: true });
    } catch {
      return { problem: 'integrity', migrationNeeded: false }; // not a SQLite file at all
    }
    try {
      if (checkDatabase(db).length > 0) return { problem: 'integrity', migrationNeeded: false };
      const state = schemaState(db, this.#d.migrationsDir);
      if (state.newerThanApp) return { problem: 'newer-schema', migrationNeeded: false };
      return { problem: null, migrationNeeded: state.pending.length > 0 };
    } catch {
      return { problem: 'integrity', migrationNeeded: false };
    } finally {
      db.close();
    }
  }

  /** `GET /backups/:id/check`: what the restore dialog shows before the learner confirms. */
  check(id: string): BackupCheck {
    const entry = this.get(id);
    const { problem, migrationNeeded } = this.inspect(entry);
    return { id: entry.id, ok: problem === null, problem, migrationNeeded };
  }

  /** Checks a backup before restoring; throws `RESTORE_FAILED` (409) with `details.reason`. */
  verify(entry: BackupEntry): void {
    const { problem } = this.inspect(entry);
    if (problem === null) return;
    throw new AppError(
      'RESTORE_FAILED',
      409,
      problem === 'newer-schema'
        ? '더 새로운 버전의 앱에서 만든 백업이라 복원할 수 없습니다.'
        : '백업 파일이 손상되었습니다.',
      { details: { reason: problem, id: entry.id } },
    );
  }

  /**
   * Runs a job that rewrites user.db (learning data reset) after a verified safety backup of
   * `kind`, in maintenance mode, with background AI work stopped. Serialized with backups.
   */
  guarded<T>(
    kind: BackupKind,
    reason: string,
    job: () => T | Promise<T>,
  ): Promise<{ backup: BackupEntry; result: T }> {
    return this.#exclusive(async () => {
      const backup = await this.#create(kind, {});
      this.#d.maintenance.enter(reason);
      try {
        this.#d.interrupt();
        return { backup, result: await job() };
      } finally {
        this.#d.maintenance.exit();
      }
    });
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
        this.#d.interrupt();
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
