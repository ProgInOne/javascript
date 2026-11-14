import { createApp } from '../http/app.ts';
import { TOKEN_HEADER } from '../http/security.ts';
import { ContentAccess } from '../services/curriculum/content-access.ts';
import { createPracticeServices } from '../services/practice/index.ts';
import { SettingsService } from '../services/settings/service.ts';
import { writeContentDb } from './content-fixture.ts';
import { setupDb, silentLog } from './helpers.ts';

/** 2026-11-14 10:00 Asia/Seoul. */
export const T0 = Date.UTC(2026, 10, 14, 1, 0, 0);
export const MINUTE = 60_000;
export const DAY = 86_400_000;

/**
 * The real app over a migrated temp user.db and the fixture content.db, with a controllable
 * clock (`clock.now`) and a learner in Asia/Seoul.
 */
export async function practiceApp() {
  const ctx = await setupDb();
  const content = ContentAccess.open(writeContentDb());
  const clock = { now: T0 };
  const now = () => clock.now;
  const practice = createPracticeServices({ userDb: ctx.userDb, content, now });
  const app = createApp({
    config: { port: 4310, mode: 'production' },
    log: silentLog,
    token: 't',
    backups: ctx.backups,
    settings: new SettingsService({ userDb: ctx.userDb, log: silentLog }),
    content,
    practice,
    maintenance: ctx.maintenance,
  });
  ctx.userDb.sqlite
    .prepare(
      "INSERT INTO learners (id, timezone, day_start_hour, created_at) VALUES ('01JD3Z8Q6V2K9M4T7R1X5W0BNC', 'Asia/Seoul', 4, ?)",
    )
    .run(T0);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`http://127.0.0.1:4310/api/v1${path}`, {
      method,
      headers: {
        host: '127.0.0.1:4310',
        [TOKEN_HEADER]: 't',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, text, json: text ? (JSON.parse(text) as unknown) : null };
  };
  return { ...ctx, content, clock, call, practice };
}

/** Row count of a user.db table. */
export function count(
  ctx: { userDb: { sqlite: { prepare(sql: string): { get(): unknown } } } },
  table: string,
) {
  return (ctx.userDb.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}
