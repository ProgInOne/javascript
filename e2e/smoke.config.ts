import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke test of an already running ProgInOne (`SMOKE_URL`, default http://127.0.0.1:4310), for
 * checking an installed release (docs/guides/release.md#릴리스-산출물-확인). It starts no server
 * and changes the learner it finds (finishes onboarding, makes a backup), so point it at a
 * throwaway data directory, never at real learning data.
 *
 *   SMOKE_URL=http://127.0.0.1:4661 pnpm --filter @proginone/e2e smoke [--project=firefox]
 */
export default defineConfig({
  testDir: './smoke',
  // Own output folder: the E2E config cleans test-results/ when it starts.
  outputDir: 'test-results-smoke',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: process.env['SMOKE_URL'] ?? 'http://127.0.0.1:4310',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } },
    // The installed Google Chrome (the guaranteed browser, NFR-10). Run with --project=chrome.
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        // Release Firefox isolates sites in processes (Fission); Playwright's build has it off.
        launchOptions: {
          firefoxUserPrefs: { 'fission.autostart': true, 'fission.webContentIsolationStrategy': 1 },
        },
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
