import { runnerHtml, SHELL_HEADERS } from '@proginone/runner/shell-build';
import { Hono } from 'hono';
import type { AppEnv } from './env.ts';

/**
 * Runner shell route (D-018, docs/design/code-execution-sandbox.md#셸의-csp).
 *
 * Serves `/sandbox/runner.html` with the shell CSP in every mode: the shell is loaded from the
 * server even in development, where Vite serves the app. The security middleware already limits
 * `<shellId>.localhost` hosts to `/sandbox/*`. Everything the shell needs is inline, so there are
 * no other assets.
 */
export function runnerRoutes() {
  return new Hono<AppEnv>().get('/runner.html', async (c) => {
    const html = await runnerHtml();
    for (const [name, value] of Object.entries(SHELL_HEADERS)) c.header(name, value);
    return c.html(html);
  });
}
