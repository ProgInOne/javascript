import { expect, test, type Page } from '@playwright/test';

// AI-unavailable states end to end (docs/design/ai-system.md#테스트 "E2E: AI 연결 안 됨, 한도 초과,
// 응답 실패"), against the production build with PROGINONE_AI_PROVIDER=mock. The mock fails a
// question containing `[mock:error:AI_*]` with that error; disconnecting goes through 설정 > AI.
// Learning keeps working without AI. The last test connects again for the specs that follow.

const LESSON = '/learn/js-basics.start.first-program';

/** Reading mode: opening practice here would start a set that practice.spec expects to start. */
async function openLesson(page: Page) {
  await page.goto(LESSON);
  await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램' })).toBeVisible();
}

async function apiHeaders(page: Page) {
  const token = await page.locator('meta[name="proginone-token"]').getAttribute('content');
  return { 'x-proginone-token': token ?? '' };
}

test.describe('AI unavailable (mock AI)', () => {
  test('a failed reply shows the AI error in the conversation and the next question works', async ({
    page,
  }) => {
    await openLesson(page);
    await page.getByRole('button', { name: /튜터/ }).click();
    const drawer = page.getByRole('complementary', { name: 'AI 튜터' });
    const input = drawer.getByRole('textbox', { name: '튜터에게 질문' });
    await input.fill('[mock:error:AI_RATE_LIMITED] 한도 테스트');
    await input.press('Enter');
    const reply = drawer.getByRole('list', { name: '튜터 대화' }).getByRole('listitem').last();
    await expect(reply).toContainText('답변을 받지 못했어요.', { timeout: 10_000 });
    await expect(reply).toContainText('AI 사용량 한도에 도달했습니다');
    await expect(reply).toContainText('(AI_RATE_LIMITED)');

    await input.fill('다시 질문해요');
    await input.press('Enter');
    await expect(
      drawer.getByRole('list', { name: '튜터 대화' }).getByRole('listitem').last(),
    ).toContainText('(모의 튜터)', { timeout: 10_000 });
  });

  test('when disconnected, AI entry points say why, the server refuses or falls back, and learning continues', async ({
    page,
    request,
    context,
  }) => {
    await page.goto('/settings/ai');
    await page.getByRole('button', { name: '연결 해제' }).click();
    await page
      .getByRole('dialog', { name: 'AI 연결을 해제할까요?' })
      .getByRole('button', { name: '연결 해제' })
      .click();
    await expect(page.getByRole('link', { name: 'AI 연결 안 됨' })).toBeVisible();

    await openLesson(page);
    await expect(page.getByRole('link', { name: 'AI 연결 안 됨' })).toBeVisible();
    await page.getByRole('button', { name: /튜터/ }).click();
    const drawer = page.getByRole('complementary', { name: 'AI 튜터' });
    await expect(drawer.getByRole('textbox', { name: '튜터에게 질문' })).toBeDisabled();
    await expect(drawer.getByRole('link', { name: 'AI 연결 설정' }).first()).toBeVisible();
    // The lesson itself does not need AI.
    await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램' })).toBeVisible();

    // The server refuses AI requests with the same codes the UI explains.
    const headers = await apiHeaders(page);
    const thread = (await (
      await request.post('/api/v1/tutor/threads', { headers, data: { scopeType: 'general' } })
    ).json()) as { id: string };
    const refused = await request.post(`/api/v1/tutor/threads/${thread.id}/messages`, {
      headers,
      data: { question: '연결 안 됨' },
    });
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'AI_NOT_CONNECTED',
    );
    // Explaining a wrong attempt falls back to the authored misconception text.
    const attempt = await request.post(
      '/api/v1/exercises/js-basics.start.first-program.mcq-log-role/inline-attempts',
      {
        headers,
        data: {
          answer: { optionId: 'b' },
          confidence: 'unsure',
          startedAt: Date.now() - 20_000,
          activeMs: 15_000,
        },
      },
    );
    const attemptId = ((await attempt.json()) as { attempt: { id: string } }).attempt.id;
    const explained = await request.post(`/api/v1/attempts/${attemptId}/explanation`, {
      headers,
      data: {},
    });
    expect(explained.status()).toBe(200);
    expect((await explained.json()) as unknown).toMatchObject({
      source: 'authored',
      fallbackCode: 'AI_NOT_CONNECTED',
    });

    // Connect again (the mock login completes right away) for the following specs.
    await page.goto('/settings/ai');
    const popup = context.waitForEvent('page');
    await page.getByRole('button', { name: 'ChatGPT로 연결' }).click();
    await (await popup).close();
    await expect(page.getByRole('link', { name: 'AI 연결됨' })).toBeVisible();
  });
});
