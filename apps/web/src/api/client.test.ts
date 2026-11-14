import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiRequestError, createApiClient, readToken, TOKEN_HEADER } from './client.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api client', () => {
  it('sends the token and validates the response', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(json(200, { theme: 'dark' })));
    const request = createApiClient({ token: () => 't1', fetchImpl });
    const out = await request('/settings', { schema: z.object({ theme: z.string() }) });
    expect(out).toEqual({ theme: 'dark' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/settings');
    expect((init.headers as Record<string, string>)[TOKEN_HEADER]).toBe('t1');
  });

  it('serializes JSON bodies', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(json(200, {})));
    await createApiClient({ token: () => '', fetchImpl })('/settings', {
      method: 'PATCH',
      body: { theme: 'light' },
      schema: z.object({}),
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe('{"theme":"light"}');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('turns API errors into ApiRequestError with the server code', async () => {
    const body = { error: { code: 'MAINTENANCE', message: '정리 중', retryable: true } };
    const request = createApiClient({
      token: () => '',
      fetchImpl: () => Promise.resolve(json(503, body)),
    });
    await expect(request('/x', { schema: z.unknown() })).rejects.toMatchObject({
      code: 'MAINTENANCE',
      status: 503,
      retryable: true,
    });
  });

  it('rejects responses that do not match the schema', async () => {
    const request = createApiClient({
      token: () => '',
      fetchImpl: () => Promise.resolve(json(200, { theme: 3 })),
    });
    await expect(request('/x', { schema: z.object({ theme: z.string() }) })).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
    });
  });

  it('reports network failures as retryable', async () => {
    const request = createApiClient({
      token: () => '',
      fetchImpl: () => Promise.reject(new TypeError('fail')),
    });
    const err = await request('/x', { schema: z.unknown() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ code: 'NETWORK', retryable: true });
  });

  it('reads the token meta tag', () => {
    const doc = document.implementation.createHTMLDocument();
    doc.head.innerHTML = '<meta name="proginone-token" content="abc">';
    expect(readToken(doc)).toBe('abc');
  });
});
