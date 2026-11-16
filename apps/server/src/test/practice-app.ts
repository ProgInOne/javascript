import { MockProvider, TaskRunner } from '@proginone/ai';
import { createApp } from '../http/app.ts';
import { TOKEN_HEADER } from '../http/security.ts';
import { ContentAccess } from '../services/curriculum/content-access.ts';
import { createEngine } from '../services/practice/engine.ts';
import { createPracticeServices } from '../services/practice/index.ts';
import { AiService } from '../services/ai/ai-service.ts';
import { SettingsService } from '../services/settings/service.ts';
import { EvaluatorService } from '../services/tutor/evaluator-service.ts';
import { MemoryService } from '../services/tutor/memory-service.ts';
import { TutorService } from '../services/tutor/tutor-service.ts';
import { addTemplateFixture, writeContentDb } from './content-fixture.ts';
import { setupDb, silentLog } from './helpers.ts';

/** 2026-11-14 10:00 Asia/Seoul. */
export const T0 = Date.UTC(2026, 10, 14, 1, 0, 0);
export const MINUTE = 60_000;
export const DAY = 86_400_000;

let engine: ReturnType<typeof createEngine> | undefined;

/**
 * The real app over a migrated temp user.db and the fixture content.db, with a controllable
 * clock (`clock.now`) and a learner in Asia/Seoul. AI routes use a `MockProvider` (`ai.provider`).
 * `templates: true` adds the parametric template unit (`addTemplateFixture`; pool in `pool`).
 */
export async function practiceApp(options: { templates?: boolean } = {}) {
  const ctx = await setupDb();
  const contentPath = writeContentDb();
  const pool = options.templates ? addTemplateFixture(contentPath) : [];
  const content = ContentAccess.open(contentPath);
  const clock = { now: T0 };
  const now = () => clock.now;
  const settings = new SettingsService({ userDb: ctx.userDb, log: silentLog });
  const practice = createPracticeServices({
    userDb: ctx.userDb,
    content,
    engine: await (engine ??= createEngine()),
    now,
    hintPolicy: () => settings.get()['hints.policy'],
  });
  const provider = new MockProvider({ deltaDelayMs: 0 });
  const aiService = new AiService({ provider, log: silentLog, userDb: ctx.userDb });
  const runner = new TaskRunner({ provider, now, sleep: () => Promise.resolve() });
  const evaluator = new EvaluatorService({
    userDb: ctx.userDb,
    content,
    runner,
    ai: aiService,
    now,
    log: silentLog,
  });
  const memory = new MemoryService({
    userDb: ctx.userDb,
    content,
    runner,
    ai: aiService,
    now,
    log: silentLog,
    proposals: evaluator,
  });
  const tutor = new TutorService({
    userDb: ctx.userDb,
    content,
    runner,
    ai: aiService,
    now,
    log: silentLog,
    memory,
  });
  const app = createApp({
    config: { port: 4310, mode: 'production' },
    log: silentLog,
    token: 't',
    backups: ctx.backups,
    settings,
    content,
    practice,
    ai: { ai: aiService, tutor, memory, evaluator, keepAliveMs: 50 },
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
    const sse = (res.headers.get('content-type') ?? '').startsWith('text/event-stream');
    return {
      status: res.status,
      text,
      json: text && !sse ? (JSON.parse(text) as unknown) : null,
    };
  };
  /** Raw response for streaming endpoints. */
  const open = (method: string, path: string, body?: unknown) =>
    app.request(`http://127.0.0.1:4310/api/v1${path}`, {
      method,
      headers: {
        host: '127.0.0.1:4310',
        [TOKEN_HEADER]: 't',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    ...ctx,
    content,
    pool,
    clock,
    call,
    open,
    practice,
    ai: { provider, service: aiService, tutor, memory, evaluator, runner },
  };
}

/** Row count of a user.db table. */
export function count(
  ctx: { userDb: { sqlite: { prepare(sql: string): { get(): unknown } } } },
  table: string,
) {
  return (ctx.userDb.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}
