import { apiErrorSchema } from '@proginone/shared';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from './app.ts';
import { AppError } from './errors.ts';
import { MaintenanceState, TOKEN_HEADER } from './security.ts';

const TOKEN = 'test-token-0123456789';
const log = pino({ level: 'silent' });

function setup(mode: 'production' | 'development' = 'production') {
  const state = new MaintenanceState();
  const app = createApp({ config: { port: 4310, mode }, log, token: TOKEN, maintenance: state });
  const req = (path: string, headers: Record<string, string> = {}, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1:4310${path}`, {
      ...init,
      headers: { host: '127.0.0.1:4310', [TOKEN_HEADER]: TOKEN, ...headers },
    });
  return { app, req, state };
}

async function errorCode(res: Response) {
  return apiErrorSchema.parse(await res.json()).error.code;
}

describe('security middleware', () => {
  it('serves /api/v1/health with a valid host and token', async () => {
    const res = await setup().req('/api/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', version: '0.0.0' });
  });

  it.each([
    ['foreign host (DNS rebinding)', 'evil.example:4310'],
    ['wrong port', '127.0.0.1:9999'],
    ['missing port', 'localhost'],
  ])('rejects %s', async (_, host) => {
    const res = await setup().req('/api/v1/health', { host });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('FORBIDDEN_HOST');
  });

  it('accepts localhost on our port', async () => {
    const res = await setup().req('/api/v1/health', { host: 'localhost:4310' });
    expect(res.status).toBe(200);
  });

  it('lets shell subdomains reach only /sandbox/*', async () => {
    const { req } = setup();
    const api = await req('/api/v1/health', { host: 's1.localhost:4310' });
    expect(api.status).toBe(403);
    expect(await errorCode(api)).toBe('FORBIDDEN_HOST');
    // Not served yet (runner arrives in M4), but the host check passes: 404, not 403.
    const runner = await req('/sandbox/runner.html', { host: 's1.localhost:4310' });
    expect(runner.status).toBe(404);
  });

  it.each([
    ['opaque sandbox origin', 'null'],
    ['foreign site', 'https://evil.example'],
    ['vite dev origin in production', 'http://127.0.0.1:5173'],
  ])('rejects /api from %s', async (_, origin) => {
    const res = await setup().req('/api/v1/health', { origin });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('FORBIDDEN_ORIGIN');
  });

  it('allows the Vite dev origin in development', async () => {
    const res = await setup('development').req('/api/v1/health', {
      origin: 'http://127.0.0.1:5173',
    });
    expect(res.status).toBe(200);
  });

  it.each([
    ['missing', undefined],
    ['wrong', 'nope'],
    ['same length but different', 'test-token-0123456780'],
  ])('rejects a %s token on GET', async (_, value) => {
    const { app } = setup();
    const headers: Record<string, string> = { host: '127.0.0.1:4310' };
    if (value !== undefined) headers[TOKEN_HEADER] = value;
    const res = await app.request('http://127.0.0.1:4310/api/v1/health', { headers });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('UNAUTHORIZED');
  });
});

describe('maintenance mode', () => {
  it('answers 503 MAINTENANCE while active and recovers after exit', async () => {
    const { req, state } = setup();
    state.enter('restore');
    const res = await req('/api/v1/health');
    expect(res.status).toBe(503);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error).toMatchObject({
      code: 'MAINTENANCE',
      retryable: true,
      details: { reason: 'restore' },
    });
    state.exit();
    expect((await req('/api/v1/health')).status).toBe(200);
  });
});

describe('error model', () => {
  function appWithRoutes() {
    const app = createApp({ config: { port: 4310, mode: 'production' }, log, token: TOKEN });
    app.get('/api/v1/_test/app-error', () => {
      throw new AppError('BACKUP_NOT_FOUND', 404, '백업이 없습니다.', { details: { id: 'b1' } });
    });
    app.get('/api/v1/_test/zod', () => {
      z.object({ n: z.number() }).parse({ n: 'x' });
      return new Response();
    });
    app.get('/api/v1/_test/boom', () => {
      throw new Error('secret internals');
    });
    return (path: string) =>
      app.request(`http://127.0.0.1:4310${path}`, {
        headers: { host: '127.0.0.1:4310', [TOKEN_HEADER]: TOKEN },
      });
  }

  it('maps AppError to its code and status', async () => {
    const res = await appWithRoutes()('/api/v1/_test/app-error');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: {
        code: 'BACKUP_NOT_FOUND',
        message: '백업이 없습니다.',
        retryable: false,
        details: { id: 'b1' },
      },
    });
  });

  it('maps ZodError to VALIDATION_FAILED', async () => {
    const res = await appWithRoutes()('/api/v1/_test/zod');
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION_FAILED');
  });

  it('hides unexpected errors behind INTERNAL', async () => {
    const res = await appWithRoutes()('/api/v1/_test/boom');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret internals');
    expect(apiErrorSchema.parse(JSON.parse(text)).error.code).toBe('INTERNAL');
  });

  it('returns NOT_FOUND for unknown routes', async () => {
    const res = await appWithRoutes()('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('NOT_FOUND');
  });
});
