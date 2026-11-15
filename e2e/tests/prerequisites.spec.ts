import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './fixtures.ts';
import { apiFor, readLesson } from './seed.ts';

/**
 * FR-CUR-05 / FR-CUR-02: opening a lesson whose required prerequisite is weak shows a
 * non-blocking warning with ways back, and the 선수 개념 section shows the learner's mastery.
 * Needs a learner who has not studied the first lesson, so it runs on the 설정 > 데이터 server
 * (playwright.config.ts `E2E_DATA_SETTINGS_URL`) and starts with a reset.
 */

const URL = process.env['E2E_DATA_SETTINGS_URL'] ?? '';
const FIRST = 'js-basics.start.first-program';
const SECOND = '/learn/js-basics.values.variables';
const WARNING = '먼저 ‘문장과 실행 순서’부터 확인하면 더 쉬워요';

test.use({ baseURL: URL });

test('a weak prerequisite warns without blocking, with links back and weakness practice', async ({
  page,
  request,
}) => {
  const api = await apiFor(page, request);
  await api.post('/data/reset', { confirm: '초기화' });
  const token = (await page.locator('meta[name="proginone-token"]').getAttribute('content')) ?? '';
  const onboarded = await request.patch(`${URL}/api/v1/learner`, {
    headers: { 'x-proginone-token': token },
    data: { onboarded: true },
  });
  expect(onboarded.ok()).toBe(true);

  // Never studied: the warning, the lesson right below it, no weakness practice yet.
  await page.goto(SECOND);
  const warning = page.getByRole('region', { name: WARNING });
  await expect(warning).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: '변수 선언' })).toBeVisible();
  await expect(warning.getByText('미학습')).toBeVisible();
  await expect(warning.getByRole('link', { name: '문장과 실행 순서 개념 보기' })).toHaveAttribute(
    'href',
    '/concepts/js.basics.statement',
  );
  await expect(warning.getByRole('button', { name: /약점 연습/ })).toHaveCount(0);
  const list = page.getByRole('list', { name: '선수 개념과 내 숙련도' });
  await expect(list.getByRole('listitem')).toHaveText([
    /문장과 실행 순서\s*미학습 · 먼저 확인하면 좋아요/,
  ]);
  for (const scheme of ['light', 'dark'] as const) {
    // Like a11y.spec.ts: no theme transition in flight while axe measures contrast.
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.reload();
    await expect(warning).toBeVisible();
    await expectNoA11yViolations(page);
  }

  // The earlier lesson link goes back to where the concept is introduced.
  await warning.getByRole('link', { name: '‘첫 프로그램’ 단원 보기' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램' })).toBeVisible();
  await expect(page.getByRole('region', { name: /부터 확인하면 더 쉬워요/ })).toHaveCount(0);

  // Reading the first lesson introduces the concept, but it is not practised yet: still no
  // weakness practice (a weakness set ranks only practised concepts).
  await readLesson(api, FIRST);
  await page.goto(SECOND);
  await expect(warning.getByText(/입문/)).toBeVisible();
  await expect(warning.getByRole('button', { name: /약점 연습/ })).toHaveCount(0);

  // One wrong answer on the concept: practised and still weak, so weakness practice is offered.
  const set = (await api.post('/practice-sets', { kind: 'lesson', lessonId: FIRST })) as {
    items: { id: string; exerciseId: string }[];
  };
  const item = set.items.find((i) => i.exerciseId === `${FIRST}.mcq-first-line`);
  if (!item) throw new Error('mcq-first-line is not in the lesson set');
  await api.post('/attempts', {
    practiceSetItemId: item.id,
    exerciseId: item.exerciseId,
    answer: { optionId: 'b' },
    confidence: 'unsure',
    startedAt: 0,
    activeMs: 20_000,
  });
  await page.goto(SECOND);
  await warning.getByRole('button', { name: '문장과 실행 순서 약점 연습' }).click();
  await expect(page).toHaveURL(/\/review\/session\/[0-9A-Z]{26}/);
});
