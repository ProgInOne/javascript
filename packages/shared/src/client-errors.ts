import { z } from 'zod';

/**
 * Client error reporting (NFR-12, docs/design/system-architecture.md#관측성). The web app sends
 * errors caught by the route error boundary and the window `error`/`unhandledrejection` events to
 * `POST /client-errors`, and the server writes them to its structured log. Nothing is stored in
 * user.db.
 */
export const CLIENT_ERROR_SOURCES = ['boundary', 'window', 'unhandledrejection'] as const;
export type ClientErrorSource = (typeof CLIENT_ERROR_SOURCES)[number];

/** Field limits. The client truncates to these before sending; the server rejects anything longer. */
export const CLIENT_ERROR_LIMITS = {
  name: 100,
  message: 1000,
  stack: 4000,
  path: 300,
} as const;

export const clientErrorReportSchema = z
  .object({
    source: z.enum(CLIENT_ERROR_SOURCES),
    name: z.string().max(CLIENT_ERROR_LIMITS.name).optional(),
    message: z.string().max(CLIENT_ERROR_LIMITS.message),
    stack: z.string().max(CLIENT_ERROR_LIMITS.stack).optional(),
    /** App route path only (no query string or hash), e.g. `/learn/js-basics.start.first-program`. */
    path: z.string().max(CLIENT_ERROR_LIMITS.path).startsWith('/'),
  })
  .strict();
export type ClientErrorReport = z.infer<typeof clientErrorReportSchema>;
