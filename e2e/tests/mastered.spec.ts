import { expect, test, type Page } from '@playwright/test';
import { DAY_MS, setServerTime } from './clock.ts';
import { expectNoA11yViolations } from './fixtures.ts';
import { solveSet as solveInUi } from './practice-helpers.ts';
import { apiFor, readLesson, solveSet, type Api } from './seed.ts';

/**
 * The `mastered` gate over three weeks (learning-engine.md#숙련-단계와-게이트, roadmap M6 테스트) on
 * its own server (playwright.config.ts `E2E_MASTERY_URL`: a fresh learner, its own clock, and the
 * fixture content plus a module 1 unit assessment). The test clock jumps day by day:
 *
 * - day 0: the lesson set in the app → `숙련`, the concept page lists what `숙달` still needs;
 * - the due date: the review set in the app (too soon after day 0 to count as a spaced review);
 * - a week later: the unit assessment (independent application + the first spaced review);
 * - a week after that: practice again (the second spaced review) → `숙달` on the concept page
 *   and in the dashboard's concept map.
 *
 * The scenarios where one condition is missing are server tests
 * (apps/server/src/http/routes/mastered-gate.test.ts).
 */

const URL = process.env['E2E_MASTERY_URL'] ?? '';
/**
 * Monday 2026-11-16 15:00 Asia/Seoul (06:00 UTC): every day of the journey is at this hour, so the
 * learner-local date is the same whether the server resolves the time zone to Asia/Seoul or UTC.
 */
const T0 = Date.UTC(2026, 10, 16, 6, 0, 0);
const LESSON = 'js-basics.start.first-program';
const ASSESSMENT = 'js-basics.start.start-review';
const CONCEPT = 'js.basics.console-log';
/** Correct options of the module 1 assessment (fixtures/content-mastery). */
const ASSESSMENT_ANSWERS: Record<string, string> = {
  [`${ASSESSMENT}.mcq-log-output`]: 'a',
  [`${ASSESSMENT}.mcq-log-return`]: 'a',
};

test.use({ baseURL: URL });

interface Detail {
  mastery: { stage: string };
  memory: { dueDate: string } | null;
}

/** Day `n` of the journey at 15:00 Seoul (whole days after T0). */
const dayOf = (date: string) => Math.round((Date.parse(`${date}T06:00:00Z`) - T0) / DAY_MS);

