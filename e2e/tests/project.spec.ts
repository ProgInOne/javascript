import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations, openScreen } from './fixtures.ts';
import { apiFor } from './seed.ts';

/**
 * Project units (content-and-exercises.md#프로젝트-단원-kind-project) on the production build:
 * milestones pass one grading run at a time in the real sandbox, the screen resumes from the last
 * graded code after a reload, and passing every milestone completes the unit.
 */

const PROJECT = 'js-basics.project.mini-project';
const EXERCISE = `${PROJECT}.profile-card`;

const page_ = (body: string, script = '') => `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>자기소개</title>
  </head>
  <body>
    <main>
${body}
    </main>${script}
  </body>
</html>
`;
const TITLE = '      <h1>김코딩</h1>';
const LIST = `      <ul>
        <li>산책</li>
        <li>음악</li>
        <li>요리</li>
      </ul>
      <button id="hello" type="button">인사하기</button>
      <p id="message"></p>`;
const SCRIPT = `
    <script>
      const button = document.querySelector('#hello');
      const message = document.querySelector('#message');
      button.addEventListener('click', () => {
        message.textContent = '안녕하세요!';
      });
    </script>`;

/** Replaces the editor content. `insertText` avoids CodeMirror's bracket auto-closing. */
async function replaceCode(page: Page, code: string) {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(code);
}

const milestones = (page: Page) => page.getByRole('region', { name: '마일스톤' });

test('project: partial milestones, resume after reload, then complete', async ({
  page,
  request,
}) => {
  // Reading mode: the brief and the way into the project.
  await page.goto(`/learn/${PROJECT}`);
  await expect(page.getByRole('heading', { level: 1, name: /자기소개 카드/ })).toBeVisible();
  await page.getByRole('link', { name: '프로젝트 열기' }).click();
  await expect(page).toHaveURL(/mode=practice/);
  await expect(page.getByRole('heading', { level: 1, name: /자기소개 카드/ })).toBeVisible();
  await expect(milestones(page)).toContainText('3개 중 0개 통과');
  await expect(milestones(page)).toContainText('채점 전');
  await expectNoA11yViolations(page);

  // Stage 1 only: the first milestone passes, the run is recorded.
  await replaceCode(page, page_(TITLE));
  await page.getByRole('button', { name: '채점하기' }).click();
  await expect(milestones(page)).toContainText('3개 중 1개 통과');
  await expect(page.getByText('새로 통과: 이름 제목 만들기')).toBeVisible();
  // The event milestone after the failed list step was never reached.
  await expect(milestones(page).getByRole('listitem').nth(2)).toContainText('앞 단계 먼저');
  await expect(page.getByText('모든 마일스톤을 통과했어요!')).toHaveCount(0);

  // Stage 2 without the script: two milestones.
  await replaceCode(page, page_(`${TITLE}\n${LIST}`));
  await page.getByRole('button', { name: '채점하기' }).click();
  await expect(milestones(page)).toContainText('3개 중 2개 통과');
  await expect(page.getByText('새로 통과: 좋아하는 것 목록 만들기')).toBeVisible();

  // Resume: without the browser draft, the screen restores the last graded code and progress.
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await expect(milestones(page)).toContainText('3개 중 2개 통과');
  await expect(page.getByText('마지막으로 채점한 코드에서 이어서 해요.')).toBeVisible();
  await expect(page.locator('.cm-content').first()).toContainText('산책');
  await expect(page.locator('.cm-content').first()).toContainText('인사하기');
  const api = await apiFor(page, request);
  expect(await api.get(`/lessons/${PROJECT}/project`)).toMatchObject({
    status: 'practicing',
    passedCount: 2,
    runCount: 2,
  });

  // Every milestone: the unit is complete.
  await replaceCode(page, page_(`${TITLE}\n${LIST}`, SCRIPT));
  await page.getByRole('button', { name: '채점하기' }).click();
  await expect(page.getByText('모든 마일스톤을 통과했어요!')).toBeVisible();
  await expect(milestones(page)).toContainText('3개 중 3개 통과');
  await expect(page.getByText('완성', { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
  expect(await api.get(`/lessons/${PROJECT}/project`)).toMatchObject({
    exerciseId: EXERCISE,
    status: 'completed',
    passedCount: 3,
  });

  // Preparation practice: the unit's own items as a lesson set, then back to the project.
  await page.getByRole('button', { name: '준비 연습 하기' }).click();
  await expect(page).toHaveURL(/mode=practice&set=[0-9A-Z]{26}/);
  await expect(page.getByText('미니 프로젝트: 자기소개 카드 준비 연습')).toBeVisible();
  await expect(page.locator('[data-exercise-id]')).toHaveAttribute(
    'data-exercise-id',
    `${PROJECT}.mcq-prep`,
  );
  await page.locator('label', { hasText: '버튼을 누를 때' }).click();
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.getByRole('button', { name: /결과 보기/ }).click();
  await page.getByRole('link', { name: '프로젝트로 돌아가기' }).click();
  await expect(milestones(page)).toContainText('3개 중 3개 통과');

  // The course lists the unit as a project.
  await page.goto('/courses/js-basics');
  // The module may already be open as the one with the lesson to do now (D-083).
  await expect(page.getByRole('progressbar', { name: '과정 진행률' })).toBeVisible();
  const unit = page.locator('[data-module-id="js-basics.project"]');
  if ((await unit.getAttribute('open')) === null) await page.getByText('작은 프로젝트').click();
  const row = page.getByRole('link', { name: /자기소개 카드/ });
  await expect(row).toContainText('응용 프로젝트');
});

// Visual regression with a fixed progress state (the editor shows the saved code).
const PROGRESS = {
  lessonId: PROJECT,
  exerciseId: EXERCISE,
  status: 'practicing',
  completedAt: null,
  milestones: [
    { id: 'm1', title: '이름 제목 만들기', checkCount: 1, passed: true, blocked: false },
    { id: 'm2', title: '좋아하는 것 목록 만들기', checkCount: 1, passed: false, blocked: false },
    { id: 'm3', title: '인사 버튼 동작시키기', checkCount: 1, passed: false, blocked: false },
  ],
  passedCount: 1,
  runCount: 1,
  lastRun: { attemptId: '01JD3Z8Q6V2K9M4T7R1X5W0PRJ', at: 1, outcome: 'partial', score: 0.33 },
  savedAnswer: { files: [{ path: 'index.html', content: page_(TITLE) }] },
  savedAt: 1,
};

for (const width of [1280, 1440] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`project-progress-${scheme}-${String(width)} @visual`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 900 });
      await page.route(`**/api/v1/lessons/${PROJECT}/project`, (route) =>
        route.fulfill({ json: PROGRESS }),
      );
      // No server draft: the flow above left its last code as one (D-063).
      await page.route(`**/api/v1/code-drafts/exercises/${EXERCISE}`, (route) =>
        route.fulfill({ json: { draft: null } }),
      );
      await page.addInitScript(() => {
        localStorage.clear();
      });
      await openScreen(
        page,
        `/learn/${PROJECT}?mode=practice`,
        '미니 프로젝트: 자기소개 카드',
        scheme,
      );
      await expect(milestones(page)).toContainText('3개 중 1개 통과');
      await expect(page).toHaveScreenshot(`project-progress-${scheme}-${String(width)}.png`, {
        fullPage: true,
      });
    });
  }
}
