import { existsSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.ts';

export type Orm = BetterSQLite3Database<typeof schema>;

const PRAGMAS = [
  'journal_mode = WAL',
  'synchronous = NORMAL',
  'foreign_keys = ON',
  'busy_timeout = 5000',
  'temp_store = MEMORY',
  'cache_size = -20000',
];

/** Opens a SQLite file with the connection settings from docs/design/data-model.md#연결-설정-pragma. */
export function openSqlite(path: string, options: { readonly?: boolean } = {}): Database.Database {
  const db = new Database(path, {
    readonly: options.readonly ?? false,
    fileMustExist: options.readonly ?? false,
  });
  for (const p of options.readonly ? ['foreign_keys = ON', 'busy_timeout = 5000'] : PRAGMAS)
    db.pragma(p);
  return db;
}

/** `PRAGMA integrity_check` + `foreign_key_check`; returns problems (empty = healthy). */
export function checkDatabase(db: Database.Database): string[] {
  const integrity = db.pragma('integrity_check', { simple: true });
  const problems = integrity === 'ok' ? [] : [`integrity_check: ${String(integrity)}`];
  const fk = db.pragma('foreign_key_check') as unknown[];
  if (fk.length > 0) problems.push(`foreign_key_check: ${fk.length} violation(s)`);
  return problems;
}

/** Removes WAL side files so a replaced database file is not mixed with a stale journal. */
export function removeSideFiles(path: string): void {
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(path + suffix)) rmSync(path + suffix);
  }
}

/**
 * Owns the user.db connection. Restore needs to close and reopen it, so callers always go
 * through `sqlite`/`orm` instead of holding on to a handle.
 */
export class UserDb {
  readonly path: string;
  #sqlite: Database.Database | null = null;
  #orm: Orm | null = null;

  constructor(path: string) {
    this.path = path;
  }

  open(): this {
    if (!this.#sqlite) {
      this.#sqlite = openSqlite(this.path);
      this.#orm = drizzle(this.#sqlite, { schema });
    }
    return this;
  }

  get sqlite(): Database.Database {
    if (!this.#sqlite) throw new Error('user.db is not open');
    return this.#sqlite;
  }

  get orm(): Orm {
    if (!this.#orm) throw new Error('user.db is not open');
    return this.#orm;
  }

  get isOpen(): boolean {
    return this.#sqlite !== null;
  }

  /** Checkpoints the WAL and closes (shutdown and before file replacement). */
  close(): void {
    if (!this.#sqlite) return;
    try {
      this.#sqlite.pragma('wal_checkpoint(TRUNCATE)');
      this.#sqlite.pragma('optimize');
    } finally {
      this.#sqlite.close();
      this.#sqlite = null;
      this.#orm = null;
    }
  }
}
