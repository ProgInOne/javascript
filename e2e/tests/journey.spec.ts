import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DAY_MS, setServerTime } from './clock.ts';
import { expectNoA11yViolations } from './fixtures.ts';
import { solveSet as solveInUi } from './practice-helpers.ts';
import { apiFor, practiceLesson, readLesson, reviewToday, study, type Api } from './seed.ts';

/**
 * The first-run journey on its own server (playwright.config.ts `E2E_JOURNEY_URL`), so the
 * learner really is new: onboarding → empty dashboard → a new learner's first day → a month of
 * learning (seeded through the API with the test clock) → weakness set. The server clock is
 * pinned per phase so dates and the week strip look the same on every run; the browser's own
 * heartbeats are dropped so study time comes only from the seeding.
 *
 * Dashboard states for visual regression (roadmap M5 테스트): empty, new learner, long-term.
 */

const JOURNEY_URL = process.env['E2E_JOURNEY_URL'] ?? '';
/**
 * Monday 2026-11-16 15:00 Asia/Seoul (06:00 UTC): the same learner-local date whether the server
 * resolves the learner's time zone to Asia/Seoul (macOS) or UTC (the Playwright Docker image).
 */
const T0 = Date.UTC(2026, 10, 16, 6, 0, 0);
const FIRST = 'js-basics.start.first-program';
const SECOND = 'js-basics.values.variables';
const CONST_MCQ = `${SECOND}.mcq-const`;
const LONG_TERM = JSON.parse(
  readFileSync(new URL('../fixtures/long-term-dashboard.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

test.use({ baseURL: JOURNEY_URL });
// One learner's history: later tests build on earlier ones, and a retry cannot start over.
test.describe.configure({ mode: 'serial', retries: 0 });

/** Server time of the current phase. */
let now = T0;
function advance(ms: number) {
  now += ms;
  setServerTime(now, 'journey');
}

async function prepare(page: Page, scheme: 'light' | 'dark' = 'light') {
  setServerTime(now, 'journey');
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.route('**/api/v1/activity/heartbeat', (route) =>
    route.fulfill({ json: { date: '2026-11-16', countedMs: 0, activeMsToday: 0 } }),
  );
}

test.afterAll(() => {
  setServerTime(Date.now(), 'journey');
});

async function openDashboard(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /대시보드/ })).toBeVisible();
  for (const name of [
    '오늘의 학습',
    '오늘의 복습',
    '개념 지도',
    '과정 진도',
    '최근 활동',
    '약점 개념',
  ]) {
    await expect(page.getByRole('region', { name })).toBeVisible();
  }
  // Every card has loaded (no skeletons left).
  await expect(page.locator('.pi-skeleton')).toHaveCount(0);
  await expect(page.locator('[data-ai-state]').first()).not.toHaveAttribute(
    'data-ai-state',
    'loading',
  );
  await page.evaluate(() => document.fonts.ready);
}

/**
 * "최근 활동" shows the minute of each activity, which depends on how long the UI took to solve
 * a set: keep the real response but pin every time to 15:15 of its learner-local day (KST).
 */
async function pinActivityTimes(page: Page) {
  await page.route('**/api/v1/activity/recent', async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as { items: { date: string; at: number }[] };
    for (const item of json.items) item.at = Date.parse(`${item.date}T15:15:00+09:00`);
    await route.fulfill({ response: res, json });
  });
}

/**
 * Screenshots of the dashboard in the current state. `responses` replaces the learning-state
 * API with recorded responses (path → JSON) where the seeded history is not pixel-stable.
 */
const HEIGHT: Readonly<Record<number, number>> = { 1280: 800, 1440: 900, 1920: 1080 };
function dashboardShots(
  state: string,
  responses?: Record<string, unknown>,
  widths: readonly number[] = [1280, 1440],
) {
  for (const width of widths) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`dashboard-${state}-${scheme}-${width} @visual`, async ({ page }) => {
        await page.setViewportSize({ width, height: HEIGHT[width] ?? 900 });
        await prepare(page, scheme);
        await pinActivityTimes(page);
        for (const [path, json] of Object.entries(responses ?? {})) {
          await page.route(`**/api/v1${path}`, (route) => route.fulfill({ json }));
        }
        await openDashboard(page);
        await expect(page).toHaveScreenshot(`dashboard-${state}-${scheme}-${width}.png`, {
          fullPage: true,
        });
      });
    }
  }
}

