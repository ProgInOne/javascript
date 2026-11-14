import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './fixtures.ts';

import { solveSet } from './practice-helpers.ts';

/**
 * The practice flow on the production build with the fixture lesson's exercises (one per type),
 * graded by the real server and, for code, run in the real sandbox.
 */

const LESSON = '/learn/js-basics.start.first-program';

test.describe('practice mode', () => {
  test('reads a lesson, solves every type in the set and passes the lesson', async ({ page }) => {
    await page.goto(LESSON);
    await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램' })).toBeVisible();
    await page.getByRole('link', { name: '연습 시작' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램 연습' })).toBeVisible();
    await expect(page).toHaveURL(/mode=practice&set=[0-9A-Z]{26}&i=1/);
    await expect(page.getByRole('link', { name: '실습' })).toHaveAttribute('aria-current', 'page');

    const { total, seen } = await solveSet(page, true);
    expect(total).toBe(12);
    expect(seen).toEqual(
      new Set([
        'mcq_single',
        'mcq_multi',
        'true_false',
        'fill_blank',
        'predict_output',
        'parsons',
        'find_bug_line',
        'fix_bug',
        'web_task',
      ]),
    );

    // 단원 완료 순간: counts, concept stage changes, pass checks, next step.
    const summary = page.getByRole('region', { name: '첫 프로그램 단원을 마쳤어요' });
    await expect(summary.getByRole('heading', { level: 2 })).toBeFocused();
    await expect(summary).toContainText('연습 12문제 · 정답 12');
    await expect(summary.getByText(/→ 연습 중/).first()).toBeVisible();
    await expect(summary.getByText('이 단원의 개념을 모두 기준만큼 연습했어요')).toBeVisible();
    await expect(summary.getByRole('link', { name: '다음 단원: 변수 선언' })).toBeVisible();
    await expectNoA11yViolations(page);

    // The URL holds the state: a reload shows the finished set again.
    await page.reload();
    await expect(page.getByRole('region', { name: /마쳤어요/ })).toBeVisible();

    // "한 번 더 연습" builds the next set.
    const finished = new URL(page.url()).searchParams.get('set');
    await page.getByRole('button', { name: '한 번 더 연습' }).click();
    await expect(page).toHaveURL(/i=1$/);
    expect(new URL(page.url()).searchParams.get('set')).not.toBe(finished);
    await expect(page.getByRole('navigation', { name: '연습 진행' })).toContainText('0 / 12');
  });
});
