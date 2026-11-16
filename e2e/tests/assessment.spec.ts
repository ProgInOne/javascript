import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './fixtures.ts';
import { apiFor } from './seed.ts';

/**
 * Unit assessment context (learning-engine.md#단원-평가-세트) on the production build: the rules
 * screen, hints and the tutor locked (in the UI and by the server), one submission per item, and
 * explanations revealed only after the end.
 */

const REVIEW = 'js-basics.values.values-review';
/** Option text to pick per item (options are shuffled per item). */
const ANSWERS: Record<string, string> = {
  [`${REVIEW}.mcq-let`]: 'let',
  [`${REVIEW}.mcq-const`]: 'TypeError가 난다',
  [`${REVIEW}.mcq-reassign`]: '1', // deliberately wrong (the right answer is 2)
};

test('assessment: hints locked, explanations revealed only after the end', async ({
  page,
  request,
}) => {
  await page.goto(`/learn/${REVIEW}`);
  await page.getByRole('link', { name: '단원 평가 보기' }).click();

  // Start screen with the rules.
  await expect(page.getByRole('heading', { level: 1, name: /값과 변수 단원 평가/ })).toBeVisible();
  const rules = page.getByRole('list', { name: '평가 규칙' });
  await expect(rules).toContainText('힌트, AI 튜터, 정답 보기를 쓸 수 없어요.');
  await expect(rules).toContainText('정답과 해설은 평가가 끝나면 한꺼번에 보여 줘요.');
  await expect(page.getByText('3문항')).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: '평가 시작' }).click();
  await expect(page).toHaveURL(/mode=practice&set=[0-9A-Z]{26}&i=1/);
  const setId = new URL(page.url()).searchParams.get('set') ?? '';

  // In progress: the hint ladder and the tutor are locked.
  const hint = page.getByRole('button', { name: /힌트 1\/3 보기/ });
  await expect(hint).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByText('평가가 끝나면 열려요').first()).toBeVisible();
  await hint.click({ force: true });
  await expect(page.getByText('평가 힌트 1단계예요.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /튜터/ })).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('ControlOrMeta+j');
  await expect(page.locator('.tutor-drawer')).toHaveCount(0);
  // The locked shortcuts say why nothing opened (D-067).
  await expect(page.getByText(/단원 평가 중에는 튜터와 힌트를 쓸 수 없어요/).first()).toBeVisible();
  await page.keyboard.press('ControlOrMeta+.');
  await expect(page.getByText('평가 힌트 1단계예요.')).toHaveCount(0);
  await expectNoA11yViolations(page);

  // The server enforces the lock too (no context needed to be refused).
  const api = await apiFor(page, request);
  const set = (await api.get(`/practice-sets/${setId}`)) as {
    items: { id: string; exerciseId: string }[];
  };
  const first = set.items[0];
  if (!first) throw new Error('empty assessment');
  const token = (await page.locator('meta[name="proginone-token"]').getAttribute('content')) ?? '';
  for (const body of [{ practiceSetItemId: first.id }, {}]) {
    const res = await request.post(`/api/v1/exercises/${first.exerciseId}/hints`, {
      headers: { 'x-proginone-token': token },
      data: body,
    });
    expect(res.status()).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'EXERCISE_LOCKED_IN_ASSESSMENT',
    );
  }

  // Answer every item once; nothing about the result shows until the end.
  for (let n = 0; n < set.items.length; n++) {
    const exerciseId =
      (await page.locator('[data-exercise-id]').getAttribute('data-exercise-id')) ?? '';
    const option = page.getByRole('radio', { name: ANSWERS[exerciseId] ?? '', exact: true });
    // The radio input is visually hidden; its label is the click target.
    await page.locator('label.pi-ex-choice').filter({ has: option }).click();
    await page.getByRole('button', { name: '확실해요' }).click();
    if (n < set.items.length - 1) {
      await expect(page.getByText(/제출했어요\. 정답과 해설은 평가가 끝나면/)).toBeVisible();
      await expect(page.getByText(/평가 해설:/)).toHaveCount(0);
      await expect(page.getByRole('heading', { name: /정답이에요|정답이 아니에요/ })).toHaveCount(
        0,
      );
      await expect(page.getByRole('button', { name: '다시 풀기' })).toHaveCount(0);
      await page.getByRole('button', { name: '다음 문제' }).click();
    }
  }

  // End screen: score, every explanation, missed concept → weakness set.
  await expect(page.getByRole('heading', { level: 1, name: '단원 평가를 마쳤어요' })).toBeVisible();
  await expect(page.getByText('3문항 중 2문항 정답')).toBeVisible();
  await expect(page.getByText(/평가 해설: 다시 대입한 값/)).toBeVisible();
  await expect(page.getByText(/평가 해설: `?let`? 변수는/)).toHaveCount(1);
  await expect(page.getByRole('button', { name: '약점 집중 시작' })).toBeVisible();
  await expect(page.getByRole('button', { name: /튜터/ })).not.toHaveAttribute('aria-disabled');
  await expectNoA11yViolations(page);

  // After the end the lock is lifted.
  const after = await request.post(`/api/v1/exercises/${first.exerciseId}/hints`, {
    headers: { 'x-proginone-token': token },
    data: {},
  });
  expect(after.status()).toBe(200);
});
