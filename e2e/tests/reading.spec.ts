import { expect, test } from '@playwright/test';

const LESSON = '/learn/js-basics.start.first-program';

test.describe('reading mode', () => {
  test('answers inline checks, remembers the reading position and sends heartbeats', async ({
    page,
  }) => {
    await page.clock.install();
    await page.goto(LESSON);
    await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램' })).toBeVisible();

    // Inline check: graded at once by the server, outside any practice set.
    const check = page.locator('.lesson-inline-check');
    await check.locator('label', { hasText: '맨 아래의 문장' }).click();
    await check.getByRole('button', { name: /확실해요/ }).click();
    await expect(check.getByRole('heading', { name: '정답이 아니에요.' })).toBeVisible();
    await check.getByRole('button', { name: '다시 풀기' }).click();
    await check.locator('label', { hasText: '맨 위의 문장' }).click();
    await check.getByRole('button', { name: '애매해요' }).click();
    await expect(check.getByRole('heading', { name: '정답이에요.' })).toBeVisible();
    // A code exercise referenced inline is left to practice mode.
    await expect(page.getByText('이 확인 문제는 실습 모드에서 풀 수 있어요.')).toBeVisible();

    // Heartbeat every 30 s while the tab is visible and the learner is active.
    const heartbeat = page.waitForRequest('**/api/v1/activity/heartbeat');
    await page.mouse.move(10, 10);
    await page.keyboard.press('Shift');
    await page.clock.fastForward(30_000);
    // The lesson on screen also gets the time (per-lesson actual time, FR-GOAL-02).
    expect((await heartbeat).postDataJSON()).toMatchObject({
      visible: true,
      lessonId: 'js-basics.start.first-program',
    });

    // Scrolling saves the position (debounced); the next visit offers to resume there.
    await page
      .getByRole('navigation', { name: '목차' })
      .getByRole('link', { name: '이해도 확인' })
      .click();
    const saved = page.waitForRequest(
      (req) =>
        req.url().endsWith('/progress') &&
        typeof (req.postDataJSON() as { lastSectionId?: unknown }).lastSectionId === 'string',
    );
    await page.clock.fastForward(3_000);
    await saved;
    await page.goto(LESSON);
    await expect(page.getByText(/지난번에 ‘.+’까지 읽었어요/)).toBeVisible();
    await page.getByRole('link', { name: '이어서 읽기' }).click();
    await expect(page).toHaveURL(/#[a-z-]+$/);
  });
});
