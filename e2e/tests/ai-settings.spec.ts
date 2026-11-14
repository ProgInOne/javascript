import { expect, test } from '@playwright/test';

// 설정 > AI against the production build with PROGINONE_AI_PROVIDER=mock (connected as "mock").

test.describe('settings AI section (mock AI)', () => {
  test('shows the connection, usage and models, and the header indicator links here', async ({
    page,
  }) => {
    await page.goto('/');
    const indicator = page.getByRole('link', { name: 'AI 연결됨' });
    await expect(indicator).toBeVisible();
    await indicator.click();

    await expect(page.getByRole('heading', { level: 1, name: 'AI' })).toBeVisible();
    await expect(page.getByText('연결됨 · ChatGPT Mock')).toBeVisible();
    await expect(page.getByText('제공자: 테스트용 모의 AI')).toBeVisible();
    await expect(page.getByRole('progressbar', { name: '5시간 한도 사용량' })).toBeVisible();
    await expect(page.getByText('0%', { exact: true })).toBeVisible();
    await expect(page.getByText('모의 튜터')).toBeVisible();
  });

  test('disconnects and connects again through the login dialog', async ({ page, context }) => {
    await page.goto('/settings/ai');
    await expect(page.getByText('연결됨 · ChatGPT Mock')).toBeVisible();

    await page.getByRole('button', { name: '연결 해제' }).click();
    await page
      .getByRole('dialog', { name: 'AI 연결을 해제할까요?' })
      .getByRole('button', { name: '연결 해제' })
      .click();
    await expect(page.getByText(/ChatGPT 계정을 연결해 주세요/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'AI 연결 안 됨' })).toBeVisible();

    // The mock completes the login right away; the new tab points at its fake auth URL.
    const popup = context.waitForEvent('page');
    await page.getByRole('button', { name: 'ChatGPT로 연결' }).click();
    await (await popup).close();
    await expect(page.getByText('연결됨 · ChatGPT Mock')).toBeVisible();
    await expect(page.getByText('AI 튜터를 연결했어요', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'AI 연결됨' })).toBeVisible();
  });
});
