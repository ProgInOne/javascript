import { expect, test, type Page } from '@playwright/test';
import { setServerTime } from './clock.ts';
import { expectNoA11yViolations } from './fixtures.ts';

/**
 * The first-run journey on its own server (playwright.config.ts `E2E_JOURNEY_URL`), so the
 * learner really is new: onboarding → dashboard. The server clock is pinned to a fixed instant
 * so dates and the week strip look the same on every run; study time is seeded only through the
 * API (the browser's own heartbeats are dropped).
 */

const JOURNEY_URL = process.env['E2E_JOURNEY_URL'] ?? '';
/** Monday 2026-11-16 10:00 Asia/Seoul. */
export const JOURNEY_T0 = Date.UTC(2026, 10, 16, 1, 0, 0);

test.use({ baseURL: JOURNEY_URL });
test.describe.configure({ mode: 'serial' });

async function prepare(page: Page, scheme: 'light' | 'dark' = 'light') {
  setServerTime(JOURNEY_T0, 'journey');
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.route('**/api/v1/activity/heartbeat', (route) =>
    route.fulfill({ json: { date: '2026-11-16', countedMs: 0, activeMsToday: 0 } }),
  );
}

test.afterAll(() => {
  setServerTime(Date.now(), 'journey');
});

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

  await expect(page.getByRole('heading', { level: 1, name: '대시보드' })).toBeVisible();
  // Never shown again.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: '대시보드' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

// Onboarding goal step (ui-ux.md 시각 회귀 매트릭스 "온보딩(목표 단계)") with a fixed goal.
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
