import type Database from 'better-sqlite3';
import type { ResetResponse } from '@proginone/shared';
import { checkDatabase, type UserDb } from '../../db/user/connection.ts';
import { AppError } from '../../http/errors.ts';
import type { Logger } from '../../observability/logger.ts';
import { toSummary, type BackupService } from '../backup/service.ts';

/**
 * Tables a reset keeps (D-045): migration history, app bookkeeping (backup dates, content pack
 * version), the learner row (time zone and day boundary) and UI settings. Every other table is
 * learning data, so a table added by a later migration is wiped by default.
 */
export const KEPT_TABLES = new Set(['__drizzle_migrations', 'app_meta', 'learners', 'settings']);

interface TableRow {
  name: string;
  sql: string | null;
}

/** The tables `wipeLearningData` empties, in a stable order. FTS shadow tables are skipped. */
export function learningTables(sqlite: Database.Database): string[] {
  const rows = sqlite
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as TableRow[];
  const virtual = rows
    .filter((r) => r.sql?.toUpperCase().startsWith('CREATE VIRTUAL TABLE'))
    .map((r) => r.name);
  return rows
    .map((r) => r.name)
    .filter((n) => !KEPT_TABLES.has(n))
    .filter((n) => !virtual.some((v) => n !== v && n.startsWith(`${v}_`)));
}

/**
 * Deletes every learning record in one transaction (data-model.md#보관soft-delete-정책:
 * "학습 기록 테이블 전체 DELETE") and sends the learner back to onboarding. Foreign keys are
 * checked at commit, so the delete order does not matter.
 */
export function wipeLearningData(sqlite: Database.Database): string[] {
  const tables = learningTables(sqlite);
  sqlite.transaction(() => {
    sqlite.pragma('defer_foreign_keys = ON');
    for (const t of tables) sqlite.prepare(`DELETE FROM "${t.replaceAll('"', '""')}"`).run();
    sqlite.prepare("UPDATE learners SET onboarded_at = NULL, experience_level = 'none'").run();
  })();
  return tables;
}

/** `POST /data/reset` (FR-SET-07): `pre-reset` backup first, then wipe in maintenance mode. */
export class DataResetService {
  readonly #userDb: UserDb;
  readonly #backups: BackupService;
  readonly #log: Logger;

  constructor(deps: { userDb: UserDb; backups: BackupService; log: Logger }) {
    this.#userDb = deps.userDb;
    this.#backups = deps.backups;
    this.#log = deps.log;
  }

  async reset(): Promise<ResetResponse> {
    const { backup } = await this.#backups.guarded('pre-reset', 'reset', () => {
      try {
        const tables = wipeLearningData(this.#userDb.sqlite);
        const problems = checkDatabase(this.#userDb.sqlite);
        if (problems.length > 0) throw new Error(problems.join('; '));
        this.#log.info({ tables: tables.length }, 'learning data reset');
      } catch (e) {
        this.#log.error({ err: e }, 'learning data reset failed');
        throw new AppError(
          'RESET_FAILED',
          500,
          '학습 데이터를 초기화하지 못했습니다. 데이터는 그대로입니다.',
          { cause: e },
        );
      }
    });
    return {
      backup: toSummary(backup),
    };
  }
}
