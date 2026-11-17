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

    // Scrolling saves the position (debounced); the next visit reopens at that step (D-077).
    const savedAt = (id: string) =>
      page.waitForRequest(
        (req) =>
          req.url().endsWith('/progress') &&
          (req.postDataJSON() as { lastSectionId?: unknown }).lastSectionId === id,
      );
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await expect(page.getByText('단계 1 / 5')).toBeVisible();
    let saved = savedAt('check');
    await page
      .getByRole('navigation', { name: '목차' })
      .getByRole('link', { name: '이해도 확인' })
      .click();
    await expect(page.getByText('단계 5 / 5')).toBeVisible();
    await page.clock.fastForward(3_000);
    await saved;
    await page.goto(LESSON);
    await expect(page.getByText(/지난번에 5단계 ‘확인’의 ‘.+’까지 읽었어요/)).toBeVisible();
    await page.clock.runFor(500);
    await expect(page.getByText('단계 5 / 5')).toBeVisible();
    await expect(page.getByRole('group', { name: '5단계: 확인' })).toBeInViewport();

    // "다음 단계" moves to the next card, focuses it, and the step is remembered.
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await expect(page.getByText('단계 1 / 5')).toBeVisible();
    await page.getByRole('button', { name: '다음 단계: 원리' }).click();
    await expect(page.getByText('단계 2 / 5')).toBeVisible();
    await expect(page.getByRole('group', { name: '2단계: 원리' })).toBeFocused();
    saved = savedAt('examples');
    await page.getByRole('button', { name: '다음 단계: 직접 해 보기' }).click();
    const third = page.getByRole('group', { name: '3단계: 직접 해 보기' });
    await expect(third).toBeFocused();
    await expect(third).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('group', { name: '1단계: 왜 배울까' })).toHaveAttribute(
      'data-state',
      'done',
    );
    // Later steps are quieter but never locked.
    await expect(page.getByRole('group', { name: '4단계: 주의' })).toHaveAttribute(
      'data-state',
      'upcoming',
    );
    await page.clock.fastForward(3_000);
    await saved;
    await page.reload();
    await page.clock.runFor(500);
    await expect(page.getByText('단계 3 / 5')).toBeVisible();
    await expect(third).toBeInViewport();
  });

  test('runs an example with ⌘Enter, folds the side column, remembers the tutor drawer and lists shortcuts', async ({
    page,
  }) => {
    await page.goto(LESSON);
    await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램' })).toBeVisible();

    // FR-UI-02: ⌘Enter (Ctrl+Enter) runs the lesson example from its prediction field.
    const example = page.getByRole('figure', { name: /예제 · JavaScript/ });
    await example.getByRole('textbox', { name: '예상한 출력' }).fill('안녕하세요\n3');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(example.getByRole('list', { name: '콘솔 출력' })).toContainText('안녕하세요');

    // ? opens the shortcut help outside text fields; Esc closes it.
    await page.getByRole('heading', { level: 1, name: '첫 프로그램' }).click();
    await page.keyboard.press('?');
    const help = page.getByRole('dialog', { name: '단축키' });
    await expect(help).toBeVisible();
    await expect(help.getByText('다음 힌트')).toBeVisible();
    // The first Esc may close the close button's tooltip (focus lands on it), the next the dialog.
    await expect(async () => {
      await page.keyboard.press('Escape');
      await expect(help).toBeHidden({ timeout: 500 });
    }).toPass();
    await page.getByRole('button', { name: '단축키 도움말' }).click();
    await expect(help).toBeVisible();
    await help.getByRole('button', { name: '닫기' }).click();
    await expect(help).toBeHidden();

    // FR-UI-01: the side column folds and stays folded on the next visit.
    await page.getByRole('button', { name: '단원 정보 접기' }).click();
    await expect(page.getByRole('navigation', { name: '목차' })).toBeHidden();
    // The tutor drawer reopens where it was left open (wide screens only), without taking focus.
    await page.getByRole('button', { name: /튜터/ }).click();
    const drawer = page.getByRole('complementary', { name: 'AI 튜터' });
    await expect(drawer).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램' })).toBeVisible();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('textbox', { name: '튜터에게 질문' })).not.toBeFocused();
    await page.getByRole('button', { name: '단원 정보 펼치기' }).click();
    await expect(page.getByRole('navigation', { name: '목차' })).toBeVisible();
    await drawer.getByRole('button', { name: '튜터 닫기' }).click();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램' })).toBeVisible();
    await expect(drawer).toBeHidden();
  });
});
