import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './fixtures.ts';

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
    await expect(page.getByRole('radio', { name: '모의 튜터 (기본)' })).toBeChecked();
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

/** Session-token API calls from the app page (the settings PATCH the screen also uses). */
async function api(page: Page) {
  const token = (await page.locator('meta[name="proginone-token"]').getAttribute('content')) ?? '';
  const headers = { 'x-proginone-token': token };
  return {
    patchSettings: (data: Record<string, unknown>) =>
      page.request.patch('/api/v1/settings', { headers, data }),
    lastTutorCall: async () => {
      const res = await page.request.get('/api/v1/ai/calls?limit=1&taskName=tutor.reply', {
        headers,
      });
      return ((await res.json()) as { calls: { model: string | null; effort: string }[] }).calls[0];
    },
    ask: async () => {
      const thread = (await (
        await page.request.post('/api/v1/tutor/threads', {
          headers,
          data: { scopeType: 'lesson', scopeId: 'js-basics.start.first-program' },
        })
      ).json()) as { id: string };
      const reply = await page.request.post(`/api/v1/tutor/threads/${thread.id}/messages`, {
        headers,
        data: { question: '모델 확인', entryPoint: 'free' },
      });
      expect(await reply.text()).toMatch(/event: done\ndata: \{[^\n]*"status":"complete"/);
    },
  };
}

test.describe('settings AI · model selection (FR-SET-01, mock AI)', () => {
  test.afterEach(async ({ page }) => {
    // Back to the default model for the other specs.
    await (await api(page)).patchSettings({ 'ai.model': null });
  });

  test('chooses a model from model/list and the tutor runs on it', async ({ page }) => {
    await page.goto('/settings/ai');
    const models = page.getByRole('radiogroup', { name: '튜터와 AI 기능이 쓸 모델' });
    await expect(models.getByRole('radio', { name: '모의 튜터 (기본)' })).toBeChecked();
    await expect(models.getByText('테스트용 두 번째 모델 · 추론 강도 보통·높음')).toBeVisible();
    await expectNoA11yViolations(page);

    // Controlled by the saved setting: the radio turns on once the PATCH has answered.
    const deep = models.getByRole('radio', { name: '모의 튜터 (깊게)' });
    await deep.click();
    await expect(deep).toBeChecked();
    await page.reload();
    await expect(
      page
        .getByRole('radiogroup', { name: '튜터와 AI 기능이 쓸 모델' })
        .getByRole('radio', { name: '모의 튜터 (깊게)' }),
    ).toBeChecked();

    const calls = await api(page);
    await calls.ask();
    // The deep model supports medium/high only: the tutor's low effort moves up to medium.
    expect(await calls.lastTutorCall()).toMatchObject({
      model: 'mock-tutor-deep',
      effort: 'medium',
    });
  });

  test('falls back to the default model when the saved one is gone', async ({ page }) => {
    await page.goto('/settings/ai');
    const calls = await api(page);
    expect((await calls.patchSettings({ 'ai.model': 'retired-model' })).ok()).toBe(true);
    await page.reload();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: '저장한 모델(retired-model)을 더 이상 쓸 수 없어서' }),
    ).toBeVisible();
    await expect(page.getByRole('radio', { name: '모의 튜터 (기본)' })).toBeChecked();
    await expectNoA11yViolations(page);
    await calls.ask();
    expect(await calls.lastTutorCall()).toMatchObject({ model: 'mock-tutor', effort: 'low' });
  });
});
