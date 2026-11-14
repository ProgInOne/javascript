import { ContentAccess } from '../../services/curriculum/content-access.ts';
import { apiErrorSchema, backupListSchema, backupSummarySchema } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { setupDb, silentLog } from '../../test/helpers.ts';
import { SettingsService } from '../../services/settings/service.ts';
import type { PracticeServices } from '../../services/practice/index.ts';
import { createApp } from '../app.ts';
import { TOKEN_HEADER } from '../security.ts';

async function setup() {
  const ctx = await setupDb();
  const app = createApp({
    config: { port: 4310, mode: 'production' },
    log: silentLog,
    token: 't',
    backups: ctx.backups,
    settings: new SettingsService({ userDb: ctx.userDb, log: silentLog }),
    content: ContentAccess.unavailable(),
    practice: {} as PracticeServices,
    maintenance: ctx.maintenance,
  });
  const call = (method: string, path: string) =>
    app.request(`http://127.0.0.1:4310/api/v1${path}`, {
      method,
      headers: { host: '127.0.0.1:4310', [TOKEN_HEADER]: 't' },
    });
  return { ...ctx, call };
}

describe('backup routes', () => {
  it('creates, lists, and restores', async () => {
    const { call } = await setup();
    const created = await call('POST', '/backups');
    expect(created.status).toBe(201);
    const summary = backupSummarySchema.parse(await created.json());
    expect(summary.kind).toBe('manual');

    const list = backupListSchema.parse(await (await call('GET', '/backups')).json());
    expect(list.backups.map((b) => b.id)).toContain(summary.id);

    const restored = await call('POST', `/backups/${encodeURIComponent(summary.id)}/restore`);
    expect(restored.status).toBe(200);
  });

  it('validates the id', async () => {
    const { call } = await setup();
    const res = await call('POST', '/backups/not-an-id/restore');
    expect(res.status).toBe(400);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 404 for a well-formed unknown id', async () => {
    const { call } = await setup();
    const res = await call(
      'POST',
      `/backups/${encodeURIComponent('manual:2020-01-01T000000000Z')}/restore`,
    );
    expect(res.status).toBe(404);
  });
});