test('first run: the dashboard sends a new learner through the onboarding', async ({ page }) => {
  await prepare(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole('heading', { level: 1, name: '코딩 공부, 이제 한 곳에서 끝까지.' }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: '시작하기' }).click();

  await expect(page.getByRole('heading', { level: 1, name: '학습 목표를 정해요' })).toBeFocused();
  await page.getByRole('radio', { name: '30분' }).check();
  await page.getByRole('radio', { name: '5일' }).check();
  await page.getByText('과정을 끝낼 목표일 정하기 (선택)').click();
  await page.getByLabel('완료 목표일').fill('2027-03-31');
  await expect(page.getByText(/하루 약 \d+분이면 돼요/)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: '다음' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: '코딩은 얼마나 해 보셨나요?' }),
  ).toBeVisible();
  await page.getByRole('radio', { name: /처음이에요/ }).check();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: '다음' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'AI 튜터 연결 (선택)' })).toBeVisible();
  await expectNoA11yViolations(page);
  // The mock provider may already be connected; either way the step moves on.
  await page.getByRole('button', { name: /^(나중에 할게요|다음)$/ }).click();

  await expect(page.getByRole('heading', { level: 1, name: '시작할 준비가 됐어요' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '첫 프로그램' })).toBeVisible();
  await expect(page.getByText('새 단원 · 첫 프로그램')).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: '대시보드로' }).click();

  await expect(page.getByRole('heading', { level: 1, name: /대시보드/ })).toBeVisible();
  // Never shown again.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: /대시보드/ })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

// Onboarding goal step (ui-ux.md 시각 회귀 매트릭스 "온보딩(목표 단계)").
for (const width of [1280, 1440] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`onboarding-goal-${scheme}-${width} @visual`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 900 });
      await prepare(page, scheme);
      await page.goto('/onboarding?step=goal');
      await expect(
        page.getByRole('heading', { level: 1, name: '학습 목표를 정해요' }),
      ).toBeVisible();
      await expect(page.getByRole('radio', { name: '30분' })).toBeChecked();
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`onboarding-goal-${scheme}-${width}.png`, {
        fullPage: true,
      });
    });
  }
}

test('empty dashboard: the first lesson and an unfilled concept map', async ({ page }) => {
  await prepare(page);
  await openDashboard(page);
  await expect(page.getByRole('heading', { level: 1, name: /환영해요/ })).toBeVisible();
  const plan = page.getByRole('region', { name: '오늘의 학습' });
  await expect(plan.getByRole('listitem')).toHaveCount(1);
  await expect(plan.getByText('새 단원 · 첫 프로그램')).toBeVisible();
  const map = page.getByRole('region', { name: '개념 지도' });
  await expect(map.getByText(/학습하면 여기가 채워져요/)).toBeVisible();
  await expect(map.getByRole('img', { name: '숙련 단계: 미학습' })).toHaveCount(5);
  await expect(
    page.getByRole('region', { name: '최근 활동' }).getByText(/아직 활동이 없어요/),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  // The empty states in dark mode too (D-065).
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectNoA11yViolations(page);
});
dashboardShots('empty');

let api: Api;

test('new learner: first lesson read and practised on day one', async ({ page, request }) => {
  test.setTimeout(120_000);
  await prepare(page);
  api = await apiFor(page, request);
  await readLesson(api, FIRST);
  advance(15 * 60_000);
  // The lesson set in the app, the way practice.spec.ts does it: wrong and partial answers,
  // hints, code run in the real sandbox. The confident wrong answer leaves a misconception.
  await page.goto(`/learn/${FIRST}?mode=practice`);
  await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램 연습' })).toBeVisible();
  await solveInUi(page, true);
  await expect(page.getByRole('region', { name: /마쳤어요/ })).toBeVisible();
  await study(api, 22, advance);

  await openDashboard(page);
  await expect(
    page.getByRole('heading', { level: 1, name: /오늘 \d+분 공부했어요/ }),
  ).toBeVisible();
  const map = page.getByRole('region', { name: '개념 지도' });
  await expect(map.getByRole('heading', { name: /1\. 시작하기/ })).toContainText('1 / 1단원 완료');
  await expect(map.getByText(/학습하면 여기가 채워져요/)).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: '과정 진도' }).getByRole('progressbar'),
  ).toHaveAttribute('aria-valuenow', '25'); // 1 of 4 units (values ends with an assessment, then a project)
  // 최근 활동 (FR-DASH-01): today's lesson set, carrying the lesson's completion.
  const activity = page.getByRole('region', { name: '최근 활동' });
  const row = activity.getByRole('listitem').filter({ hasText: '첫 프로그램 연습' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(/^오늘 \d\d:\d\d/);
  await expect(row).toContainText('단원 완료');
  await expect(row).toContainText(/\d+문제 · 정답 \d+/);
  await expectNoA11yViolations(page);
});
dashboardShots('new');

