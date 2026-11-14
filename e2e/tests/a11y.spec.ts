import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, openScreen, SCREENS } from './fixtures.ts';
import { mockPractice, mockTutor, PRACTICE_URL } from './practice-mocks.ts';

for (const scheme of ['light', 'dark'] as const) {
  for (const { path, heading } of SCREENS) {
    test(`${path} has no WCAG 2.2 AA violations (${scheme})`, async ({ page }) => {
      await openScreen(page, path, heading, scheme);
      await expectNoA11yViolations(page);
    });
  }
}

test.describe('practice screen', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`choice, feedback and code items have no WCAG 2.2 AA violations (${scheme})`, async ({
      page,
    }) => {
      await mockPractice(page);
      await openScreen(page, `${PRACTICE_URL}&i=1`, '첫 프로그램 연습', scheme);
      await expect(page.getByRole('heading', { name: /문제 1/ })).toBeVisible();
      await expectNoA11yViolations(page);

      await page.locator('label', { hasText: '저장되어' }).click();
      await page.getByRole('button', { name: /확실해요/ }).click();
      await expect(page.getByRole('heading', { name: '정답이 아니에요.' })).toBeVisible();
      await expectNoA11yViolations(page);

      await openScreen(page, `${PRACTICE_URL}&i=2`, '첫 프로그램 연습', scheme);
      await expect(page.getByRole('textbox', { name: 'main.js 편집기' })).toBeVisible();
      await expectNoA11yViolations(page);
    });

    test(`tutor drawer has no WCAG 2.2 AA violations (${scheme})`, async ({ page }) => {
      await mockPractice(page);
      await mockTutor(page);
      await openScreen(page, `${PRACTICE_URL}&i=2`, '첫 프로그램 연습', scheme);
      await page.getByRole('button', { name: /튜터/ }).click();
      const drawer = page.getByRole('complementary', { name: 'AI 튜터' });
      await expect(drawer.getByText('둘째 줄에서 어느 부분이')).toBeVisible();
      await expectNoA11yViolations(page);
    });
  }
});
