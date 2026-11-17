import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './fixtures.ts';

import { solveSet } from './practice-helpers.ts';
import { apiFor } from './seed.ts';

/**
 * The practice flow on the production build with the fixture lesson's exercises (one per type),
 * graded by the real server and, for code, run in the real sandbox.
 */

const LESSON = '/learn/js-basics.start.first-program';

test.describe('practice mode', () => {
  test('reads a lesson, solves every type in the set and passes the lesson', async ({
    page,
    request,
    browserName,
  }) => {
    // Twelve items with real sandbox runs take ~25 s in Chromium; other engines are slower.
    test.slow(browserName !== 'chromium');
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
    await expect(
      summary.getByText('이 단원의 개념마다 이번 연습에서 충분히 맞혔어요'),
    ).toBeVisible();
    await expect(summary.getByRole('link', { name: '다음 단원: 변수 선언' })).toBeVisible();
    // Firefox with Fission: axe crashes the page while walking the runner's frames, and
    // Playwright does not finish a reload of a page that had out-of-process frames
    // (docs/reviews/2026-11-16-m7-compatibility.md). NFR-13 is checked in Chromium.
    const fission = browserName === 'firefox';
    if (!fission) await expectNoA11yViolations(page);

    // The URL holds the state: a reload shows the finished set again.
    if (!fission) await page.reload();
    await expect(page.getByRole('region', { name: /마쳤어요/ })).toBeVisible();

    // "한 번 더 연습" builds the next set.
    const finished = new URL(page.url()).searchParams.get('set');
    await page.getByRole('button', { name: '한 번 더 연습' }).click();
    await expect(page).toHaveURL(/i=1$/);
    expect(new URL(page.url()).searchParams.get('set')).not.toBe(finished);
    await expect(page.getByRole('navigation', { name: '연습 진행' })).toContainText('0 / 12');

    // FR-CODE-06 / NFR-04: an edit in a code item reaches the server and comes back after a
    // reload even without this browser's copy (another browser, cleared site data).
    const api = await apiFor(page, request);
    const setId = new URL(page.url()).searchParams.get('set') ?? '';
    const next = (await api.get(`/practice-sets/${setId}`)) as {
      items: { exerciseId: string }[];
    };
    const fix = next.items.findIndex((i) => i.exerciseId.endsWith('.fix-total'));
    expect(fix).toBeGreaterThanOrEqual(0);
    await page.goto(`${LESSON}?mode=practice&set=${setId}&i=${String(fix + 1)}`);
    const editor = page.locator('.cm-content').first();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('// 고치는 중\nconsole.log("김밥 2줄");\n');
    await expect(page.getByRole('main').getByText('저장됨', { exact: true })).toBeVisible();
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();
    await expect(page.locator('.cm-content').first()).toContainText('// 고치는 중');
  });

  test('resizes and folds the code panels, remembers them, and keeps ⌘. working in the editor', async ({
    page,
    request,
  }) => {
    // The set "한 번 더 연습" left open by the previous test.
    await page.goto(`${LESSON}?mode=practice`);
    await expect(page).toHaveURL(/set=[0-9A-Z]{26}/);
    const setId = new URL(page.url()).searchParams.get('set') ?? '';
    const api = await apiFor(page, request);
    const set = (await api.get(`/practice-sets/${setId}`)) as { items: { exerciseId: string }[] };
    const fix = set.items.findIndex((i) => i.exerciseId.endsWith('.fix-total'));
    await page.goto(`${LESSON}?mode=practice&set=${setId}&i=${String(fix + 1)}`);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: /문제 \d+/ })).toBeVisible();

    // FR-UI-01: the problem | work split moves with the keyboard and the pointer (1280px wide).
    const split = main.getByRole('separator', { name: '문제 패널 폭' });
    await expect(split).toHaveAttribute('aria-valuenow', '40');
    const layout = page.locator('.practice-layout--split');
    const problem = page.locator('.practice-layout__problem');
    const share = async () => {
      const [a, b] = await Promise.all([problem.boundingBox(), layout.boundingBox()]);
      return (a?.width ?? 0) / (b?.width ?? 1);
    };
    expect(await share()).toBeCloseTo(0.4, 1);
    await split.focus();
    await page.keyboard.press('End');
    await expect(split).toHaveAttribute('aria-valuenow', '55');
    expect(await share()).toBeCloseTo(0.55, 1);
    const box = await split.boundingBox();
    if (!box) throw new Error('separator not laid out');
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 150, box.y + 40, { steps: 5 });
    await page.mouse.up();
    const dragged = Number(await split.getAttribute('aria-valuenow'));
    expect(dragged).toBeLessThan(50);
    expect(dragged).toBeGreaterThan(30);

    // The editor height handle and the folded results.
    const editorHandle = main.getByRole('separator', { name: '에디터 높이' });
    const host = page.locator('.pi-ex-editor__host').first();
    const before = (await host.boundingBox())?.height ?? 0;
    await editorHandle.focus();
    for (let n = 0; n < 5; n++) await page.keyboard.press('ArrowDown');
    await expect
      .poll(async () => (await host.boundingBox())?.height ?? 0)
      .toBeGreaterThan(before + 40);
    await main.getByRole('button', { name: '결과 접기' }).click();
    await expect(main.getByRole('tabpanel')).toBeHidden();
    await expect(editorHandle).toBeHidden();

    // All of it comes back after a reload.
    await page.reload();
    await expect(main.getByRole('separator', { name: '문제 패널 폭' })).toHaveAttribute(
      'aria-valuenow',
      String(dragged),
    );
    await expect(main.getByRole('button', { name: '결과 펼치기' })).toBeVisible();

    // FR-UI-02: modifier shortcuts work while the editor has focus; running opens the results.
    await page.locator('.cm-content').first().click();
    await page.keyboard.press('ControlOrMeta+.');
    await expect(main.getByRole('button', { name: /힌트 2\/\d 보기/ })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+'");
    await expect(main.getByRole('button', { name: '결과 접기' })).toBeVisible();
    await expect(main.getByRole('tabpanel')).toBeVisible();
  });
});
