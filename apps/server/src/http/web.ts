import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type MiddlewareHandler } from 'hono';
import type { AppEnv } from './env.ts';

/** Strict CSP for the app document (docs/design/system-architecture.md#로컬-서버와-포트). */
export function appCsp(port: number): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // Radix and CodeMirror set inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    `frame-src 'self' http://*.localhost:${port}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export const TOKEN_META = 'proginone-token';

const FILE_PATH = /\/[^/]+\.[a-z0-9]+$/i;

/** Puts the session token into index.html so the SPA can call /api (same-origin only). */
export function injectToken(html: string, token: string): string {
  const tag = `<meta name="${TOKEN_META}" content="${token}">`;
  if (!html.includes('</head>')) throw new Error('index.html has no </head>');
  return html.replace('</head>', `${tag}</head>`);
}

/**
 * Serves the built web app (production). Static assets as-is; every other GET falls back to
 * index.html with the session token and the app CSP. Assets are content-hashed by Vite.
 */
export function webRoutes({
  distDir,
  token,
  port,
}: {
  distDir: string;
  token: string;
  port: number;
}) {
  const indexPath = join(distDir, 'index.html');
  const app = new Hono<AppEnv>();
  if (!existsSync(indexPath)) {
    return app.get('*', (c) =>
      c.text('웹 앱이 빌드되지 않았습니다. `pnpm build`를 먼저 실행하세요.', 503),
    );
  }
  const index = injectToken(readFileSync(indexPath, 'utf8'), token);
  const assets = serveStatic<AppEnv>({ root: distDir });
  const files: MiddlewareHandler<AppEnv> = (c, next) =>
    FILE_PATH.test(c.req.path) ? assets(c, next) : next();
  return (
    app
      .get('/index.html', (c) => c.redirect('/'))
      .use('/assets/*', async (c, next) => {
        await next();
        if (c.res.ok) c.res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      })
      // Only paths that look like files hit the disk; app routes fall through to index.html.
      .use('*', files)
      .get('*', (c) => {
        const path = c.req.path;
        if (path.startsWith('/api/') || path.startsWith('/sandbox/')) return c.notFound();
        c.header('Content-Security-Policy', appCsp(port));
        c.header('Cache-Control', 'no-store');
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('Referrer-Policy', 'no-referrer');
        return c.html(index);
      })
  );
}
