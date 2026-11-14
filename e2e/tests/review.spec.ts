import { expect, test } from '@playwright/test';
import { DAY_MS, shiftServerClock } from './clock.ts';
import { expectNoA11yViolations } from './fixtures.ts';
import { solveSet } from './practice-helpers.ts';

/**
 * Practice today, review on a later day (roadmap M4 완료 조건: "다음 날 복습까지"). The server's
 * learning clock is moved forward with the test-only clock file; the browser keeps real time.
 */

test.afterEach(() => {
  shiftServerClock(0);
});

test.describe('dashboard and review', () => {
  test('practices a lesson, then reviews its concepts on a later day', async ({ page }) => {
    // Today: finish a practice set (the lesson's concepts get their first FSRS review).
    await page.goto('/learn/js-basics.start.first-program?mode=practice');
    await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램 연습' })).toBeVisible();
    await solveSet(page, false);
    await expect(page.getByRole('region', { name: /마쳤어요/ })).toBeVisible();

    // The next day nothing is due yet (FSRS schedules the first review a few days out); move
    // forward a day at a time until the concepts are due, as a learner coming back would see it.
    const nav = page.getByRole('navigation', { name: '주 메뉴' });
    const reviewLink = nav.getByRole('link', { name: /^복습/ });
    let days = 1;
    for (; days <= 7; days++) {
      shiftServerClock(days * DAY_MS);
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: '대시보드' })).toBeVisible();
      await expect(page.getByText(/오늘 복습할 개념이/)).toBeVisible();
      if (/\d/.test(await reviewLink.innerText())) break;
    }
    test.info().annotations.push({ type: 'review due after days', description: String(days) });
    expect(days).toBeLessThanOrEqual(7);
    await expect(reviewLink).toContainText(/\d/);
    await expect(page.getByText(/오늘 복습할 개념이 \d+개 있어요/)).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByRole('link', { name: '복습 시작' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '복습' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /오늘 복습할 개념 \d+개/ })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: '복습 시작' }).click();

    await expect(page.getByRole('heading', { level: 1, name: '오늘의 복습' })).toBeVisible();
    await expect(page).toHaveURL(/\/review\/session\/[0-9A-Z]{26}\?i=\d+/);
    // Interleaving: the concept is not named before the answer is graded.
    await expect(page.getByText(/^개념: /)).toHaveCount(0);
    await solveSet(page, false);

    const summary = page.getByRole('region', { name: '오늘의 복습을 마쳤어요' });
    await expect(summary).toBeVisible();
    await expectNoA11yViolations(page);
    await summary.getByRole('link', { name: '대시보드로' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '대시보드' })).toBeVisible();
    // Concepts still in FSRS learning steps can be due again later the same day, so the count
    // is not asserted to be zero here (the empty state is covered by the web unit tests).
  });
});
