import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1, // one shared server request log
  retries: 0,
  reporter: [['list'], ['json', { outputFile: process.env.PG_JSON || 'results/run.raw.json' }]],
  use: { baseURL: 'http://127.0.0.1:4331', headless: true },
  webServer: {
    command: 'node server.mjs',
    env: { PORT: '4331' },
    url: 'http://127.0.0.1:4331/__log',
    reuseExistingServer: false,
  },
  projects: [
    // 'chromium' = Playwright's full Chromium in new headless mode. The default headless shell
    // does NOT isolate sandboxed iframes into a separate process (see README, Q4).
    { name: 'chromium', use: { browserName: 'chromium', channel: 'chromium' } },
    // Installed Google Chrome (stable). Optional: run with --project=chrome.
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } },
    // Playwright's Firefox ships with Fission off; release Firefox has it on. Mirror release.
    { name: 'firefox', use: { browserName: 'firefox', launchOptions: { firefoxUserPrefs: { 'fission.autostart': true, 'fission.webContentIsolationStrategy': 1 } } } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
