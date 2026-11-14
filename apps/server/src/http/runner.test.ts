import { ContentAccess } from '../services/curriculum/content-access.ts';
import { SHELL_CSP } from '@proginone/runner/shell-build';
import { describe, expect, it } from 'vitest';
import type { BackupService } from '../services/backup/service.ts';
import type { SettingsService } from '../services/settings/service.ts';
import { silentLog } from '../test/helpers.ts';
import { createApp } from './app.ts';
import { appCsp } from './web.ts';

function setup(mode: 'production' | 'development' = 'production') {
  const app = createApp({
    config: { port: 4310, mode },
    log: silentLog,
    token: 'test-token-0123456789',
    backups: {} as BackupService,
    settings: {} as SettingsService,
    content: ContentAccess.unavailable(),
  });
  return (path: string, host: string) =>
    app.request(`http://127.0.0.1:4310${path}`, { headers: { host } });
}

describe('runner shell route', () => {
  it.each([
    ['a per-shell site', 'k3j9x2.localhost:4310'],
    ['the same-site fallback', '127.0.0.1:4310'],
  ])('serves /sandbox/runner.html with the shell CSP on %s', async (_, host) => {
    const res = await setup()('/sandbox/runner.html?v=1', host);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('content-security-policy')).toBe(SHELL_CSP);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const body = await res.text();
    expect(body.startsWith('<!doctype html>')).toBe(true);
    expect(body).toContain('shell-hello');
  });

  it('is served in development too (Vite serves the app, the server serves the shell)', async () => {
    const res = await setup('development')('/sandbox/runner.html', 'localhost:4310');
    expect(res.status).toBe(200);
  });

  it('never gets the app CSP or the session token', async () => {
    const res = await setup()('/sandbox/runner.html', 'abc.localhost:4310');
    expect(res.headers.get('content-security-policy')).not.toBe(appCsp(4310));
    expect(await res.text()).not.toContain('test-token-0123456789');
  });

  it('keeps shell sites away from everything else', async () => {
    const req = setup();
    expect((await req('/', 'abc.localhost:4310')).status).toBe(403);
    expect((await req('/api/v1/health', 'abc.localhost:4310')).status).toBe(403);
    expect((await req('/sandbox/runner.html', 'a.b.localhost:4310')).status).toBe(403);
  });

  it('allows the shell sites in the app CSP', () => {
    expect(appCsp(4310)).toContain("frame-src 'self' http://*.localhost:4310");
  });
});
