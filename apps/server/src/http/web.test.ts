import { SETTINGS_DEFAULTS } from '@proginone/shared';
import { ContentAccess } from '../services/curriculum/content-access.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SettingsService } from '../services/settings/service.ts';
import { setupDb, silentLog, tmpDir } from '../test/helpers.ts';
import type { PracticeServices } from '../services/practice/index.ts';
import { createApp } from './app.ts';
import { TOKEN_HEADER } from './security.ts';
import { injectToken } from './web.ts';

const TOKEN = 'tok_ABC-123';

async function setup(withDist = true) {
  const ctx = await setupDb();
  const distDir = tmpDir('proginone-dist-');
  if (withDist) {
    mkdirSync(join(distDir, 'assets'));
    writeFileSync(
      join(distDir, 'index.html'),
      '<!doctype html><html><head><title>P</title></head><body></body></html>',
    );
    writeFileSync(join(distDir, 'assets', 'app-1a2b.js'), 'console.log(1)');
    writeFileSync(join(distDir, 'favicon.svg'), '<svg/>');
  }
  const app = createApp({
    config: { port: 4310, mode: 'production' },
    log: silentLog,
    token: TOKEN,
    backups: ctx.backups,
    settings: new SettingsService({ userDb: ctx.userDb, log: silentLog }),
    content: ContentAccess.unavailable(),
    practice: {} as PracticeServices,
    maintenance: ctx.maintenance,
    webDistDir: distDir,
  });
  const get = (path: string, headers: Record<string, string> = {}) =>
    app.request(`http://127.0.0.1:4310${path}`, {
      headers: { host: '127.0.0.1:4310', ...headers },
    });
  return { get, app };
}

describe('web app serving', () => {
  it('serves index.html for app routes with the token and a strict CSP', async () => {
    const { get } = await setup();
    for (const path of ['/', '/settings/data']) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(`<meta name="proginone-token" content="${TOKEN}"></head>`);
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-src 'self' http://*.localhost:4310");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('serves hashed assets with long-lived caching', async () => {
    const { get } = await setup();
    const res = await get('/assets/app-1a2b.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect((await get('/favicon.svg')).status).toBe(200);
  });

  it('never serves the raw index.html', async () => {
    const res = await (await setup()).get('/index.html');
    expect(res.status).toBe(302);
  });

  it('keeps JSON 404s for unknown API routes', async () => {
    const res = await (await setup()).get('/api/v1/nope', { [TOKEN_HEADER]: TOKEN });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('explains a missing build', async () => {
    const res = await (await setup(false)).get('/');
    expect(res.status).toBe(503);
  });
});

describe('settings routes', () => {
  it('reads and patches settings, rejecting unknown keys and bad values', async () => {
    const { app } = await setup();
    const call = (method: string, body?: unknown) =>
      app.request('http://127.0.0.1:4310/api/v1/settings', {
        method,
        headers: {
          host: '127.0.0.1:4310',
          [TOKEN_HEADER]: TOKEN,
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    expect(await (await call('GET')).json()).toEqual(SETTINGS_DEFAULTS);
    expect(await (await call('PATCH', { theme: 'dark' })).json()).toEqual({
      ...SETTINGS_DEFAULTS,
      theme: 'dark',
    });
    expect((await call('PATCH', { 'hints.policy': 'never' })).status).toBe(400);
    expect((await call('PATCH', { 'editor.autocomplete': 'yes' })).status).toBe(400);
    expect((await call('PATCH', { theme: 'neon' })).status).toBe(400);
    expect((await call('PATCH', { nope: 1 })).status).toBe(400);
  });
});

describe('injectToken', () => {
  it('requires a head element', () => {
    expect(() => injectToken('<html></html>', 't')).toThrow();
  });
});
