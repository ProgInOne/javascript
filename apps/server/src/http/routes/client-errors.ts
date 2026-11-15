import { clientErrorReportSchema } from '@proginone/shared';
import { Hono } from 'hono';
import type { Logger } from '../../observability/logger.ts';
import type { AppEnv } from '../env.ts';
import { jsonBody, limitBody } from './input.ts';

/** Reports logged per window; the rest are counted and summarized in the next logged report. */
export const CLIENT_ERROR_RATE = { max: 30, windowMs: 60_000 } as const;

/**
 * `POST /client-errors` (NFR-12, docs/design/system-architecture.md#관측성): errors the web app
 * caught (route error boundary, window `error`/`unhandledrejection`) go to the structured server
 * log as `warn`. The body is untrusted: size-limited and schema-validated, and the fields are
 * logged as JSON values (pino escapes them), never interpolated into the message. A render loop
 * cannot flood the log: past {@link CLIENT_ERROR_RATE} reports per minute are dropped and counted.
 */
export function clientErrorRoutes(log: Logger, now: () => number = Date.now) {
  let windowStart = 0;
  let logged = 0;
  let dropped = 0;
  return new Hono<AppEnv>().post('/', limitBody(16 * 1024), async (c) => {
    const report = clientErrorReportSchema.parse(await jsonBody(c));
    const t = now();
    if (t - windowStart >= CLIENT_ERROR_RATE.windowMs) {
      windowStart = t;
      logged = 0;
    }
    if (logged >= CLIENT_ERROR_RATE.max) {
      dropped += 1;
      return c.body(null, 204);
    }
    logged += 1;
    log.warn(
      {
        requestId: c.var.requestId,
        clientError: report,
        ...(dropped > 0 ? { droppedBefore: dropped } : {}),
      },
      'client error',
    );
    dropped = 0;
    return c.body(null, 204);
  });
}
