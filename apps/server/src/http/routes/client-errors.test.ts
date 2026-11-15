import { CLIENT_ERROR_LIMITS } from '@proginone/shared';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { ContentAccess } from '../../services/curriculum/content-access.ts';
import type { PracticeServices } from '../../services/practice/index.ts';
import { SettingsService } from '../../services/settings/service.ts';
import { setupDb } from '../../test/helpers.ts';
import { createApp } from '../app.ts';
import { TOKEN_HEADER } from '../security.ts';
import { CLIENT_ERROR_RATE } from './client-errors.ts';

/** An app whose logger writes JSON lines into `lines`. */
async function setup() {
  const ctx = await setupDb();
  const lines: Record<string, unknown>[] = [];
  const log = pino(
    { level: 'info' },
    { write: (s: string) => void lines.push(JSON.parse(s) as Record<string, unknown>) },
  );
  const app = createApp({
    config: { port: 4310, mode: 'production' },
    log,
    token: 't',
    backups: ctx.backups,
    settings: new SettingsService({ userDb: ctx.userDb, log }),
    content: ContentAccess.unavailable(),
    practice: {} as PracticeServices,
  });
  const post = (body: unknown, headers: Record<string, string> = { [TOKEN_HEADER]: 't' }) =>
    app.request('http://127.0.0.1:4310/api/v1/client-errors', {
      method: 'POST',
      headers: { host: '127.0.0.1:4310', 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const reports = () => lines.filter((l) => l['msg'] === 'client error');
  return { post, reports };
}

const report = {
  source: 'boundary',
  name: 'TypeError',
  message: "Cannot read properties of undefined (reading 'title')",
  stack: 'TypeError: Cannot read …\n    at LessonBody (LessonBody.tsx:10:5)',
  path: '/learn/js-basics.start.first-program',
};

describe('POST /client-errors', () => {
  it('logs a reported error as structured JSON and answers 204', async () => {
    const { post, reports } = await setup();
    const res = await post(report);
    expect(res.status).toBe(204);
    const [line] = reports();
    expect(line).toMatchObject({ level: 40, clientError: report });
    expect(line?.['requestId']).toEqual(expect.any(String));
  });

  it('requires the session token like every other API call', async () => {
    const { post, reports } = await setup();
    const res = await post(report, {});
    expect(res.status).toBe(401);
    expect(reports()).toHaveLength(0);
  });

  it('rejects malformed, oversized and unknown fields without logging them', async () => {
    const { post, reports } = await setup();
    const bad = [
      '{not json',
      { ...report, source: 'console' },
      { ...report, path: 'https://evil.example/' },
      { ...report, message: 'x'.repeat(CLIENT_ERROR_LIMITS.message + 1) },
      { ...report, extra: 1 },
      JSON.stringify({ ...report, __proto__: { polluted: true } }).replace(
        '"source"',
        '"__proto__":{"x":1},"source"',
      ),
    ];
    for (const body of bad) expect((await post(body)).status).toBe(400);
    expect((await post({ ...report, stack: 'x'.repeat(20_000) })).status).toBe(413);
    expect(reports()).toHaveLength(0);
  });

  it(`logs at most ${String(CLIENT_ERROR_RATE.max)} reports a minute`, async () => {
    const { post, reports } = await setup();
    for (let i = 0; i < CLIENT_ERROR_RATE.max + 5; i++) {
      expect((await post({ ...report, message: `error ${String(i)}` })).status).toBe(204);
    }
    expect(reports()).toHaveLength(CLIENT_ERROR_RATE.max);
  });
});
