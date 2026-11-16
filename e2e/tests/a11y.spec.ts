import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, openScreen, SCREENS } from './fixtures.ts';
import { mockPractice, mockRemediation, mockTutor, PRACTICE_URL } from './practice-mocks.ts';
import { failApi, holdLearningApi, mockEmptyReview, WEAK } from './state-mocks.ts';

/** Screens checked here only (their screenshots use fixed data in visual.spec.ts). */
const MORE_SCREENS = [
  { path: '/review/mistakes', heading: '복습' },
  { path: '/review/weak', heading: '복습' },
  { path: '/review/progress', heading: '복습' },
  { path: '/concepts/js.basics.console-log', heading: 'console.log로 출력하기' },
] as const;

/** The review hub sections, all empty (D-065: empty states of the main screens). */
const REVIEW_SECTIONS = [
  { path: '/review', text: '오늘 복습할 개념이 없어요' },
  { path: '/review/mistakes', text: '아직 틀린 문제가 없어요' },
  { path: '/review/weak', text: '아직 약점이 없어요' },
  { path: '/review/progress', text: '아직 숙련 단계가 바뀐 개념이 없어요' },
] as const;

for (const scheme of ['light', 'dark'] as const) {
  for (const { path, heading } of SCREENS) {
    test(`${path} has no WCAG 2.2 AA violations (${scheme})`, async ({ page }) => {
      await openScreen(page, path, heading, scheme);
      await expectNoA11yViolations(page);
    });
  }
}

for (const scheme of ['light', 'dark'] as const) {
  for (const { path, heading } of MORE_SCREENS) {
    test(`${path} has no WCAG 2.2 AA violations (${scheme})`, async ({ page }) => {
      await openScreen(page, path, heading, scheme);
      await expectNoA11yViolations(page);
    });
  }

  test(`weak concepts to pick have no WCAG 2.2 AA violations (${scheme})`, async ({ page }) => {
    await page.route('**/api/v1/weak-concepts', (route) => route.fulfill({ json: WEAK }));
    await openScreen(page, '/review/weak', '복습', scheme);
    await expect(page.getByRole('checkbox', { name: /const 선언/ })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  for (const { path, text } of REVIEW_SECTIONS) {
    test(`${path} empty state has no WCAG 2.2 AA violations (${scheme})`, async ({ page }) => {
      await mockEmptyReview(page);
      await openScreen(page, path, '복습', scheme);
      await expect(page.getByRole('heading', { name: text })).toBeVisible();
      await expectNoA11yViolations(page);
    });
  }

  test(`error state has no WCAG 2.2 AA violations (${scheme})`, async ({ page }) => {
    await failApi(page, '/review-queue');
    await openScreen(page, '/review', '불러오지 못했어요', scheme);
    await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test(`loading state has no WCAG 2.2 AA violations (${scheme})`, async ({ page }) => {
    const release = await holdLearningApi(page);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('.pi-skeleton').first()).toBeVisible();
    await expectNoA11yViolations(page);
    await release();
  });
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

    test(`relearning suggestion has no WCAG 2.2 AA violations (${scheme})`, async ({ page }) => {
      await mockPractice(page);
      await mockRemediation(page);
      await openScreen(page, `${PRACTICE_URL}&i=1`, '첫 프로그램 연습', scheme);
      await page.locator('label', { hasText: '저장되어' }).click();
      await page.getByRole('button', { name: /확실해요/ }).click();
      const card = page.getByRole('region', { name: '잠깐 쉬어가요' });
      await expect(card).toBeVisible();
      await card.getByText('왜 이걸 권하나요?').click();
      await expectNoA11yViolations(page);
      // Following the suggestion opens the appended item.
      await card.getByRole('button', { name: /선수 개념 확인하기/ }).click();
      await expect(page).toHaveURL(/i=3$/);
      await expect(page.getByText('선수 개념 확인', { exact: true })).toBeVisible();
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
