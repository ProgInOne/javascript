import { expect, type Page } from '@playwright/test';

/**
 * Answers for the E2E fixture lesson's exercises (e2e/fixtures/content), shared by the practice
 * and review flows. Item order comes from the engine (seeded per set), so items are answered by
 * exercise id.
 */

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
        await expect(main.getByRole('group').getByText('출력을 반환으로 착각함')).toBeVisible();
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
    case 'multi-log-facts':
      if (firstSet) {
        // Partial answer first (one of two correct options), then complete it.
        await main.locator('label', { hasText: '한 줄이 생긴다' }).click();
        await submitSure();
        await expect(main.getByRole('heading', { name: '부분 정답이에요.' })).toBeVisible();
        await expect(main.getByText('빠뜨린 정답이 있습니다.')).toBeVisible();
        await main.getByRole('button', { name: '다시 풀기' }).click();
      } else {
        await main.locator('label', { hasText: '한 줄이 생긴다' }).click();
      }
      await main.locator('label', { hasText: '값을 콘솔에 보여 준다' }).click();
      await submitSure();
      break;
    case 'tf-order':
      await main.locator('label', { hasText: '거짓' }).click();
      await main.locator('label', { hasText: '적힌 순서대로' }).click();
      await submitSure();
      break;
    case 'parsons-morning': {
      const block = (text: string) =>
        main.getByRole('region', { name: '코드 조각' }).getByRole('button', { name: text });
      if (firstSet) {
        // Keyboard only: add blocks in the wrong order, then move the line up with Alt+↑.
        await block('console.log("세수하기");').focus();
        await page.keyboard.press('Enter');
        await block('console.log("일어나기");').focus();
        await page.keyboard.press('Enter');
        const answer = main.getByRole('listbox', { name: '내 답안' });
        await answer.focus();
        await page.keyboard.press('End');
        await page.keyboard.press('Alt+ArrowUp');
        await expect(main.getByText('1번째 줄로 옮겼어요.')).toBeVisible();
      } else {
        await block('console.log("일어나기");').click();
        await block('console.log("세수하기");').click();
      }
      await block('console.log("아침 먹기");').click();
      await submitSure();
      break;
    }
    case 'find-bug-quoted':
      if (firstSet) {
        // Right line, wrong cause first: partial credit, the line is marked, then retry.
        await main.locator('label', { hasText: 'console.log("price");' }).click();
        await main.locator('label', { hasText: '변수를 출력할 수 없다' }).click();
        await submitSure();
        await expect(main.getByRole('heading', { name: '부분 정답이에요.' })).toBeVisible();
        await expect(main.getByText('줄은 맞았지만 원인 설명이 맞지 않습니다.')).toBeVisible();
        await main.getByRole('button', { name: '다시 풀기' }).click();
      } else {
        await main.locator('label', { hasText: 'console.log("price");' }).click();
      }
      await main.locator('label', { hasText: '따옴표로 감싸서' }).click();
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
export async function solveSet(page: Page, firstSet: boolean) {
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