test('long-term learner: a month of lessons, reviews and rest days', async ({ page, request }) => {
  test.setTimeout(180_000);
  await prepare(page);
  api = await apiFor(page, request);
  const start = T0;
  for (let day = 1; day <= 30; day++) {
    now = start + day * DAY_MS;
    setServerTime(now, 'journey');
    const weekday = new Date(now + 9 * 3_600_000).getUTCDay(); // Asia/Seoul
    if (weekday === 0 || (weekday === 6 && day % 2 === 0)) continue; // rest days
    if (day === 30) {
      // Today: 18 minutes so far, today's reviews still waiting.
      await study(api, 18, advance);
      break;
    }
    await reviewToday(api);
    if (day === 2) {
      await readLesson(api, SECOND);
      // `const` keeps going wrong: a confirmed misconception and a weak concept.
      await practiceLesson(api, SECOND, { wrong: [CONST_MCQ], wrongTimes: 3 });
    }
    await study(api, day % 3 === 0 ? 34 : 24, advance);
  }

  await openDashboard(page);
  const plan = page.getByRole('region', { name: '오늘의 학습' });
  await expect(plan.getByRole('listitem').first()).toHaveAttribute('aria-current', 'step');
  await expect(
    page.getByRole('heading', { level: 1, name: /오늘 \d+분 공부했어요/ }),
  ).toBeVisible();
  const weak = page.getByRole('region', { name: '약점 개념' });
  await expect(weak.getByRole('checkbox', { name: /const 선언/ })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectNoA11yViolations(page);
});
// Practice and review sets are built with a per-set random seed, so a month of seeded history
// differs in details (which exercises, so scores and review dates) from run to run. The
// long-term screenshots use responses recorded from this journey on 2026-12-16, with the
// `const` misconception kept confirmed so the 약점 marker is covered. Its `/activity/recent`
// entry (최근 활동, added later) is written by hand to match that month: daily review sets.
// The long-term state is also the dashboard's 1920 shot (D-065).
dashboardShots('long', LONG_TERM, [1280, 1440, 1920]);
test('concept detail: sheet from the concept map, then the full page', async ({ page }) => {
  await prepare(page);
  await openDashboard(page);
  const map = page.getByRole('region', { name: '개념 지도' });
  const tile = map.getByRole('button', { name: /const 선언/ });
  await tile.click();
  const sheet = page.getByRole('dialog', { name: '개념: const 선언' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: '숙련도가 이렇게 계산됐어요' })).toBeVisible();
  await expect(sheet.locator('.evidence-list li').first()).toBeVisible();
  await expect(sheet.getByRole('heading', { name: '선수 개념' })).toBeVisible();
  // 관련 문제 (FR-DASH-02, FR-EX-10): the concept's practice exercises with statistics. The
  // `const` item was answered wrong three times on day two.
  const related = sheet.getByRole('region', { name: '관련 문제' });
  await expect(related.getByText(/\d+문제 중 \d+문제를 풀어 봤어요/)).toBeVisible();
  await expect(
    related
      .getByRole('listitem')
      .filter({ hasText: /시도 \d+회/ })
      .first(),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  // A prerequisite opens in place; Esc closes and focus returns to the tile.
  await sheet.getByRole('button', { name: /let 선언/ }).click();
  await expect(page.getByRole('dialog', { name: '개념: let 선언' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(tile).toBeFocused();

  await page.goto('/concepts/js.basics.const');
  await expect(page.getByRole('heading', { level: 1, name: 'const 선언' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '관련 레슨' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: '관련 문제' })).toBeVisible();
  await expectNoA11yViolations(page);
});

test('weakness set from the dashboard', async ({ page }) => {
  await prepare(page);
  await openDashboard(page);
  const weak = page.getByRole('region', { name: '약점 개념' });
  await weak.getByRole('button', { name: /^약점 집중 시작/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: '약점 집중' })).toBeVisible();
  await expect(page).toHaveURL(/\/review\/session\/[0-9A-Z]{26}\?i=\d+/);
  await expect(page.getByRole('heading', { name: /문제 1/ })).toBeVisible();
  await expectNoA11yViolations(page);
  // Skipping is recorded: the item is marked and a follow-up comes at the end of the set.
  const progress = page.getByRole('navigation', { name: '연습 진행' });
  const before = await progress.getByRole('button').count();
  await page.getByRole('button', { name: '건너뛰기' }).click();
  await expect(progress.getByRole('button', { name: '문제 1: 건너뜀' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /문제 2/ })).toBeVisible();
  expect(await progress.getByRole('button').count()).toBeGreaterThanOrEqual(before);
});
