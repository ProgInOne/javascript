import { expect, test, type Page } from '@playwright/test';
import { mockPractice, PRACTICE_URL } from './practice-mocks.ts';

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
});
