import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './fixtures.ts';

/**
 * The practice flow on the production build with the fixture lesson's exercises (one per type),
 * graded by the real server and, for code, run in the real sandbox. Item order comes from the
 * engine (seeded per set), so each item is answered by its type.
 */

const LESSON = '/learn/js-basics.start.first-program';

/** Replaces the editor content. `insertText` avoids CodeMirror's bracket auto-closing. */
async function replaceCode(page: Page, code: string) {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(code);
}

const WEB_ANSWER = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>제목</title>
    <style>
      h1 { font-size: 24px; color: rgb(200, 0, 0); }
    </style>
  </head>
  <body>
    <h1>안녕하세요</h1>
  </body>
</html>
`;

const P = 'js-basics.start.first-program.';

/** Answers one item correctly. The first time through, also exercises wrong answers and hints. */
async function answer(page: Page, exerciseId: string, firstSet: boolean) {
  const main = page.getByRole('main');
  const submitSure = () => page.keyboard.press('ControlOrMeta+Enter');
  switch (exerciseId.replace(P, '')) {
    case 'mcq-log-role':
      if (firstSet) {
        // Wrong and confident first, then retry: feedback, misconception and retry path.
        await main.locator('label', { hasText: '저장되어' }).click();
        await main.getByRole('button', { name: /확실해요/ }).click();
        await expect(main.getByRole('heading', { name: '정답이 아니에요.' })).toBeVisible();
        await expect(main.getByText(/확신했는데 아니었네요/)).toBeVisible();
        await expect(main.getByText('출력을 반환으로 착각함')).toBeVisible();
        await main.getByRole('button', { name: '다시 풀기' }).click();
        await main.locator('label', { hasText: '글자가 보인다' }).click();
        await main.getByRole('button', { name: '애매해요' }).click();
      } else {
        await main.locator('label', { hasText: '글자가 보인다' }).click();
        await submitSure();
      }
      break;
    case 'mcq-first-line':
      await main.locator('label', { hasText: '맨 위의 문장' }).click();
      await submitSure();
      break;
    case 'fill-semicolon':
      await main.getByRole('textbox', { name: /빈칸/ }).fill(';');
      await submitSure();
      break;
    case 'fill-log-name':
      await main.getByRole('textbox', { name: /빈칸/ }).fill('console.log');
      await submitSure();
      break;
    case 'predict-quoted':
      await main.getByLabel('예상 출력').fill('1 + 2\n3');
      await submitSure();
      break;
    case 'predict-order':
      if (firstSet) {
        // Hint ladder: one step at a time, also with ⌘. (the server records each level).
        await main.getByRole('button', { name: /힌트 1\/3 보기/ }).click();
        await expect(main.getByText('프로그램은 어느 쪽부터 실행될까요?')).toBeVisible();
        await page.keyboard.press('ControlOrMeta+.');
        await expect(main.getByText('console.log 한 번이 콘솔의 한 줄이 돼요.')).toBeVisible();
      }
      await main.getByLabel('예상 출력').fill('일어나기\n3');
      await submitSure();
      if (firstSet) {
        await expect(main.getByRole('heading', { name: '정답이에요.' })).toBeVisible();
        // Predict, then run: the real output next to the prediction.
        await main.getByRole('button', { name: '실제로 실행' }).click();
        await expect(main.getByRole('table')).toContainText('일어나기');
      }
      break;
    case 'fix-total':
      await replaceCode(page, 'console.log("김밥 2줄");\nconsole.log(3500 * 2);\n');
      if (firstSet) {
        await page.keyboard.press("ControlOrMeta+'");
        await main.getByRole('tab', { name: '콘솔' }).click();
        await expect(main.getByText('7000').last()).toBeVisible();
      }
      await submitSure();
      break;
    case 'web-heading':
      await replaceCode(page, WEB_ANSWER);
      if (firstSet) {
        await main.getByRole('button', { name: /^실행/ }).click();
        // The visible preview keeps the rendered document (sandboxed, opaque origin).
        await expect(
          page
            .frameLocator('.pi-ex-preview__mount iframe')
            .frameLocator('iframe')
            .getByText('안녕하세요'),
        ).toBeVisible();
      }
      await main.getByRole('button', { name: /확실해요|^제출/ }).click();
      break;
    default:
      throw new Error(`unexpected exercise ${exerciseId}`);
  }
  await expect(main.getByRole('heading', { name: '정답이에요.' })).toBeVisible({
    timeout: 15_000,
  });
}

/** Answers every item of the open set, in the order the engine chose. */
async function solveSet(page: Page, firstSet: boolean) {
  const progress = page.getByRole('navigation', { name: '연습 진행' });
  const total = await progress.getByRole('button').count();
  const seen = new Set<string>();
  for (let n = 0; n < total; n++) {
    const layout = page.locator('.practice-layout');
    seen.add((await layout.getAttribute('data-type')) ?? '');
    await answer(page, (await layout.getAttribute('data-exercise-id')) ?? '', firstSet);
    await expect(progress).toContainText(`${n + 1} / ${total}`);
    await page
      .getByRole('main')
      .getByRole('button', { name: /다음 문제|결과 보기/ })
      .first()
      .click();
  }
  return { total, seen };
}

test.describe('practice mode', () => {
  test('reads a lesson, solves every type in the set and passes the lesson', async ({ page }) => {
    await page.goto(LESSON);
    await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램' })).toBeVisible();
    await page.getByRole('link', { name: '연습 시작' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램 연습' })).toBeVisible();
    await expect(page).toHaveURL(/mode=practice&set=[0-9A-Z]{26}&i=1/);
    await expect(page.getByRole('link', { name: '실습' })).toHaveAttribute('aria-current', 'page');

    const { total, seen } = await solveSet(page, true);
    expect(total).toBe(8);
    expect(seen).toEqual(
      new Set(['mcq_single', 'fill_blank', 'predict_output', 'fix_bug', 'web_task']),
    );

    // 단원 완료 순간: counts, concept stage changes, pass checks, next step.
    const summary = page.getByRole('region', { name: '첫 프로그램 단원을 마쳤어요' });
    await expect(summary.getByRole('heading', { level: 2 })).toBeFocused();
    await expect(summary).toContainText('연습 8문제 · 정답 8');
    await expect(summary.getByText(/→ 연습 중/).first()).toBeVisible();
    await expect(summary.getByText('이 단원의 개념을 모두 기준만큼 연습했어요')).toBeVisible();
    await expect(summary.getByRole('link', { name: '대시보드로' })).toBeVisible();
    await expectNoA11yViolations(page);

    // The URL holds the state: a reload shows the finished set again.
    await page.reload();
    await expect(page.getByRole('region', { name: /마쳤어요/ })).toBeVisible();

    // "한 번 더 연습" builds the next set.
    const finished = new URL(page.url()).searchParams.get('set');
    await page.getByRole('button', { name: '한 번 더 연습' }).click();
    await expect(page).toHaveURL(/i=1$/);
    expect(new URL(page.url()).searchParams.get('set')).not.toBe(finished);
    await expect(page.getByRole('navigation', { name: '연습 진행' })).toContainText('0 / 8');
  });
});