async function openConcept(page: Page) {
  await page.goto(`/concepts/${CONCEPT}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'console.log로 출력하기' }),
  ).toBeVisible();
}

/** The "숙달까지" gate list on the concept page. */
const gateList = (page: Page) =>
  page.getByRole('region', { name: '숙달까지' }).getByRole('listitem');

async function takeAssessment(api: Api) {
  const set = (await api.post('/practice-sets', { kind: 'assessment', lessonId: ASSESSMENT })) as {
    id: string;
    items: { id: string; exerciseId: string }[];
  };
  for (const item of set.items) {
    await api.post('/attempts', {
      practiceSetItemId: item.id,
      exerciseId: item.exerciseId,
      answer: { optionId: ASSESSMENT_ANSWERS[item.exerciseId] },
      confidence: 'sure',
      startedAt: 0,
      activeMs: 30_000,
    });
  }
  const done = (await api.get(`/practice-sets/${set.id}`)) as { status: string };
  expect(done.status).toBe('completed');
}

test.afterAll(() => {
  setServerTime(Date.now(), 'mastery');
});

test('a concept reaches 숙달 after three weeks, the gate list shrinking on the way', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const at = (day: number) => {
    setServerTime(T0 + day * DAY_MS, 'mastery');
  };
  at(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/settings/appearance');
  const token = (await page.locator('meta[name="proginone-token"]').getAttribute('content')) ?? '';
  const onboarded = await request.patch('/api/v1/learner', {
    headers: { 'x-proginone-token': token },
    data: { onboarded: true },
  });
  expect(onboarded.ok()).toBe(true);
  const api = await apiFor(page, request);
  const detail = async () => (await api.get(`/concepts/${CONCEPT}`)) as Detail;

  await test.step('day 0: the lesson set makes the concept 숙련', async () => {
    await readLesson(api, LESSON);
    await page.goto(`/learn/${LESSON}?mode=practice`);
    await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램 연습' })).toBeVisible();
    await solveInUi(page, false);
    await expect(page.getByRole('region', { name: /마쳤어요/ })).toBeVisible();

    await openConcept(page);
    await expect(page.locator('.concept-detail__stage b')).toHaveText('숙련');
    // One lesson set leaves the score short of 85 as well; later practice raises it.
    await expect(gateList(page)).toHaveText([
      /^숙련도 85점 이상\(지금 \d+점\)$/,
      '며칠 간격을 둔 복습 2번 더',
      '도움 없이 직접 써 보기 1번',
    ]);
    await expectNoA11yViolations(page);
  });

  const dueDay = dayOf((await detail()).memory?.dueDate ?? '');
  // FSRS schedules the first review a few days out: less than a week after day 0.
  expect(dueDay).toBeGreaterThan(0);
  expect(dueDay).toBeLessThan(7);

  await test.step(`day ${String(dueDay)}: the due review does not count as spaced yet`, async () => {
    at(dueDay);
    await page.goto('/review');
    await expect(page.getByRole('heading', { level: 1, name: '복습' })).toBeVisible();
    await page.getByRole('button', { name: '복습 시작' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '오늘의 복습' })).toBeVisible();
    await solveInUi(page, false);
    await expect(page.getByRole('region', { name: '오늘의 복습을 마쳤어요' })).toBeVisible();

    await openConcept(page);
    await expect(page.locator('.concept-detail__stage b')).toHaveText('숙련');
    await expect(gateList(page)).toHaveText([
      /^숙련도 85점 이상\(지금 \d+점\)$/,
      '며칠 간격을 둔 복습 2번 더',
      '도움 없이 직접 써 보기 1번',
    ]);
  });

  const assessmentDay = dueDay + 7;
  await test.step(`day ${String(assessmentDay)}: the unit assessment`, async () => {
    at(assessmentDay);
    await takeAssessment(api);
    await openConcept(page);
    await expect(page.locator('.concept-detail__stage b')).toHaveText('숙련');
    // Independent application is met; only the spaced review is still missing. The score is
    // close to 85 and may already be past it (exact points depend on the answer times the
    // browser measured), so the score line is optional.
    await expect(gateList(page).last()).toHaveText('며칠 간격을 둔 복습 1번 더');
    const items = await gateList(page).allTextContents();
    expect(items.length).toBeLessThanOrEqual(2);
    if (items.length === 2) expect(items[0]).toMatch(/^숙련도 85점 이상\(지금 \d+점\)$/);
  });

  const lastDay = assessmentDay + 7;
  await test.step(`day ${String(lastDay)}: practising again completes the gate`, async () => {
    at(lastDay);
    const set = (await api.post('/practice-sets', {
      kind: 'extra',
      // Two items, so the score clears 85 with room to spare.
      exerciseIds: [`${LESSON}.mcq-log-role`, `${LESSON}.multi-log-facts`],
    })) as { id: string };
    await solveSet(api, set.id);
    expect((await detail()).mastery.stage).toBe('mastered');

    await openConcept(page);
    await expect(page.locator('.concept-detail__stage b')).toHaveText('숙달');
    const next = page.getByRole('region', { name: '최고 단계예요' });
    await expect(next.getByText('숙달한 개념이에요. 가끔 복습하며 유지해요.')).toBeVisible();
    await expect(gateList(page)).toHaveCount(0);
    await expectNoA11yViolations(page);

    await page.goto('/');
    const map = page.getByRole('region', { name: '개념 지도' });
    await expect(map.getByRole('img', { name: /^숙련 단계: 숙달/ })).toHaveCount(1);
  });
  expect(lastDay).toBeLessThanOrEqual(21);
});
