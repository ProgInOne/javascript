import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { buildFixtureContent } from './fixture-content.ts';

// Runs the production build (`pnpm build` first) on its own port with a fresh data directory,
// so tests never touch real learning data. Visual tests only run inside the Playwright Docker
// image (PW_VISUAL=1) because font rendering differs between operating systems.
const PORT = Number(process.env['E2E_PORT'] ?? 4391);
const dataDir = process.env['E2E_DATA_DIR'] ?? mkdtempSync(join(tmpdir(), 'proginone-e2e-'));
process.env['E2E_DATA_DIR'] = dataDir; // shared with worker processes
const contentDb = join(dataDir, 'content.db');
if (process.env['E2E_CONTENT_DB'] !== contentDb) {
  buildFixtureContent(contentDb); // once, in the main process; workers inherit the env
  process.env['E2E_CONTENT_DB'] = contentDb;
}
const visual = process.env['PW_VISUAL'] === '1';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1, // one server, shared state
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  ...(visual ? {} : { grepInvert: /@visual/ }),
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
  webServer: {
    command: 'node ../apps/server/src/main.ts',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'production',
      PROGINONE_PORT: String(PORT),
      PROGINONE_DATA_DIR: dataDir,
      PROGINONE_CONTENT_DB: contentDb,
      PROGINONE_OPEN_BROWSER: 'false',
      PROGINONE_LOG_LEVEL: 'warn',
    },
  },
});
