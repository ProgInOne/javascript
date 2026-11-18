import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { buildFixtureContent } from './fixture-content.ts';
import { removeRunTempRoot, startRunTempRoot } from '../tools/test-tmp.ts';

// Runs the production build (`pnpm build` first) on its own port with a fresh data directory,
// so tests never touch real learning data. Visual tests only run inside the Playwright Docker
// image (PW_VISUAL=1) because font rendering differs between operating systems.
// Every temporary folder of this run (data dirs, fixture content, servers' own) goes under one
// root, removed when the main process exits; workers inherit it and do not make their own.
const runRoot = startRunTempRoot('e2e');
if (runRoot)
  process.on('exit', () => {
    removeRunTempRoot(runRoot);
  });
const PORT = Number(process.env['E2E_PORT'] ?? 4391);
const dataDir = process.env['E2E_DATA_DIR'] ?? mkdtempSync(join(tmpdir(), 'proginone-e2e-'));
process.env['E2E_DATA_DIR'] = dataDir; // shared with worker processes
const contentDb = join(dataDir, 'content.db');
if (process.env['E2E_CONTENT_DB'] !== contentDb) {
  buildFixtureContent(contentDb); // once, in the main process; workers inherit the env
  process.env['E2E_CONTENT_DB'] = contentDb;
}
const visual = process.env['PW_VISUAL'] === '1';
// A second server with its own fresh learner for the first-run journey (onboarding → dashboard
// states → weakness set, tests/journey.spec.ts). The main server's learner skips onboarding
// (tests/onboarded.setup.ts) so the other tests open the dashboard directly.
const JOURNEY_PORT = PORT + 1;
const journeyDir =
  process.env['E2E_JOURNEY_DATA_DIR'] ?? mkdtempSync(join(tmpdir(), 'proginone-e2e-journey-'));
process.env['E2E_JOURNEY_DATA_DIR'] = journeyDir;
process.env['E2E_JOURNEY_URL'] = `http://127.0.0.1:${JOURNEY_PORT}`;
// A third server for 설정 > 데이터 (tests/data-settings.spec.ts): restore, reset and the backup
// folder change rewrite the whole learner, so they must not share the main server.
const DATA_PORT = PORT + 2;
const dataSettingsDir =
  process.env['E2E_DATA_SETTINGS_DIR'] ?? mkdtempSync(join(tmpdir(), 'proginone-e2e-data-'));
process.env['E2E_DATA_SETTINGS_DIR'] = dataSettingsDir;
process.env['E2E_DATA_SETTINGS_URL'] = `http://127.0.0.1:${DATA_PORT}`;
// A fourth server for the three-week `mastered` journey (tests/mastered.spec.ts): its own learner
// and clock, and the fixture content plus a module 1 unit assessment (fixtures/content-mastery),
// so neither the long clock jumps nor the extra unit change what the other specs see.
const MASTERY_PORT = PORT + 3;
const masteryDir =
  process.env['E2E_MASTERY_DATA_DIR'] ?? mkdtempSync(join(tmpdir(), 'proginone-e2e-mastery-'));
process.env['E2E_MASTERY_DATA_DIR'] = masteryDir;
process.env['E2E_MASTERY_URL'] = `http://127.0.0.1:${MASTERY_PORT}`;
const masteryContentDb = join(masteryDir, 'content.db');
if (process.env['E2E_MASTERY_CONTENT_DB'] !== masteryContentDb) {
  buildFixtureContent(masteryContentDb, 'content-mastery');
  process.env['E2E_MASTERY_CONTENT_DB'] = masteryContentDb;
}

// A fifth server for parametric template variants (tests/templates.spec.ts): the fixture content
// plus a template in the variables unit (fixtures/content-templates), so the other specs' sets
// keep their exercises.
const TEMPLATES_PORT = PORT + 4;
const templatesDir =
  process.env['E2E_TEMPLATES_DATA_DIR'] ?? mkdtempSync(join(tmpdir(), 'proginone-e2e-templates-'));
process.env['E2E_TEMPLATES_DATA_DIR'] = templatesDir;
process.env['E2E_TEMPLATES_URL'] = `http://127.0.0.1:${TEMPLATES_PORT}`;
const templatesContentDb = join(templatesDir, 'content.db');
if (process.env['E2E_TEMPLATES_CONTENT_DB'] !== templatesContentDb) {
  buildFixtureContent(templatesContentDb, 'content-templates');
  process.env['E2E_TEMPLATES_CONTENT_DB'] = templatesContentDb;
}

