import { CLIENT_ERROR_LIMITS, clientErrorReportSchema } from '@proginone/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/client.ts';
import {
  createErrorReporter,
  installGlobalErrorReporting,
  MAX_REPORTS_PER_PAGE,
  toReport,
} from './client-errors.ts';

function reporter(path = '/learn/js-basics.start.first-program') {
  const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })));
  const report = createErrorReporter({ fetchImpl, token: () => 'tok', location: () => path });
  const bodies = () =>
    fetchImpl.mock.calls.map(([, init]) => JSON.parse(init?.body as string) as unknown);
  return { report, fetchImpl, bodies };
}

describe('toReport', () => {
  it('builds a body the server schema accepts, clipped to the limits', () => {
    const error = new TypeError('x'.repeat(5000));
    error.stack = 's'.repeat(10_000);
    const body = toReport('boundary', error, '/review');
    expect(clientErrorReportSchema.parse(body)).toEqual(body);
    expect(body?.message).toHaveLength(CLIENT_ERROR_LIMITS.message);
    expect(body?.stack).toHaveLength(CLIENT_ERROR_LIMITS.stack);
    expect(body).toMatchObject({ source: 'boundary', name: 'TypeError', path: '/review' });
  });

  it('skips API errors the server already logged, but not responses it could not parse', () => {
    expect(toReport('boundary', new ApiRequestError('NETWORK', 'down', 0, true), '/')).toBeNull();
    expect(
      toReport('boundary', new ApiRequestError('NOT_FOUND', 'gone', 404, false), '/'),
    ).toBeNull();
    expect(
      toReport('boundary', new ApiRequestError('BAD_RESPONSE', 'odd', 200, false), '/'),
    ).toMatchObject({ name: 'ApiRequestError', message: 'odd' });
  });

  it('skips aborts and accepts non-Error rejections', () => {
    expect(toReport('window', new DOMException('stop', 'AbortError'), '/')).toBeNull();
    expect(toReport('unhandledrejection', 'plain reason', '/')).toEqual({
      source: 'unhandledrejection',
      message: 'plain reason',
      path: '/',
    });
  });
});

describe('createErrorReporter', () => {
  it('posts the report with the session token', () => {
    const { report, fetchImpl, bodies } = reporter();
    report('window', new Error('boom'));
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/client-errors');
    expect(init).toMatchObject({
      method: 'POST',
      keepalive: true,
      headers: { 'x-proginone-token': 'tok' },
    });
    expect(bodies()).toEqual([
      expect.objectContaining({
        source: 'window',
        message: 'boom',
        path: '/learn/js-basics.start.first-program',
      }),
    ]);
  });

  it('reports the same error once and stops after the per-page cap', () => {
    const { report, fetchImpl } = reporter();
    report('boundary', new Error('same'));
    report('boundary', new Error('same'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (let i = 0; i < MAX_REPORTS_PER_PAGE + 10; i++)
      report('window', new Error(`e${String(i)}`));
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_REPORTS_PER_PAGE);
  });

  it('never throws, even when sending fails', () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new Error('offline')));
    const report = createErrorReporter({ fetchImpl, token: () => 't', location: () => '/' });
    expect(() => {
      report('window', new Error('x'));
    }).not.toThrow();
    const throwing = createErrorReporter({
      fetchImpl: () => {
        throw new Error('sync');
      },
      token: () => 't',
      location: () => '/',
    });
    expect(() => {
      throwing('window', new Error('y'));
    }).not.toThrow();
  });
});

describe('installGlobalErrorReporting', () => {
  it('reports uncaught errors and unhandled rejections until uninstalled', () => {
    const report = vi.fn();
    // A plain event target: errors dispatched on the real window reach the test runner too.
    const target = new EventTarget() as unknown as Window;
    const uninstall = installGlobalErrorReporting(target, report);
    const error = new Error('uncaught');
    target.dispatchEvent(new ErrorEvent('error', { error, message: 'uncaught' }));
    // A resource load error has no error object.
    target.dispatchEvent(new ErrorEvent('error', { message: 'img failed' }));
    const reason = new Error('rejected');
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: reason });
    target.dispatchEvent(rejection);
    expect(report.mock.calls).toEqual([
      ['window', error],
      ['unhandledrejection', reason],
    ]);
    uninstall();
    target.dispatchEvent(new ErrorEvent('error', { error, message: 'again' }));
    expect(report).toHaveBeenCalledTimes(2);
  });
});
