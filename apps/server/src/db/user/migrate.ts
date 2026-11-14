import { copyFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkDatabase, removeSideFiles, type UserDb } from './connection.ts';

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function journal(dir = MIGRATIONS_DIR): JournalEntry[] {
  const raw = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  return raw.entries;
}

/** `created_at` of the last applied migration, or null for an empty database. */
function lastAppliedMillis(db: Database.Database): number | null {
  const table = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();
  if (!table) return null;
  const row = db.prepare('SELECT MAX(created_at) AS m FROM __drizzle_migrations').get() as {
    m: number | null;
  };
  return row.m;
}

export interface SchemaState {
  /** Tag of the last applied migration (e.g. `0000_init`), null when nothing is applied. */
  current: string | null;
  /** Tag of the newest migration this app ships. */
  latest: string;
  pending: string[];
  /** The database has migrations this app does not know (written by a newer app). */
  newerThanApp: boolean;
}

export function schemaState(db: Database.Database, dir = MIGRATIONS_DIR): SchemaState {
  const entries = journal(dir);
  const latest = entries.at(-1);
  if (!latest) throw new Error('no migrations found');
  const applied = lastAppliedMillis(db);
  const current = applied === null ? null : (entries.find((e) => e.when === applied)?.tag ?? null);
  return {
    current,
    latest: latest.tag,
    pending: entries.filter((e) => applied === null || e.when > applied).map((e) => e.tag),
    newerThanApp: applied !== null && current === null,
  };
}

export class MigrationError extends Error {
  readonly backupPath: string | null;

  constructor(message: string, backupPath: string | null, cause?: unknown) {
    super(message, { cause });
    this.name = 'MigrationError';
    this.backupPath = backupPath;
  }
}

export interface MigrateOptions {
  /** Makes a verified `pre-migration` backup and returns its file path. */
  backup: () => Promise<string>;
  migrationsDir?: string;
}

/**
 * Startup migration (docs/design/data-model.md#마이그레이션-정책): skip when up to date; otherwise
 * back up, migrate, verify, and on failure put the backup file back and throw.
 * Returns the tags that were applied.
 */
export async function migrateUserDb(
  userDb: UserDb,
  { backup, migrationsDir = MIGRATIONS_DIR }: MigrateOptions,
) {
  const state = schemaState(userDb.sqlite, migrationsDir);
  if (state.newerThanApp) {
    throw new MigrationError(
      '이 데이터는 더 새로운 버전의 ProgInOne이 만든 것입니다. 앱을 업데이트하세요.',
      null,
    );
  }
  if (state.pending.length === 0) return [];

  // A brand-new database has nothing to protect.
  const backupPath = state.current === null ? null : await backup();

  try {
    readMigrationFiles({ migrationsFolder: migrationsDir }); // fail fast on unreadable files
    migrate(userDb.orm, { migrationsFolder: migrationsDir });
    const problems = checkDatabase(userDb.sqlite);
    if (problems.length > 0) throw new Error(problems.join('; '));
    return state.pending;
  } catch (e) {
    userDb.close();
    if (backupPath) {
      copyFileSync(backupPath, userDb.path);
      removeSideFiles(userDb.path);
    }
    throw new MigrationError(
      backupPath
        ? `데이터베이스 업데이트에 실패해 이전 상태로 복구했습니다. 백업: ${backupPath}`
        : '데이터베이스를 초기화하지 못했습니다.',
      backupPath,
      e,
    );
  }
}
