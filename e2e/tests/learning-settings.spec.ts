import { expect, test } from '@playwright/test';

/**
 * 설정 > 학습 방식 and 화면 change what the lesson shows (D-046). Runs on the 설정 > 데이터 server
 * (playwright.config.ts `E2E_DATA_SETTINGS_URL`) so other tests keep the default settings; the
 * defaults are restored at the end.
 */

const URL = process.env['E2E_DATA_SETTINGS_URL'] ?? '';
const LESSON = '/learn/js-basics.start.first-program';

/** The keys this spec changes, at their defaults (packages/shared/src/settings.ts). */
const DEFAULTS = {
  'practice.askConfidence': true,
  'lesson.predictFirst': 'recommended',
  'lesson.fontSize': 'medium',
};

test.use({ baseURL: URL });

test.afterEach(async ({ page, request }) => {
  await page.goto('/settings/appearance');
  const token = (await page.locator('meta[name="proginone-token"]').getAttribute('content')) ?? '';
  const res = await request.patch(`${URL}/api/v1/settings`, {
    headers: { 'x-proginone-token': token },
    data: DEFAULTS,
  });
  expect(res.ok()).toBe(true);
});

test('learning settings change the lesson: confidence, predict first, body size', async ({
  page,
}) => {
  await page.goto(LESSON);
  const check = page.locator('.lesson-inline-check');
  await expect(check.getByRole('button', { name: /확실해요/ })).toBeVisible();
  const example = page.getByRole('figure', { name: /예제/ }).first();
  await expect(example.getByRole('button', { name: '예측 건너뛰기' })).toBeVisible();

  await page.goto('/settings/learning');
  await page.getByRole('checkbox', { name: /확신도 묻기/ }).click();
  await expect(page.getByRole('checkbox', { name: /확신도 묻기/ })).not.toBeChecked();
  await page.getByRole('radio', { name: /^필수/ }).click();
  await expect(page.getByRole('radio', { name: /^필수/ })).toBeChecked();
  await page.getByRole('link', { name: '화면' }).click();
  await page.getByRole('radio', { name: /크게/ }).click();
  await expect(page.getByRole('radio', { name: /크게/ })).toBeChecked();

  await page.goto(LESSON);
  // One submit button, no confidence (ui-ux.md 확신도 입력 타이밍).
  await expect(check.getByRole('button', { name: /^제출/ })).toBeVisible();
  await expect(check.getByRole('button', { name: /확실해요/ })).toHaveCount(0);
  // Predicting is required: no skip link, run waits for a prediction.
  await expect(example.getByRole('button', { name: '예측 건너뛰기' })).toHaveCount(0);
  await expect(example.getByRole('button', { name: '실행' })).toBeDisabled();
  // 20px lesson body.
  await expect(page.locator('.lesson-prose').first()).toHaveCSS('font-size', '20px');
});
