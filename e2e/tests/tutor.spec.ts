import { expect, test, type Page } from '@playwright/test';

// Tutor drawer against the production build with PROGINONE_AI_PROVIDER=mock. Threads persist
// across tests (one per lesson or exercise), so assertions look at the latest messages.

const LESSON = '/learn/js-basics.start.first-program';

async function openPractice(page: Page) {
  await page.goto(`${LESSON}?mode=practice`);
  await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램 연습' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /문제 \d/ })).toBeVisible();
}

const drawerOf = (page: Page) => page.getByRole('complementary', { name: 'AI 튜터' });
const conversation = (page: Page) =>
  drawerOf(page).getByRole('list', { name: '튜터 대화' }).getByRole('listitem');

test.describe('tutor drawer (mock AI)', () => {
  test('opens from practice, streams an answer, and Esc returns focus', async ({ page }) => {
    await openPractice(page);
    const trigger = page.getByRole('button', { name: /튜터/ });
    await trigger.click();
    const drawer = drawerOf(page);
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('현재 문제', { exact: true })).toBeVisible();
    const input = drawer.getByRole('textbox', { name: '튜터에게 질문' });
    await expect(input).toBeFocused();

    await input.fill('console.log는 무엇을 하나요?');
    await input.press('Enter');
    await expect(
      conversation(page).filter({ hasText: 'console.log는 무엇을 하나요?' }).last(),
    ).toBeVisible();
    const reply = conversation(page).last();
    await expect(reply).toContainText('(모의 튜터)', { timeout: 10_000 });
    await expect(reply).toContainText('한 문장으로 정리해 보세요', { timeout: 10_000 });
    await expect(reply).not.toContainText('<meta>');
    await expect(drawer.getByRole('button', { name: '보내기' })).toBeVisible();

    await input.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('cancels a reply in flight and keeps the partial text', async ({ page }) => {
    await openPractice(page);
    await page.keyboard.press('ControlOrMeta+j');
    const drawer = drawerOf(page);
    const input = drawer.getByRole('textbox', { name: '튜터에게 질문' });
    await expect(input).toBeFocused();
    // The mock streams this question slowly (MOCK_SLOW_MARKER).
    await input.fill('[mock:slow] 천천히 설명해 주세요');
    await input.press('Enter');
    const reply = conversation(page).last();
    await expect(reply).toContainText('(모의 튜터)', { timeout: 15_000 });
    await drawer.getByRole('button', { name: '중단' }).click();
    await expect(reply).toContainText('(중단됨)', { timeout: 10_000 });
    await expect(reply).not.toContainText('한 문장으로 정리해 보세요');
  });

  test('asks about selected lesson text', async ({ page }) => {
    await page.goto(LESSON);
    await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램' })).toBeVisible();
    const paragraph = page.locator('article p').filter({ hasText: '결과를 눈으로 확인' }).first();
    await paragraph.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.getByRole('button', { name: /튜터에게 질문/ }).click();

    const drawer = drawerOf(page);
    await expect(drawer.getByText(/선택한 텍스트 \d+자/)).toBeVisible();
    await expect(drawer.getByText('이 단원', { exact: true })).toBeVisible();
    const input = drawer.getByRole('textbox', { name: '튜터에게 질문' });
    await input.fill('이 문장을 쉽게 설명해 줄래요?');
    await input.press('Enter');
    await expect(conversation(page).last()).toContainText('(모의 튜터)', { timeout: 10_000 });
    await expect(drawer.getByText(/선택한 텍스트 \d+자/).first()).toBeVisible(); // shown on the question
  });

  test('re-explains an opened hint with AI', async ({ page }) => {
    await openPractice(page);
    const open = page.getByRole('button', { name: /힌트 \d\/\d 보기/ });
    if (await open.isVisible()) await open.click();
    await page.getByRole('button', { name: /AI에게 (이 단계 )?다시 설명받기/ }).click();
    await expect(page.getByRole('region', { name: /AI 힌트 \d단계|작성된 힌트/ })).toBeVisible({
      timeout: 10_000,
    });
  });
});