// A sixth server for the whole learning journey (tests/full-journey.spec.ts, M7): one fresh
// learner goes from onboarding through reading, practice, the unit assessment, reviews and goals
// to a backup restore. It uses the mastery content (module 1 ends with an assessment) and its own
// clock, and the restore rewrites its learner, so it shares state with no other spec.
const FULL_JOURNEY_PORT = PORT + 5;
const fullJourneyDir =
  process.env['E2E_FULL_JOURNEY_DATA_DIR'] ?? mkdtempSync(join(tmpdir(), 'proginone-e2e-full-'));
process.env['E2E_FULL_JOURNEY_DATA_DIR'] = fullJourneyDir;
process.env['E2E_FULL_JOURNEY_URL'] = `http://127.0.0.1:${FULL_JOURNEY_PORT}`;
const fullJourneyContentDb = join(fullJourneyDir, 'content.db');
if (process.env['E2E_FULL_JOURNEY_CONTENT_DB'] !== fullJourneyContentDb) {
  buildFixtureContent(fullJourneyContentDb, 'content-mastery');
  process.env['E2E_FULL_JOURNEY_CONTENT_DB'] = fullJourneyContentDb;
}

const serverEnv = (port: number, dir: string, content = contentDb) => ({
  NODE_ENV: 'production',
  PROGINONE_PORT: String(port),
  PROGINONE_DATA_DIR: dir,
  PROGINONE_CONTENT_DB: content,
  PROGINONE_OPEN_BROWSER: 'false',
  PROGINONE_LOG_LEVEL: 'warn',
  // Deterministic AI; E2E never starts Codex (docs/design/ai-system.md#mockprovider).
  PROGINONE_AI_PROVIDER: 'mock',
  // Test-only clock shift for next-day reviews (tests/clock.ts writes it).
  PROGINONE_TEST_CLOCK_FILE: join(dir, 'clock-offset-ms'),
});
const browser = { ...devices['Desktop Chrome'], channel: 'chromium' };

// Compatibility check (NFR-10, docs/reviews/2026-11-16-m7-compatibility.md): the sandbox policy
// suite and the core flows in Firefox and WebKit. Opt-in (`pnpm test:e2e:compat`), one browser
// per run so each starts from fresh servers: the flows change the shared learner.
const COMPAT_SPECS = [
  /sandbox\.spec\.ts$/,
  /sandbox-grading\.spec\.ts$/,
  /flows\.spec\.ts$/,
  /reading\.spec\.ts$/,
  /practice\.spec\.ts$/,
];
const compatBrowsers = {
  // Playwright's Firefox ships with site isolation (Fission) off; release Firefox has it on.
  firefox: {
    ...devices['Desktop Firefox'],
    launchOptions: {
      firefoxUserPrefs: { 'fission.autostart': true, 'fission.webContentIsolationStrategy': 1 },
    },
  },
  webkit: devices['Desktop Safari'],
};
const compat = process.env['PW_COMPAT'] as keyof typeof compatBrowsers | undefined;
if (compat !== undefined && !(compat in compatBrowsers)) {
  throw new Error(`PW_COMPAT must be one of ${Object.keys(compatBrowsers).join(', ')}`);
}

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
  projects: compat
    ? [
        { name: 'setup', testMatch: /\.setup\.ts$/, use: compatBrowsers[compat] },
        {
          name: compat,
          testMatch: COMPAT_SPECS,
          use: compatBrowsers[compat],
          dependencies: ['setup'],
        },
      ]
    : [
        { name: 'setup', testMatch: /\.setup\.ts$/, use: browser },
        { name: 'chromium', use: browser, dependencies: ['setup'] },
      ],
  webServer: [
    {
      command: 'node ../apps/server/src/main.ts',
      url: `http://127.0.0.1:${PORT}/`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: serverEnv(PORT, dataDir),
    },
    {
      command: 'node ../apps/server/src/main.ts',
      url: `http://127.0.0.1:${JOURNEY_PORT}/`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: serverEnv(JOURNEY_PORT, journeyDir),
    },
    {
      command: 'node ../apps/server/src/main.ts',
      url: `http://127.0.0.1:${DATA_PORT}/`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: serverEnv(DATA_PORT, dataSettingsDir),
    },
    {
      command: 'node ../apps/server/src/main.ts',
      url: `http://127.0.0.1:${MASTERY_PORT}/`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: serverEnv(MASTERY_PORT, masteryDir, masteryContentDb),
    },
    {
      command: 'node ../apps/server/src/main.ts',
      url: `http://127.0.0.1:${TEMPLATES_PORT}/`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: serverEnv(TEMPLATES_PORT, templatesDir, templatesContentDb),
    },
    {
      command: 'node ../apps/server/src/main.ts',
      url: `http://127.0.0.1:${FULL_JOURNEY_PORT}/`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: serverEnv(FULL_JOURNEY_PORT, fullJourneyDir, fullJourneyContentDb),
    },
  ],
});
