import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { RunPlan, RunResult } from '@proginone/run-contract';
import { runnerHtml, RUNNER_PATH, SHELL_HEADERS } from '@proginone/runner/shell-build';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import type { PlanRunner } from './cases.ts';

/**
 * The app's runner in headless Chromium, for `content-cli check --run`.
 *
 * A small local server plays the part of the ProgInOne server: it serves the runner shell at
 * `/sandbox/runner.html` (built by `@proginone/runner/shell-build`, with the shell CSP headers)
 * and a blank host page that loads `createRunnerHost` from `@proginone/runner`. Everything below
 * the host is the production path: per-shell `*.localhost` sites, the shell, the harness and the
 * Worker / nested document. This mirrors the runner's E2E fixtures (e2e/tests/sandbox-fixtures.ts).
 */

const HOST_ENTRY = fileURLToPath(import.meta.resolve('@proginone/runner'));

/** Upper bound for one run, above the runner's own watchdog (10 s budget + grace). */
const RUN_TIMEOUT_MS = 30_000;

const HOST_PAGE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>content-cli 실행 검증</title></head><body><script src="/host.js"></script></body></html>`;

async function hostBundle(): Promise<string> {
  const result = await build({
    entryPoints: [HOST_ENTRY],
    bundle: true,
    format: 'iife',
    globalName: '__runner',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
    // Same as the app: no 'unsafe-eval' probing by zod.
    banner: { js: 'globalThis.__zod_globalConfig={jitless:true};' },
  });
  const out = result.outputFiles[0];
  if (!out) throw new Error('esbuild produced no host bundle');
  return out.text;
}

async function startServer(port: number): Promise<{ server: Server; origin: string }> {
  const [shell, host] = await Promise.all([runnerHtml(), hostBundle()]);
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === RUNNER_PATH) {
      res.writeHead(200, { ...SHELL_HEADERS, 'Content-Type': 'text/html; charset=utf-8' });
      res.end(shell);
    } else if (path === '/host.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(host);
    } else if (path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HOST_PAGE);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const { port: actual } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${actual}` };
}

/**
 * The bundled host module on the page. Typed structurally: importing the runner's types would
 * pull DOM types into this Node-only package.
 */
interface PageHost {
  ready(): Promise<void>;
  run(plan: unknown): Promise<unknown>;
}
interface HostWindow {
  __runner: { createRunnerHost(): PageHost };
  __host: PageHost;
}

export interface BrowserRunner extends PlanRunner {
  close(): Promise<void>;
}

export interface BrowserRunnerOptions {
  /** Parallel pages, each with its own runner host. Default 4. */
  concurrency?: number;
  /** Local server port. Default 0 (any free port). */
  port?: number;
}

/** Thrown when Chromium is not installed; the CLI prints the install command. */
export class BrowserMissingError extends Error {}

async function launch(): Promise<Browser> {
  try {
    // `chromium` channel: the full browser in new headless mode, as the E2E suite uses.
    return await chromium.launch({ channel: 'chromium' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Executable doesn't exist|playwright install/i.test(message)) {
      throw new BrowserMissingError(message);
    }
    throw error;
  }
}

/** Starts the server and Chromium; `run` executes plans on a pool of runner hosts. */
export async function startBrowserRunner(
  options: BrowserRunnerOptions = {},
): Promise<BrowserRunner> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const { server, origin } = await startServer(options.port ?? 0);
  let browser: Browser | undefined;
  try {
    browser = await launch();
    const context = await browser.newContext();
    const pages = await Promise.all(
      Array.from({ length: concurrency }, async () => {
        const page = await context.newPage();
        await page.goto(`${origin}/`);
        await page.evaluate(async () => {
          const w = globalThis as unknown as HostWindow;
          w.__host = w.__runner.createRunnerHost();
          await w.__host.ready();
        });
        return page;
      }),
    );

    const idle: Page[] = [...pages];
    const waiting: ((page: Page) => void)[] = [];
    const acquire = () =>
      new Promise<Page>((resolve) => {
        const page = idle.pop();
        if (page) resolve(page);
        else waiting.push(resolve);
      });
    const release = (page: Page) => {
      const next = waiting.shift();
      if (next) next(page);
      else idle.push(page);
    };

    const opened = browser;
    return {
      async run(plan: RunPlan): Promise<RunResult> {
        const page = await acquire();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = page.evaluate<unknown, unknown>(
            (p) => (globalThis as unknown as HostWindow).__host.run(p),
            plan,
          );
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`실행이 ${RUN_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다`));
            }, RUN_TIMEOUT_MS);
          });
          return (await Promise.race([result, timeout])) as RunResult;
        } finally {
          clearTimeout(timer);
          release(page);
        }
      },
      async close() {
        await opened.close();
        await new Promise<void>((resolve) =>
          server.close(() => {
            resolve();
          }),
        );
      },
    };
  } catch (error) {
    await browser?.close();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
    throw error;
  }
}
