import { expect, test, type Page } from '@playwright/test';
import { DAY_MS, setServerTime } from './clock.ts';
import { expectNoA11yViolations } from './fixtures.ts';
import { answer, solveSet } from './practice-helpers.ts';
import { apiFor, type Api } from './seed.ts';

/**
 * The whole learning journey (roadmap M7 "전체 학습 흐름 E2E", PRD MVP 완료 정의 4) for one learner
 * on a server of its own (playwright.config.ts `E2E_FULL_JOURNEY_URL`: a fresh learner, its own
 * clock, and the fixture content plus a module 1 unit assessment):
 *
 * onboarding → reading the first lesson → its practice set → the module's unit assessment →
 * (the day the first review is due) the review queue and a mistake note → the daily goal →
 * a backup, a change, and the restore that brings the learner back.
 *
 * Everything goes through the UI except reading the review queue to find the due day. The server
 * clock is pinned at 15:00 Asia/Seoul so the learner-local date is the same in every time zone
 * the server may resolve (see journey.spec.ts).
 */

const URL = process.env['E2E_FULL_JOURNEY_URL'] ?? '';
/** Monday 2026-11-16 15:00 Asia/Seoul (06:00 UTC). */
const T0 = Date.UTC(2026, 10, 16, 6, 0, 0);
const LESSON = 'js-basics.start.first-program';
const ASSESSMENT = 'js-basics.start.start-review';
/** Correct option (its accessible name) per assessment item (fixtures/content-mastery). */
const ASSESSMENT_ANSWERS: Record<string, string> = {
  [`${ASSESSMENT}.mcq-log-output`]: '2',
  [`${ASSESSMENT}.mcq-log-return`]: 'undefined',
};
/** The exercise answered wrong with confidence in the first practice set (practice-helpers). */
const MISTAKE_PROMPT = /console\.log\("완료"\);를 실행하면/;

test.use({ baseURL: URL });

test.afterAll(() => {
  setServerTime(Date.now(), 'full');
});

