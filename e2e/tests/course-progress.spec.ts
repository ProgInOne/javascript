import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './fixtures.ts';
import { solveSet as solveInUi } from './practice-helpers.ts';
import { apiFor, readLesson } from './seed.ts';

/**
 * Course progress on the course list and the course detail (D-083) with a real learner: the
 * first lesson read and practised to completion, the second read up to 45%. Runs on the
 * 설정 > 데이터 server (playwright.config.ts `E2E_DATA_SETTINGS_URL`) and starts with a reset,
 * so the progress is exactly this seeding.
 */

const URL = process.env['E2E_DATA_SETTINGS_URL'] ?? '';
const FIRST = 'js-basics.start.first-program';
const SECOND = 'js-basics.values.variables';

test.use({ baseURL: URL });

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

test('the course list and detail show progress and continue where the learner is', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const api = await apiFor(page, request);
  await api.post('/data/reset', { confirm: '초기화' });
  const token = (await page.locator('meta[name="proginone-token"]').getAttribute('content')) ?? '';
  const onboarded = await request.patch(`${URL}/api/v1/learner`, {
    headers: { 'x-proginone-token': token },
    data: { onboarded: true },
  });
  expect(onboarded.ok()).toBe(true);

  // A new learner: not started, no "이어서 학습".
  await page.goto('/courses');
  const card = page.locator('[data-course-card="js-basics"]');
  await expect(card.getByText('시작 전')).toBeVisible();
  await expect(card).toContainText('4단원 중 0단원 완료');
  await expect(card.getByRole('link', { name: /이어서 학습/ })).toHaveCount(0);

  await readLesson(api, FIRST);
  // Completing needs the code items run in the real sandbox: practise in the app.
  await page.goto(`/learn/${FIRST}?mode=practice`);
  await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램 연습' })).toBeVisible();
  await solveInUi(page, false);
  await expect(page.getByRole('region', { name: /마쳤어요/ })).toBeVisible();
  await api.post(`/lessons/${SECOND}/progress`, { readProgress: 0.45 });

  // Course list: bar, count, state chip and the lesson to continue.
  await page.goto('/courses');
  await expect(card.getByText('진행 중')).toBeVisible();
  await expect(card).toContainText('4단원 중 1단원 완료');
  await expect(card.getByRole('progressbar', { name: 'JavaScript 기초 진행률' })).toHaveAttribute(
    'aria-valuenow',
    '25',
  );
  await expect(card.getByRole('link', { name: '이어서 학습: 변수 선언' })).toHaveAttribute(
    'href',
    `/learn/${SECOND}`,
  );
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.reload();
    await expect(card.getByText('진행 중')).toBeVisible();
    await expectNoA11yViolations(page);
  }

  // Course detail: module counts, row states, the lesson to do now and the summary card.
  await card.getByRole('link', { name: 'JavaScript 기초' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'JavaScript 기초' })).toBeVisible();
  const summary = page.getByRole('complementary', { name: '학습 요약' });
  await expect(summary.getByRole('progressbar', { name: '과정 진행률' })).toHaveAttribute(
    'aria-valuenow',
    '25',
  );
  await expect(summary).toContainText('4단원 중 1단원 완료');
  await expect(summary.getByRole('link', { name: '이어서 학습: 변수 선언' })).toHaveAttribute(
    'href',
    `/learn/${SECOND}`,
  );
  const start = page.locator('[data-module-id="js-basics.start"]');
  await expect(start.locator('summary')).toContainText('1/1단원 완료');
  await expect(start.locator('summary').getByText('완료', { exact: true })).toBeVisible();
  await expect(start.getByRole('link', { name: /첫 프로그램.*완료/ })).toBeVisible();
  // The module with the lesson to do now opens by itself.
  const values = page.locator('[data-module-id="js-basics.values"]');
  await expect(values).toHaveAttribute('open', '');
  await expect(values.locator('summary')).toContainText('0/2단원 완료');
  const now = values.getByRole('link', { name: /변수 선언/ });
  await expect(now).toHaveAttribute('aria-current', 'step');
  await expect(now).toContainText('지금 할 단원 · 읽는 중 45%');
  // D-073's `!` keeps its place beside the row (the started course can flag weak prerequisites).
  const row = values.getByRole('listitem').filter({ hasText: '변수 선언' });
  await expect(row.getByRole('link')).toHaveCount(
    (await row.getByRole('link', { name: /^선수 개념 안내: / }).count()) + 1,
  );
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.reload();
    await expect(now).toHaveAttribute('aria-current', 'step');
    await expectNoA11yViolations(page);
  }

  // 390px: nothing overflows sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(now).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.goto('/courses');
  await expect(card.getByText('진행 중')).toBeVisible();
  await expectNoHorizontalScroll(page);
});
