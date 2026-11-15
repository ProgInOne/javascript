import {
  CLIENT_ERROR_LIMITS,
  type ClientErrorReport,
  type ClientErrorSource,
} from '@proginone/shared';
import { ApiRequestError, readToken, TOKEN_HEADER } from '../api/client.ts';

/**
 * Client error reporting (NFR-12, docs/design/system-architecture.md#관측성): unexpected errors
 * go to `POST /api/v1/client-errors` so they end up in the server's structured log. Reporting is
 * best effort and never throws. API errors are not reported (the server already logged them),
 * except a response the client could not understand (`BAD_RESPONSE`). Only the route path is
 * sent, not the query string, and nothing the learner typed.
 */

/** Reports per page load; a render loop stops reporting after this. */
export const MAX_REPORTS_PER_PAGE = 20;

interface ReporterOptions {
  fetchImpl?: typeof fetch;
  token?: () => string;
  location?: () => string;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The report body for a thrown value, or null when it should not be reported. */
export function toReport(
  source: ClientErrorSource,
  error: unknown,
  path: string,
): ClientErrorReport | null {
  if (error instanceof ApiRequestError && error.code !== 'BAD_RESPONSE') return null;
  // Error-like values (`Error`, and `DOMException`, which is not an `Error` in every engine).
  const e =
    error instanceof Error ||
    (typeof error === 'object' && error !== null && typeof (error as Error).message === 'string')
      ? (error as Error)
      : null;
  if (e?.name === 'AbortError') return null;
  const message = e ? e.message : typeof error === 'string' ? error : String(error);
  return {
    source,
    ...(typeof e?.name === 'string' && e.name
      ? { name: clip(e.name, CLIENT_ERROR_LIMITS.name) }
      : {}),
    message: clip(message || '(메시지 없음)', CLIENT_ERROR_LIMITS.message),
    ...(typeof e?.stack === 'string' && e.stack
      ? { stack: clip(e.stack, CLIENT_ERROR_LIMITS.stack) }
      : {}),
    path: clip(path.startsWith('/') ? path : '/', CLIENT_ERROR_LIMITS.path),
  };
}

export function createErrorReporter({
  fetchImpl = (...args: Parameters<typeof fetch>) => fetch(...args),
  token = readToken,
  location = () => window.location.pathname,
}: ReporterOptions = {}) {
  let sent = 0;
  const seen = new Set<string>();
  return function report(source: ClientErrorSource, error: unknown): void {
    try {
      const body = toReport(source, error, location());
      if (!body || sent >= MAX_REPORTS_PER_PAGE) return;
      // The same error from the same place is reported once per page load.
      const key = `${body.name ?? ''}|${body.message}|${body.path}`;
      if (seen.has(key)) return;
      seen.add(key);
      sent += 1;
      void fetchImpl('/api/v1/client-errors', {
        method: 'POST',
        headers: { [TOKEN_HEADER]: token(), 'content-type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // Reporting must never cause another error.
    }
  };
}

export const reportClientError = createErrorReporter();

/** Reports uncaught errors and unhandled promise rejections. Returns the uninstaller. */
export function installGlobalErrorReporting(
  target: Window = window,
  report: (source: ClientErrorSource, error: unknown) => void = reportClientError,
): () => void {
  const onError = (event: ErrorEvent) => {
    // Resource load errors and cross-origin script errors carry no error object; skip them.
    if (event.error === undefined || event.error === null) return;
    report('window', event.error);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    report('unhandledrejection', event.reason);
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
