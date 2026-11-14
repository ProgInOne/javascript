import { eq } from 'drizzle-orm';
import type { UserDb } from '../../db/user/connection.ts';
import { appMeta } from '../../db/user/schema.ts';
import type { Logger } from '../../observability/logger.ts';
import { isoWeek, localDate } from './local-date.ts';
import type { BackupService } from './service.ts';

export interface DayBoundary {
  timezone: string;
  dayStartHour: number;
}

/**
 * Daily/weekly backup triggers (docs/design/data-model.md#백업-트리거): on startup and hourly.
 * The weekly backup is the same snapshot as the first daily backup of a new ISO week.
 */
export class BackupScheduler {
  readonly #userDb: UserDb;
  readonly #backups: BackupService;
  readonly #log: Logger;
  readonly #boundary: () => DayBoundary;
  readonly #now: () => Date;
  #timer: NodeJS.Timeout | null = null;

  constructor(deps: {
    userDb: UserDb;
    backups: BackupService;
    log: Logger;
    boundary: () => DayBoundary;
    now?: () => Date;
  }) {
    this.#userDb = deps.userDb;
    this.#backups = deps.backups;
    this.#log = deps.log;
    this.#boundary = deps.boundary;
    this.#now = deps.now ?? (() => new Date());
  }

  #meta(key: string): string | undefined {
    return this.#userDb.orm.select().from(appMeta).where(eq(appMeta.key, key)).get()?.value;
  }

  #setMeta(key: string, value: string): void {
    this.#userDb.orm
      .insert(appMeta)
      .values({ key, value })
      .onConflictDoUpdate({ target: appMeta.key, set: { value } })
      .run();
  }

  /** Runs the daily (and weekly) backup when due. Returns what was created. */
  async tick(): Promise<{ daily: boolean; weekly: boolean }> {
    const { timezone, dayStartHour } = this.#boundary();
    const today = localDate(this.#now(), timezone, dayStartHour);
    if (this.#meta('last_daily_backup_date') === today) return { daily: false, weekly: false };

    const entry = await this.#backups.create('daily');
    this.#setMeta('last_daily_backup_date', today);
    const week = isoWeek(today);
    if (this.#meta('last_weekly_backup_week') === week) return { daily: true, weekly: false };
    this.#backups.copyAs(entry, 'weekly', week);
    this.#setMeta('last_weekly_backup_week', week);
    return { daily: true, weekly: true };
  }

  start(intervalMs = 3_600_000): void {
    const run = () => {
      this.tick().catch((e: unknown) => {
        this.#log.error({ err: e }, 'scheduled backup failed');
      });
    };
    run();
    this.#timer = setInterval(run, intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }
}
