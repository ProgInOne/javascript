import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { buildContent } from '../tools/content-cli/src/build.ts';
import { exerciseKit } from '../tools/content-cli/src/kit.ts';

/**
 * Performance check (`pnpm perf`, docs/reviews/2026-11-16-m7-performance.md): the production
 * build with the real content pack (approved exercises only, like `pnpm content:build`) and a
 * fresh learner in a temporary data directory. Measures NFR-01·02·03 in Chromium and fails when
 * a median misses its target.
 */
const PORT = Number(process.env['PERF_PORT'] ?? 4660);
const dataDir = process.env['PERF_DATA_DIR'] ?? mkdtempSync(join(tmpdir(), 'proginone-perf-'));
process.env['PERF_DATA_DIR'] = dataDir; // shared with the worker process
const contentDb = join(dataDir, 'content.db');
if (process.env['PERF_CONTENT_DB'] !== contentDb) {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
  const result = buildContent(join(repo, 'content'), contentDb, { kit: exerciseKit });
  if (!result.written) throw new Error('content pack failed to build; run `pnpm content:check`');
  process.env['PERF_CONTENT_DB'] = contentDb;
}

export default defineConfig({
  testDir: './perf',
  // Own output folder: the E2E config cleans test-results/ when it starts.
  outputDir: 'test-results-perf',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chromium',
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'node ../apps/server/src/main.ts',
    url: `http://127.0.0.1:${String(PORT)}/`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'production',
      PROGINONE_PORT: String(PORT),
      PROGINONE_DATA_DIR: dataDir,
      PROGINONE_CONTENT_DB: contentDb,
      PROGINONE_OPEN_BROWSER: 'false',
      PROGINONE_LOG_LEVEL: 'warn',
      // AI is outside NFR-01/02; the mock keeps Codex from starting.
      PROGINONE_AI_PROVIDER: 'mock',
    },
  },
});
