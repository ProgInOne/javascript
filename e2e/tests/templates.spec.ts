import { expect, test, type Page } from '@playwright/test';
import { DAY_MS, setServerTime } from './clock.ts';
import { expectNoA11yViolations } from './fixtures.ts';
import { apiFor, readLesson, type Api } from './seed.ts';

/**
 * Parametric template variants in the app (FR-EX-08, FR-EX-14, flow 5 "더 풀고 싶을 때"; D-056,
 * D-057) on their own server (playwright.config.ts `E2E_TEMPLATES_URL`: the fixture content plus
 * a template in the variables unit, fixtures/content-templates):
 *
 * - the lesson set serves a variant of the template like any exercise, graded by its
 *   execution-derived answer key;
 * - "한 번 더 연습" serves a new variant, and so does the review set when the concept is due;
 * - "문제 신고" works on a variant.
 */

const URL = process.env['E2E_TEMPLATES_URL'] ?? '';
const LESSON = 'js-basics.values.variables';
const TEMPLATE = `${LESSON}.t.predict-reassign`;
const CONCEPT = 'js.basics.reassign';
/** Monday 2026-11-16 15:00 Asia/Seoul. */
const T0 = Date.UTC(2026, 10, 16, 6, 0, 0);

test.use({ baseURL: URL });

/** The variant's answer from its code (`let n = a; n = n + b; console.log(n);`). */
async function variantAnswer(api: Api, exerciseId: string): Promise<string> {
  const view = (await api.get(`/exercises/${encodeURIComponent(exerciseId)}`)) as {
    publicSpec: { code: string };
  };
  expect(view.publicSpec).not.toHaveProperty('expected');
  const match = /let \w+ = (\d+);\n\w+ = \w+ \+ (\d+);/.exec(view.publicSpec.code);
  if (!match) throw new Error(`unexpected variant code: ${view.publicSpec.code}`);
  return String(Number(match[1]) + Number(match[2]));
}

/**
 * Answers every item of the open set correctly; returns the template variants it served.
 * `beforeVariant` runs on a variant's screen before it is answered.
 */
async function solve(
  page: Page,
  api: Api,
  beforeVariant: (exerciseId: string) => Promise<void> = () => Promise.resolve(),
): Promise<string[]> {
  const main = page.getByRole('main');
  const progress = page.getByRole('navigation', { name: '연습 진행' });
  const total = await progress.getByRole('button').count();
  const variants: string[] = [];
  for (let n = 0; n < total; n++) {
    const exerciseId =
      (await page.locator('.practice-layout').getAttribute('data-exercise-id')) ?? '';
    if (exerciseId.startsWith(`${TEMPLATE}@`)) {
      variants.push(exerciseId);
      await beforeVariant(exerciseId);
      // Rendered like any predict_output exercise: the code and the prediction box.
      await expect(main.getByText(/console\.log\(/).first()).toBeVisible();
      await main.getByLabel('예상 출력').fill(await variantAnswer(api, exerciseId));
    } else if (exerciseId === `${LESSON}.mcq-let`) {
      await main.locator('label', { hasText: 'let' }).click();
    } else if (exerciseId === `${LESSON}.mcq-const`) {
      await main.locator('label', { hasText: '오류가 난다' }).click();
    } else if (exerciseId === `${LESSON}.mcq-reassign`) {
      await main
        .locator('label')
        .filter({ has: page.getByRole('radio', { name: '2', exact: true }) })
        .click();
    } else {
      throw new Error(`unexpected exercise ${exerciseId}`);
    }
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(main.getByRole('heading', { name: '정답이에요.' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(progress).toContainText(`${n + 1} / ${total}`);
    if (n < total - 1) {
      await main
        .getByRole('button', { name: /다음 문제/ })
        .first()
        .click();
    }
  }
  return variants;
}

test.afterAll(() => {
  setServerTime(Date.now(), 'templates');
});

test('lesson, "한 번 더 연습" and review sets serve fresh template variants', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  setServerTime(T0, 'templates');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/settings/appearance');
  const token = (await page.locator('meta[name="proginone-token"]').getAttribute('content')) ?? '';
  expect(
    (
      await request.patch('/api/v1/learner', {
        headers: { 'x-proginone-token': token },
        data: { onboarded: true },
      })
    ).ok(),
  ).toBe(true);
  const api = await apiFor(page, request);
  await readLesson(api, LESSON);
  const served: string[] = [];

  await test.step('the lesson set serves a variant graded like any exercise', async () => {
    await page.goto(`/learn/${LESSON}?mode=practice`);
    await expect(page.getByRole('heading', { level: 1, name: /연습$/ })).toBeVisible();
    const variants = await solve(page, api);
    expect(variants).toHaveLength(1);
    served.push(...variants);
    await page.getByRole('main').getByRole('button', { name: '결과 보기' }).click();
  });

  await test.step('"한 번 더 연습" serves a new variant', async () => {
    await page.getByRole('button', { name: '한 번 더 연습' }).click();
    await expect(page.locator('.practice-layout')).toBeVisible();
    const variants = await solve(page, api);
    expect(variants).toHaveLength(1);
    expect(served).not.toContain(variants[0]);
    served.push(...variants);
  });

  await test.step('the due review serves yet another variant; reporting it works', async () => {
    const detail = (await api.get(`/concepts/${CONCEPT}`)) as { memory: { dueDate: string } };
    const due = Date.parse(`${detail.memory.dueDate}T06:00:00Z`);
    setServerTime(Math.max(due, T0 + DAY_MS), 'templates');
    await page.goto('/review');
    await page.getByRole('button', { name: '복습 시작' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '오늘의 복습' })).toBeVisible();

    const variants = await solve(page, api, async () => {
      // "문제 신고" on the variant itself (the template stops being served).
      await page.getByRole('button', { name: '문제 신고' }).click();
      await page.getByRole('dialog').getByRole('button', { name: '신고하기' }).click();
      await expect(
        page.getByText('신고해 주셔서 고마워요. 이 문제는 다시 나오지 않아요.', { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: '신고함' })).toBeDisabled();
    });
    expect(variants).toHaveLength(1);
    expect(served).not.toContain(variants[0]);
    await expectNoA11yViolations(page);
  });
});
