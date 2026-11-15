import { expect, test, type Page } from '@playwright/test';
import { MCQ, mockPractice, PRACTICE_URL, views } from './practice-mocks.ts';

const LESSON = '/learn/js-basics.start.first-program';
const PHONE = { width: 390, height: 844 };

/** The page itself never scrolls sideways; wide code and tables scroll inside their own box. */
async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

const LONG_LINE = `console.log("${'한 줄에 아주 길게 이어지는 문자열 '.repeat(8)}");`;
const code = { type: 'code', lang: 'js', meta: null, value: `${LONG_LINE}\n${LONG_LINE}` };
const paragraph = (value: string) => ({ type: 'paragraph', children: [{ type: 'text', value }] });

test.describe('phone width (390px)', () => {
  test.use({ viewport: PHONE });

  test('the lesson reader fits, wide code in a pitfall or callout included', async ({ page }) => {
    // The fixture lesson has no wide code: add some where real lessons put it (a top-level block,
    // a pitfall part and a callout), so the check covers the grid tracks that used to grow.
    await page.route('**/api/v1/lessons/js-basics.start.first-program', async (route) => {
      const res = await route.fetch();
      const lesson = (await res.json()) as { body: unknown[] };
      lesson.body.push({
        type: 'component',
        name: 'Section',
        props: { kind: 'examples', id: 'wide-code' },
        children: [
          code,
          {
            type: 'component',
            name: 'Pitfall',
            props: {},
            children: [
              {
                type: 'component',
                name: 'Wrong',
                props: {},
                children: [paragraph('넓은 코드가 있는 오답'), code],
              },
            ],
          },
          {
            type: 'component',
            name: 'Callout',
            props: { kind: 'tip', title: '넓은 코드' },
            children: [code],
          },
        ],
      });
      await route.fulfill({ response: res, json: lesson });
    });
    await page.goto(LESSON);
    await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램' })).toBeVisible();
    await expect(page.locator('pre.lesson-code').first()).toBeVisible();
    await expect(page.locator('.lesson-pitfall pre.lesson-code')).toBeVisible();
    await expectNoHorizontalScroll(page);
    // The learning header keeps its mode switch on one line.
    const read = page.getByRole('link', { name: '읽기', exact: true });
    expect((await read.boundingBox())?.height).toBeLessThanOrEqual(32);
  });

  test('the practice screen fits for a choice item and a code item', async ({ page }) => {
    await mockPractice(page);
    await page.goto(PRACTICE_URL);
    await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램 연습' })).toBeVisible();
    await expect(page.getByRole('radio').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.goto(`${PRACTICE_URL}&i=2`);
    await expect(page.getByRole('textbox', { name: 'main.js 편집기' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('a wide Markdown table in a prompt scrolls inside its own box', async ({ page }) => {
    await mockPractice(page);
    const row = (n: number) => `| ${n}번째 값 | \`${'아주 긴 셀 내용 '.repeat(6)}\` | 설명 |`;
    const table = ['| 이름 | 값 | 비고 |', '|---|:-:|--:|', row(1), row(2)].join('\n');
    await page.route(
      (url) => url.pathname === `/api/v1/exercises/${MCQ}`,
      (route) => route.fulfill({ json: { ...views[MCQ], prompt: `표를 보세요.\n\n${table}` } }),
    );
    await page.goto(PRACTICE_URL);
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '이름' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  for (const { path, heading } of [
    { path: '/', heading: '대시보드' },
    { path: '/courses', heading: '과정' },
    { path: '/review', heading: '복습' },
  ]) {
    test(`the ${heading} page and its header fit`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.locator('[data-ai-state]')).not.toHaveAttribute('data-ai-state', 'loading');
      // Every header control is in (the goal chip loads on its own).
      await expect(page.getByRole('button', { name: /오늘 목표/ })).toBeVisible();
      await expectNoHorizontalScroll(page);
      // The header stays one row high: nothing wraps onto a second line.
      const header = page.locator('header[data-f6-region]');
      expect((await header.boundingBox())?.height).toBeLessThanOrEqual(57);
      await expect(page.getByRole('button', { name: '메뉴' })).toBeVisible();
    });
  }

  test('the header menu works by keyboard', async ({ page }) => {
    await page.goto('/courses');
    await expect(page.getByRole('heading', { level: 1, name: '과정' })).toBeVisible();
    const menu = page.getByRole('button', { name: '메뉴' });
    const nav = page.getByRole('navigation', { name: '주 메뉴' });
    await expect(nav).toBeHidden();
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: '과정' })).toHaveAttribute('aria-current', 'page');
    await expectNoHorizontalScroll(page);
    // Esc closes it and keeps focus on the button.
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
    // The links follow the button in tab order; choosing one navigates and closes the menu.
    await page.keyboard.press('Space');
    await expect(nav).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(nav.getByRole('link', { name: '대시보드' })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(nav.getByRole('link', { name: /복습/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: '복습' })).toBeVisible();
    await expect(nav).toBeHidden();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
  });
});

test('the header keeps its inline nav at desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '대시보드' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: '주 메뉴' });
  await expect(nav.getByRole('link', { name: '과정' })).toBeVisible();
  await expect(page.getByRole('button', { name: '메뉴' })).toBeHidden();
});
