import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './fixtures.ts';

/**
 * Code drafts of lesson examples (FR-CODE-06, NFR-04, D-063) on the production build: an edited
 * example is saved on the server and restored after a reload without the browser's copy, runs as
 * edited, and "원래 코드로" deletes the draft. Practice item drafts are covered in the practice
 * flow (practice.spec.ts, the fix_bug item of the second set).
 */

const LESSON = '/learn/js-basics.values.variables';

const example = (page: Page) => page.getByRole('figure', { name: /예제/ });

test('lesson example: edit, reload without the browser copy, run, restore the original', async ({
  page,
}) => {
  await page.goto(LESSON);
  await expect(page.getByRole('heading', { level: 1, name: '변수 선언' })).toBeVisible();
  const figure = example(page);
  await expect(figure.getByText('console.log(count);')).toBeVisible();

  await figure.getByRole('button', { name: '코드 수정' }).click();
  const editor = figure.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('let count = 1;\ncount = 3;\nconsole.log(count);');
  await expect(figure.getByText('저장됨', { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await expect(example(page).locator('.cm-content')).toContainText('count = 3;');
  await expect(example(page).getByText('수정한 코드')).toBeVisible();

  // The edited code is what runs (prediction skipped).
  await example(page).getByRole('button', { name: '예측 건너뛰기' }).click();
  await example(page).getByRole('button', { name: '실행' }).click();
  await expect(example(page).getByRole('list', { name: '콘솔 출력' })).toHaveText('3');

  // Back to the original: the draft is gone on the server too.
  await example(page).getByRole('button', { name: '원래 코드로' }).click();
  await expect(example(page).getByText('count = 2;')).toBeVisible();
  await expect(example(page).locator('.cm-content')).toHaveCount(0);
  await page.reload();
  await expect(example(page).getByText('count = 2;')).toBeVisible();
  await expect(example(page).getByRole('button', { name: '코드 수정' })).toBeVisible();
});