async function expectHeading(page: Page, name: string | RegExp) {
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** The first day the review queue has something due (FSRS: a few days after the practice). */
async function firstDueDay(api: Api): Promise<number> {
  for (let day = 1; day <= 10; day++) {
    setServerTime(T0 + day * DAY_MS, 'full');
    const queue = (await api.get('/review-queue')) as { due: unknown[] };
    if (queue.due.length > 0) return day;
  }
  throw new Error('nothing became due within 10 days');
}

test('one learner: onboarding → lesson → practice → assessment → review → goal → restore', async ({
  page,
  request,
}) => {
  // Two sets with real sandbox runs, an assessment, a review set and a restore.
  test.setTimeout(300_000);
  setServerTime(T0, 'full');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await test.step('onboarding: goal, experience, then the dashboard', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByRole('button', { name: '시작하기' }).click();
    await expectHeading(page, '학습 목표를 정해요');
    await page.getByRole('radio', { name: '30분' }).check();
    await page.getByRole('radio', { name: '5일' }).check();
    await page.getByRole('button', { name: '다음' }).click();
    await expectHeading(page, '코딩은 얼마나 해 보셨나요?');
    await page.getByRole('radio', { name: /처음이에요/ }).check();
    await page.getByRole('button', { name: '다음' }).click();
    await expectHeading(page, 'AI 튜터 연결 (선택)');
    await page.getByRole('button', { name: /^(나중에 할게요|다음)$/ }).click();
    await expectHeading(page, '시작할 준비가 됐어요');
    await page.getByRole('button', { name: '대시보드로' }).click();
    await expectHeading(page, /대시보드/);
    const plan = page.getByRole('region', { name: '오늘의 학습' });
    await expect(plan.getByText('새 단원 · 첫 프로그램')).toBeVisible();
  });

  await test.step('reading: the inline check, then the lesson read to the end', async () => {
    await page.getByRole('region', { name: '오늘의 학습' }).getByRole('link').first().click();
    await expectHeading(page, '첫 프로그램');
    const check = page.locator('.lesson-inline-check').first();
    await check.locator('label', { hasText: '맨 위의 문장' }).click();
    await check.getByRole('button', { name: '애매해요' }).click();
    await expect(check.getByRole('heading', { name: '정답이에요.' })).toBeVisible();
    // Scrolling to the end saves the reading progress (debounced, useReadingProgress).
    const read = page.waitForRequest(
      (req) =>
        req.method() === 'POST' &&
        req.url().endsWith(`/lessons/${LESSON}/progress`) &&
        (req.postDataJSON() as { readProgress?: number }).readProgress === 1,
    );
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await read;
    await expectNoA11yViolations(page);
  });

  await test.step('practice: every item of the lesson set, mistakes and hints included', async () => {
    await page.getByRole('link', { name: '연습 시작' }).click();
    await expectHeading(page, '첫 프로그램 연습');
    const { total } = await solveSet(page, true);
    expect(total).toBe(12);
    const summary = page.getByRole('region', { name: '첫 프로그램 단원을 마쳤어요' });
    await expect(summary).toContainText('연습 12문제 · 정답 12');
    await expectNoA11yViolations(page);
    await summary.getByRole('link', { name: '다음 단원: 시작하기 단원 평가' }).click();
  });

  await test.step('unit assessment: rules, one answer per item, the result', async () => {
    await expectHeading(page, '시작하기 단원 평가');
    await page.getByRole('link', { name: '단원 평가 보기' }).click();
    await expect(page.getByRole('list', { name: '평가 규칙' })).toBeVisible();
    await page.getByRole('button', { name: '평가 시작' }).click();
    await expect(page).toHaveURL(/mode=practice&set=[0-9A-Z]{26}&i=1/);
    const item = page.locator('[data-exercise-id]');
    let previous = '';
    for (let n = 0; n < 2; n++) {
      // The next item has replaced the previous one before its options are read.
      if (previous) await expect(item).not.toHaveAttribute('data-exercise-id', previous);
      const exerciseId = (await item.getAttribute('data-exercise-id')) ?? '';
      previous = exerciseId;
      const option = page.getByRole('radio', {
        name: ASSESSMENT_ANSWERS[exerciseId] ?? '',
        exact: true,
      });
      await page.locator('label.pi-ex-choice').filter({ has: option }).click();
      await page.getByRole('button', { name: '확실해요' }).click();
      if (n === 0) await page.getByRole('button', { name: '다음 문제' }).click();
    }
    await expectHeading(page, '단원 평가를 통과했어요');
    await expect(page.getByText('2문항 중 2문항 정답')).toBeVisible();
    await expectNoA11yViolations(page);
  });

  const api = await apiFor(page, request);
  const dueDay = await firstDueDay(api);
  test.info().annotations.push({ type: 'first review due on day', description: String(dueDay) });

  await test.step(`day ${String(dueDay)}: the review queue from the dashboard`, async () => {
    await page.goto('/');
    await expectHeading(page, /대시보드/);
    const reviewCard = page.getByRole('region', { name: '오늘의 복습' });
    await expect(reviewCard.getByText(/^\d+개/)).toBeVisible();
    await page
      .getByRole('navigation', { name: '주 메뉴' })
      .getByRole('link', { name: /^복습/ })
      .click();
    await expectHeading(page, '복습');
    await expect(page.getByRole('heading', { name: /오늘 복습할 개념 \d+개/ })).toBeVisible();
    await page.getByRole('button', { name: '복습 시작' }).click();
    await expectHeading(page, '오늘의 복습');
    await solveSet(page, false);
    const summary = page.getByRole('region', { name: '오늘의 복습을 마쳤어요' });
    await expect(summary).toBeVisible();
    await expectNoA11yViolations(page);
  });

  await test.step('mistake note: the confident wrong answer, retried from the note', async () => {
    await page.goto('/review/mistakes');
    const note = page
      .getByRole('list', { name: '오답 목록' })
      .getByRole('listitem')
      .filter({ hasText: MISTAKE_PROMPT });
    await expect(note).toHaveCount(1);
    await expect(note.getByText('확실했어요')).toBeVisible();
    await expect(note.getByText('오개념: 출력을 반환으로 착각함')).toBeVisible();
    await expectNoA11yViolations(page);
    await note.getByRole('link', { name: '풀이 다시 보기' }).click();
    // The list has a "다시 풀기" per note: wait for the detail page before using its button.
    await expect(page).toHaveURL(/\/review\/mistakes\/[^/?]+$/);
    await page
      .getByRole('article', { name: /./ })
      .getByRole('button', { name: '다시 풀기' })
      .click();
    await expectHeading(page, '다시 풀기');
    const exerciseId =
      (await page.locator('.practice-layout').getAttribute('data-exercise-id')) ?? '';
    await answer(page, exerciseId, false);
    await page
      .getByRole('main')
      .getByRole('button', { name: /다음 문제|결과 보기/ })
      .first()
      .click();
    const summary = page.getByRole('region', { name: /마쳤어요/ });
    await summary.getByRole('link', { name: '오답 노트로' }).click();
    await expect(
      page
        .getByRole('list', { name: '오답 목록' })
        .getByRole('listitem')
        .filter({ hasText: MISTAKE_PROMPT })
        .getByRole('heading'),
    ).toContainText('다시 맞힌 오답');
  });

  const goal = async (minutes: string) => {
    await page.goto('/settings/goals');
    await expectHeading(page, '학습 목표');
    await page.getByRole('radio', { name: minutes }).check();
    await page.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText('목표를 저장했어요').first()).toBeVisible();
  };

  await test.step('goal: a longer daily goal, kept across a reload', async () => {
    await goal('45분');
    await expectNoA11yViolations(page);
    await page.reload();
    await expect(page.getByRole('radio', { name: '45분' })).toBeChecked();
    await expect(page.getByRole('radio', { name: '5일' })).toBeChecked();
  });

  await test.step('backup → change → restore brings the learner back', async () => {
    await page.goto('/settings/data');
    const list = page.getByRole('list', { name: '백업 목록' });
    const manual = list.getByRole('listitem').filter({ hasText: '수동' });
    await expect(list.getByRole('listitem').first()).toBeVisible();
    const before = await manual.count();
    await page.getByRole('button', { name: '지금 백업' }).click();
    await expect(page.getByText('백업을 만들었어요').first()).toBeVisible();
    await expect(manual).toHaveCount(before + 1);
    await expectNoA11yViolations(page);

    await goal('60분');

    await page.goto('/settings/data');
    await manual.first().getByRole('button', { name: /복원/ }).click();
    const dialog = page.getByRole('dialog', { name: '이 백업으로 복원할까요?' });
    await expect(dialog.getByText('파일을 확인했어요', { exact: false })).toBeVisible();
    await expectNoA11yViolations(page);
    await dialog.getByRole('button', { name: '복원' }).click();
    await expect(page.getByText('복원했어요').first()).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(list.getByText('복원 전').first()).toBeVisible();

    // The goal is the one from before the backup, and the learning history is still there.
    await page.goto('/settings/goals');
    await expect(page.getByRole('radio', { name: '45분' })).toBeChecked();
    await page.goto('/');
    await expectHeading(page, /대시보드/);
    await expect(page).toHaveURL(/\/$/); // onboarding stays done
    await expect(
      page.getByRole('region', { name: '과정 진도' }).getByRole('progressbar'),
    ).not.toHaveAttribute('aria-valuenow', '0');
    await page.goto('/review/mistakes');
    await expect(
      page.getByRole('list', { name: '오답 목록' }).getByRole('listitem').filter({
        hasText: MISTAKE_PROMPT,
      }),
    ).toHaveCount(1);
  });
});
