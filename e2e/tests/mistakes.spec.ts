import { expect, test } from '@playwright/test';
import { shiftServerClock } from './clock.ts';
import { expectNoA11yViolations } from './fixtures.ts';
import { apiFor } from './seed.ts';

/**
 * Review hub (ui-ux.md 복습 화면, FR-DASH-04): the mistake notes with the note detail and
 * "다시 풀기", the weakness section and mastery changes. A confident wrong answer is recorded
 * through the API first, so the flow does not depend on what earlier specs left behind.
 */

const EXERCISE = 'js-basics.start.first-program.mcq-log-role';
const PROMPT = /console\.log\("완료"\);를 실행하면/;

test.afterEach(() => {
  shiftServerClock(0);
});

test('mistake notes: detail, retry and resolution', async ({ page, request }) => {
  const api = await apiFor(page, request);
  const set = (await api.post('/practice-sets', { kind: 'extra', exerciseIds: [EXERCISE] })) as {
    items: { id: string }[];
  };
  const [item] = set.items;
  if (!item) throw new Error('empty extra set');
  await api.post('/attempts', {
    practiceSetItemId: item.id,
    exerciseId: EXERCISE,
    answer: { optionId: 'b' },
    confidence: 'sure',
    startedAt: 0,
    activeMs: 20_000,
  });

  // The list: the note is open, marked as a confident wrong answer, with its misconception.
  await page.goto('/review');
  const sections = page.getByRole('navigation', { name: '복습 화면' });
  await sections.getByRole('link', { name: '오답 노트' }).click();
  await expect(page).toHaveURL(/\/review\/mistakes$/);
  await page.getByRole('checkbox', { name: '아직 못 맞힌 것만' }).click();
  await expect(page).toHaveURL(/open=true/);
  const note = page
    .getByRole('list', { name: '오답 목록' })
    .getByRole('listitem')
    .filter({ hasText: PROMPT });
  await expect(note).toHaveCount(1);
  await expect(note.getByRole('heading')).toContainText('아직 못 맞힌 오답');
  await expect(note.getByText('확실했어요')).toBeVisible();
  await expect(note.getByText('오개념: 출력을 반환으로 착각함')).toBeVisible();
  await expectNoA11yViolations(page);

  // The detail: my answer and the explanation, the reference answer still locked.
  await note.getByRole('link', { name: '풀이 다시 보기' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /객관식 · L1/ })).toBeVisible();
  await expect(page.getByText('아직 못 맞힘')).toBeVisible();
  await expect(page.getByText(/다음 줄에서 다시 쓸 수 있다/).first()).toBeVisible();
  await expect(page.getByText(/console\.log는 값을 콘솔에 보여 줄 뿐/)).toBeVisible();
  await expect(page.getByText(/정답은 다시 풀면서 확인해요/)).toBeVisible();
  await expectNoA11yViolations(page);

  // 다시 풀기: the same exercise in its own set, answered right this time.
  await page.getByRole('button', { name: '다시 풀기' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '다시 풀기' })).toBeVisible();
  await expect(page).toHaveURL(/\/review\/session\/[0-9A-Z]{26}\?i=1/);
  const main = page.getByRole('main');
  await main.locator('label', { hasText: '글자가 보인다' }).click();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(main.getByRole('heading', { name: '정답이에요.' })).toBeVisible();
  await main
    .getByRole('button', { name: /다음 문제|결과 보기/ })
    .first()
    .click();
  const summary = page.getByRole('region', { name: /마쳤어요/ });
  await expect(summary).toBeVisible();
  await summary.getByRole('link', { name: '오답 노트로' }).click();

  // Resolved: gone from "아직 못 맞힌 것만", marked "다시 맞힘" in the full list.
  await expect(page).toHaveURL(/\/review\/mistakes$/);
  const resolved = page
    .getByRole('list', { name: '오답 목록' })
    .getByRole('listitem')
    .filter({ hasText: PROMPT });
  await expect(resolved.getByRole('heading')).toContainText('다시 맞힌 오답');
  await expect(resolved.getByText(/다시 맞힘/)).toBeVisible();
  await page.getByRole('checkbox', { name: '아직 못 맞힌 것만' }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: PROMPT }).filter({ hasText: '아직 못 맞힌' }),
  ).toHaveCount(0);
});

test('weakness and mastery change sections', async ({ page }) => {
  await page.goto('/review/weak');
  const sections = page.getByRole('navigation', { name: '복습 화면' });
  await expect(sections.getByRole('link', { name: '약점 집중' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    page.getByRole('heading', { name: /연습할 약점 개념을 골라요|아직 약점이 없어요/ }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  await sections.getByRole('link', { name: '숙련도 변화' }).click();
  await expect(page).toHaveURL(/\/review\/progress$/);
  // Whether stages have moved depends on what earlier specs practised on this server.
  await expect(
    page.getByRole('heading', { name: /주별 숙련 단계 변화|아직 숙련 단계가 바뀐 개념이 없어요/ }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
  const toTable = page.getByRole('button', { name: '표로 보기' });
  if ((await toTable.count()) > 0) {
    await toTable.click();
    await expect(page.getByRole('rowheader', { name: '이번 주' })).toBeVisible();
    await expectNoA11yViolations(page);
  }
});
