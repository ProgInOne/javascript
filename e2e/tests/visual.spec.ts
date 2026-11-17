import { expect, test, type Page } from '@playwright/test';
import { openScreen, SCREENS } from './fixtures.ts';
import { mockPractice, mockRemediation, mockTutor, PRACTICE_URL } from './practice-mocks.ts';
import { failApi, holdLearningApi, mockEmptyReview, WEAK } from './state-mocks.ts';

// Fixed backup list so the data screen looks the same regardless of what earlier tests did.
const BACKUPS = {
  backups: [
    {
      id: 'manual:2026-11-13T091200000Z',
      kind: 'manual',
      createdAt: '2026-11-13T00:12:00.000Z',
      appVersion: '0.0.0',
      schemaMigration: '0000_init',
      sizeBytes: 2_516_582,
    },
    {
      id: 'daily:2026-11-12T234000000Z',
      kind: 'daily',
      createdAt: '2026-11-12T23:40:00.000Z',
      appVersion: '0.0.0',
      schemaMigration: '0000_init',
      sizeBytes: 2_411_724,
    },
    {
      id: 'weekly:2026-W46',
      kind: 'weekly',
      createdAt: '2026-11-09T23:40:00.000Z',
      appVersion: '0.0.0',
      schemaMigration: '0000_init',
      sizeBytes: 2_306_867,
    },
  ],
};

// The real backup folder is a temp directory; show the macOS default instead.
const LOCATION = {
  path: '/Users/learner/Library/Application Support/ProgInOne/backups',
  defaultPath: '/Users/learner/Library/Application Support/ProgInOne/backups',
  source: 'default',
  editable: true,
  cloudSynced: false,
};

const DASHBOARD = {
  date: '2026-11-15',
  activeMinutesToday: 18,
  reviewDueCount: 3,
  continueLesson: {
    id: 'js-basics.start.first-program',
    title: '첫 프로그램',
    status: 'reading',
    readProgress: 0.4,
    practiceSetId: null,
  },
};

// Header goal ring: 18 of 30 minutes, studied Monday and Wednesday (Sunday 2026-11-15 is today).
const week = [
  '2026-11-09',
  '2026-11-10',
  '2026-11-11',
  '2026-11-12',
  '2026-11-13',
  '2026-11-14',
  '2026-11-15',
];
const minutesOn = [32, 0, 41, 0, 0, 0, 18];
const GOALS = {
  date: '2026-11-15',
  goal: {
    dailyMinutes: 30,
    weeklyDays: 5,
    targetCourse: null,
    targetDate: null,
    effectiveFrom: null,
    isDefault: true,
  },
  pace: null,
  week: {
    weekStart: '2026-11-09',
    days: week.map((date, i) => ({
      date,
      activeMinutes: minutesOn[i] ?? 0,
      studied: (minutesOn[i] ?? 0) >= 5,
      goalMet: (minutesOn[i] ?? 0) >= 30,
    })),
    studiedDays: 3,
    goalDays: 2,
    weeklyDays: 5,
    achieved: false,
    activeMinutes: 91,
  },
  streakWeeks: 0,
};

const due = (conceptId: string, title: string, overdueDays: number) => ({
  conceptId,
  title,
  dueAt: 1,
  overdue: overdueDays > 0,
  overdueDays,
  itemCount: 1,
  estimatedSeconds: 90,
  priority: 1,
});
const QUEUE = {
  date: '2026-11-15',
  budgetMinutes: 20,
  due: [
    due('js.basics.console-log', 'console.log로 출력하기', 0),
    due('js.basics.statement', '문장과 실행 순서', 1),
  ],
  deferred: [],
  estimatedMinutes: 3,
};

const FIRST_VISIT = {
  lessonId: 'js-basics.start.first-program',
  status: 'reading',
  readProgress: 0,
  lastSectionId: null,
  practiceSetId: null,
  startedAt: 1,
  completedAt: null,
  introducedConcepts: [],
};

// Baselines are generated in the Playwright Docker image: `pnpm test:e2e:visual --update`.
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;
interface Viewport {
  readonly width: number;
  readonly height: number;
}
const NARROW: Viewport = { width: 1024, height: 768 };
const WIDE: Viewport = { width: 1920, height: 1080 };

/**
 * Widths beyond 1280/1440 (D-065): 1920 once for each main screen of PRD MVP 완료 정의 3, and
 * 1024 for the learning screens only (ui-ux.md 시각 회귀 매트릭스).
 */
const EXTRA_VIEWPORTS: Readonly<Record<string, readonly Viewport[]>> = {
  '/learn/js-basics.start.first-program': [NARROW, WIDE],
  '/review': [WIDE],
  '/settings/data': [WIDE],
};

for (const scheme of ['light', 'dark'] as const) {
  // The dashboard's states are covered with real learning data in journey.spec.ts.
  for (const { path, heading } of SCREENS.filter((s) => s.path !== '/')) {
    for (const viewport of [...VIEWPORTS, ...(EXTRA_VIEWPORTS[path] ?? [])]) {
      const slug = path.slice(1).replaceAll('/', '-').replaceAll('.', '_');
      const name = `${slug}-${scheme}-${viewport.width}`;
      test(`${name} @visual`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.route('**/api/v1/backups', (route) => route.fulfill({ json: BACKUPS }));
        await page.route('**/api/v1/backups/location', (route) =>
          route.fulfill({ json: LOCATION }),
        );
        // Learning state depends on earlier tests: fixed dashboard, first visit of the lesson.
        await page.route('**/api/v1/dashboard', (route) => route.fulfill({ json: DASHBOARD }));
        await page.route('**/api/v1/review-queue', (route) => route.fulfill({ json: QUEUE }));
        await page.route('**/api/v1/goals', (route) => route.fulfill({ json: GOALS }));
        await page.route('**/api/v1/lessons/*/progress', (route) =>
          route.fulfill({ json: FIRST_VISIT }),
        );
        await openScreen(page, path, heading, scheme);
        if (path === '/settings/ai') {
          await expect(page.getByRole('radio', { name: '모의 튜터 (기본)' })).toBeChecked();
        }
        await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
      });
    }
  }
}

// Practice screen (ui-ux.md 실습 모드) with fixed API responses: a choice item after a wrong,
// confident answer, and a code item with the editor.
for (const viewport of VIEWPORTS) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`practice-choice-feedback-${scheme}-${viewport.width} @visual`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockPractice(page);
      await openScreen(page, `${PRACTICE_URL}&i=1`, '첫 프로그램 연습', scheme);
      await page.locator('label', { hasText: '저장되어' }).click();
      await page.getByRole('button', { name: /확실해요/ }).click();
      await expect(page.getByRole('heading', { name: '정답이 아니에요.' })).toBeVisible();
      // Explanation open: the boxed panel under the toggle (D-080).
      await page.getByText('해설 보기').click();
      await expect(page.getByRole('group', { name: '해설' })).toContainText('완료');
      await expect(page).toHaveScreenshot(
        `practice-choice-feedback-${scheme}-${viewport.width}.png`,
        { fullPage: true },
      );
    });

    // Tutor drawer open next to a code item (pushes the content at 1280px and up).
    test(`tutor-drawer-${scheme}-${viewport.width} @visual`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockPractice(page);
      await mockTutor(page);
      await openScreen(page, `${PRACTICE_URL}&i=2`, '첫 프로그램 연습', scheme);
      await expect(page.getByRole('textbox', { name: 'main.js 편집기' })).toBeVisible();
      await page.getByRole('button', { name: /튜터/ }).click();
      const drawer = page.getByRole('complementary', { name: 'AI 튜터' });
      await expect(drawer.getByText('둘째 줄에서 어느 부분이')).toBeVisible();
      await expect(drawer.getByText('대기 중')).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`tutor-drawer-${scheme}-${viewport.width}.png`, {
        fullPage: true,
      });
    });

    // 재학습 유도 card above the problem after a second wrong answer (ui-ux.md).
    test(`practice-remediation-${scheme}-${viewport.width} @visual`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockPractice(page);
      await mockRemediation(page);
      await openScreen(page, `${PRACTICE_URL}&i=1`, '첫 프로그램 연습', scheme);
      await page.locator('label', { hasText: '저장되어' }).click();
      await page.getByRole('button', { name: /확실해요/ }).click();
      await expect(page.getByRole('region', { name: '잠깐 쉬어가요' })).toBeVisible();
      await expect(page.getByRole('button', { name: /문제 3:.*선수 개념 확인/ })).toBeVisible();
      await expect(page).toHaveScreenshot(`practice-remediation-${scheme}-${viewport.width}.png`, {
        fullPage: true,
      });
    });
  }
}

// The code item at every width the learning screens are checked at (D-065).
for (const viewport of [...VIEWPORTS, NARROW, WIDE]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`practice-code-${scheme}-${viewport.width} @visual`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockPractice(page);
      await openScreen(page, `${PRACTICE_URL}&i=2`, '첫 프로그램 연습', scheme);
      await expect(page.getByRole('textbox', { name: 'main.js 편집기' })).toBeVisible();
      await expect(page).toHaveScreenshot(`practice-code-${scheme}-${viewport.width}.png`, {
        fullPage: true,
      });
    });
  }
}

// Unit assessment (learning-engine.md#단원-평가-세트): the rules screen, and the end screen with a
// fixed finished set (item order and option shuffling depend on the random set ID otherwise).
const REVIEW_URL = '/learn/js-basics.values.values-review?mode=practice';
const REVIEW_SET = '01JD3Z8Q6V2K9M4T7R1X5W0ASM';
const R = 'js-basics.values.values-review.';
const letConcept = { id: 'js.basics.let', title: 'let으로 변수 선언하기' };
const reassignConcept = { id: 'js.basics.reassign', title: '다시 대입하기' };
const resultItem = (
  n: number,
  slug: string,
  concept: typeof letConcept,
  correct: boolean,
  text: { prompt: string; answer: string; explanation: string },
) => ({
  itemId: `01JD3Z8Q6V2K9M4T7R1X5W0AI${String(n)}`,
  position: n,
  exerciseId: `${R}${slug}`,
  type: 'mcq_single',
  difficulty: 2,
  prompt: text.prompt,
  concept,
  status: 'answered',
  outcome: correct ? 'correct' : 'incorrect',
  correct,
  misconceptions: [],
  explanation: text.explanation,
  solution: { kind: 'choice', choiceId: 'a', text: text.answer },
});
const FINISHED_ASSESSMENT = {
  id: REVIEW_SET,
  kind: 'assessment',
  status: 'completed',
  lessonId: 'js-basics.values.values-review',
  items: [0, 1].map((n) => ({
    id: `01JD3Z8Q6V2K9M4T7R1X5W0AI${String(n)}`,
    position: n,
    exerciseId: `${R}${n === 0 ? 'mcq-let' : 'mcq-reassign'}`,
    type: 'mcq_single',
    difficulty: 2,
    status: 'answered',
    reason: 'assessment',
    targetConcept: n === 0 ? letConcept : reassignConcept,
    attempts: 1,
    lastOutcome: n === 0 ? 'correct' : 'incorrect',
  })),
  progress: { total: 2, answered: 2, skipped: 0, pending: 0 },
  nextItemId: null,
  passRule: null,
  result: {
    total: 2,
    answered: 2,
    skipped: 0,
    correct: 1,
    pass: null,
    assessment: {
      correct: 1,
      total: 2,
      ratio: 0.5,
      passRatio: 0.8,
      passed: false,
      items: [
        resultItem(0, 'mcq-let', letConcept, true, {
          prompt: '값을 나중에 바꿀 변수의 키워드는?',
          answer: '`let`',
          explanation: '`let` 변수는 다시 대입할 수 있어요.',
        }),
        resultItem(1, 'mcq-reassign', reassignConcept, false, {
          prompt: '`let n = 1; n = n + 1;` 뒤의 `n`은?',
          answer: '`2`',
          explanation: '다시 대입한 값 `2`가 들어 있어요.',
        }),
      ],
      concepts: [
        { concept: letConcept, total: 1, correct: 1 },
        { concept: reassignConcept, total: 1, correct: 0 },
      ],
      missedConcepts: [reassignConcept],
      weaknessConceptIds: [reassignConcept.id],
    },
  },
  createdAt: 1,
  completedAt: 2,
};

for (const viewport of VIEWPORTS) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`assessment-start-${scheme}-${viewport.width} @visual`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openScreen(page, REVIEW_URL, '값과 변수 단원 평가', scheme);
      await expect(page).toHaveScreenshot(`assessment-start-${scheme}-${viewport.width}.png`, {
        fullPage: true,
      });
    });

    test(`assessment-result-${scheme}-${viewport.width} @visual`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.route(`**/api/v1/practice-sets/${REVIEW_SET}`, (route) =>
        route.fulfill({ json: FINISHED_ASSESSMENT }),
      );
      await openScreen(page, `${REVIEW_URL}&set=${REVIEW_SET}`, '단원 평가를 마쳤어요', scheme);
      await expect(page).toHaveScreenshot(`assessment-result-${scheme}-${viewport.width}.png`, {
        fullPage: true,
      });
    });
  }
}

// Review hub sections (ui-ux.md 오답 노트, FR-DASH-04 숙련도 변화) with fixed API responses: the
// mistake notes, one note's detail and the weekly mastery changes.
const P = 'js-basics.start.first-program.';
const consoleLog = { id: 'js.basics.console-log', title: 'console.log로 출력하기' };
const statement = { id: 'js.basics.statement', title: '문장과 실행 순서' };
const startModule = { id: 'js-basics.start', title: '시작하기' };
const jsBasics = { id: 'js-basics', title: 'JavaScript 기초' };
const at = (day: number) => Date.UTC(2026, 10, day, 3);
const note = (over: object) => ({
  exerciseId: `${P}mcq-log-role`,
  type: 'mcq_single',
  difficulty: 1,
  prompt: '`console.log("완료");`를 실행하면 어떤 일이 일어나나요?',
  concept: consoleLog,
  module: startModule,
  course: jsBasics,
  lastWrongAt: at(14),
  lastWrongOutcome: 'incorrect',
  lastWrongContext: 'lesson',
  wrongCount: 2,
  confidentWrong: true,
  misconceptions: [{ id: 'js.mc.log-is-return', title: '출력을 반환으로 착각함' }],
  status: 'open',
  resolvedAt: null,
  archived: false,
  retry: { available: true, blockedBy: null },
  ...over,
});
const MISTAKES = {
  items: [
    note({}),
    note({
      exerciseId: `${P}tf-order`,
      type: 'true_false',
      difficulty: 2,
      prompt: '프로그램은 아래 줄부터 위로 실행된다.',
      concept: statement,
      lastWrongAt: at(12),
      wrongCount: 1,
      confidentWrong: false,
      misconceptions: [],
      status: 'resolved',
      resolvedAt: at(13),
    }),
    note({
      exerciseId: 'js-basics.values.values-review.mcq-reassign',
      difficulty: 2,
      prompt: '`let n = 1; n = n + 1;` 뒤의 `n`은?',
      concept: { id: 'js.basics.reassign', title: '다시 대입하기' },
      module: { id: 'js-basics.values', title: '값과 변수' },
      lastWrongAt: at(11),
      lastWrongContext: 'assessment',
      wrongCount: 1,
      misconceptions: [],
      retry: { available: false, blockedBy: 'assessment_only' },
    }),
  ],
  total: 3,
  counts: { all: 3, open: 2, resolved: 1 },
  facets: {
    courses: [jsBasics],
    modules: [
      { ...startModule, courseId: 'js-basics' },
      { id: 'js-basics.values', title: '값과 변수', courseId: 'js-basics' },
    ],
    concepts: [
      { ...consoleLog, moduleId: 'js-basics.start' },
      { ...statement, moduleId: 'js-basics.start' },
    ],
  },
};
const MISTAKE = {
  note: note({}),
  code: null,
  codeLanguage: 'javascript',
  attempts: [
    {
      id: 'a2',
      submittedAt: at(14),
      outcome: 'incorrect',
      confidence: 'sure',
      context: 'lesson',
      answer: {
        kind: 'choice',
        choiceId: 'b',
        text: '`완료`라는 값이 저장되어 다음 줄에서 다시 쓸 수 있다',
      },
      misconceptions: [{ id: 'js.mc.log-is-return', title: '출력을 반환으로 착각함' }],
      feedback: ['console.log는 보여 주기만 하고 값을 저장하지 않아요.'],
      hintLevelMax: 0,
      solutionViewed: false,
    },
    {
      id: 'a1',
      submittedAt: at(12),
      outcome: 'incorrect',
      confidence: 'unsure',
      context: 'review',
      answer: { kind: 'choice', choiceId: 'c', text: '프로그램이 끝난다' },
      misconceptions: [],
      feedback: ['console.log는 출력만 할 뿐이에요.'],
      hintLevelMax: 1,
      solutionViewed: false,
    },
  ],
  explanation:
    '정답은 **콘솔에 `완료`라는 글자가 보인다**예요. console.log는 값을 콘솔에 보여 줄 뿐 저장하지 않아요.',
  solution: null,
  solutionSource: null,
};
const change = (id: string, day: number, concept: object, before: string, after: string) => ({
  id,
  at: at(day),
  date: `2026-11-${String(day)}`,
  concept,
  stageBefore: before,
  stageAfter: after,
  direction:
    ['not_started', 'introduced', 'practicing', 'proficient', 'mastered'].indexOf(after) >
    ['not_started', 'introduced', 'practicing', 'proficient', 'mastered'].indexOf(before)
      ? 'up'
      : 'down',
  scoreBefore: 40,
  scoreAfter: 52,
});
const weekStarts = [
  '2026-09-21',
  '2026-09-28',
  '2026-10-05',
  '2026-10-12',
  '2026-10-19',
  '2026-10-26',
  '2026-11-02',
  '2026-11-09',
];
const perWeek: [number, number][] = [
  [0, 0],
  [2, 0],
  [3, 1],
  [1, 0],
  [4, 1],
  [2, 2],
  [5, 0],
  [3, 1],
];
const MASTERY_CHANGES = {
  date: '2026-11-15',
  weeks: weekStarts.map((weekStart, i) => ({
    weekStart,
    promotions: perWeek[i]?.[0] ?? 0,
    demotions: perWeek[i]?.[1] ?? 0,
    concepts: (perWeek[i]?.[0] ?? 0) + (perWeek[i]?.[1] ?? 0),
  })),
  recent: [
    change('e4', 14, consoleLog, 'introduced', 'practicing'),
    change('e3', 13, statement, 'practicing', 'introduced'),
    change('e2', 12, statement, 'introduced', 'practicing'),
    change(
      'e1',
      10,
      { id: 'js.basics.let', title: 'let으로 변수 선언하기' },
      'not_started',
      'introduced',
    ),
  ],
  totals: { promotions: 20, demotions: 5 },
};

const REVIEW_SCREENS = [
  { name: 'review-mistakes', path: '/review/mistakes' },
  {
    name: 'review-mistake-detail',
    path: `/review/mistakes/${encodeURIComponent(`${P}mcq-log-role`)}`,
  },
  { name: 'review-progress', path: '/review/progress' },
  { name: 'review-weak', path: '/review/weak' },
] as const;

for (const viewport of VIEWPORTS) {
  for (const scheme of ['light', 'dark'] as const) {
    for (const screen of REVIEW_SCREENS) {
      const name = `${screen.name}-${scheme}-${viewport.width}`;
      test(`${name} @visual`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.route('**/api/v1/review-queue', (route) => route.fulfill({ json: QUEUE }));
        await page.route('**/api/v1/goals', (route) => route.fulfill({ json: GOALS }));
        await page.route('**/api/v1/dashboard', (route) => route.fulfill({ json: DASHBOARD }));
        await page.route(/\/api\/v1\/mistakes(\?.*)?$/, (route) =>
          route.fulfill({ json: MISTAKES }),
        );
        await page.route(/\/api\/v1\/mistakes\/[^?]+$/, (route) =>
          route.fulfill({ json: MISTAKE }),
        );
        await page.route('**/api/v1/mastery-changes', (route) =>
          route.fulfill({ json: MASTERY_CHANGES }),
        );
        await page.route('**/api/v1/weak-concepts', (route) => route.fulfill({ json: WEAK }));
        await openScreen(page, screen.path, '복습', scheme);
        await expect(page.locator('.pi-skeleton')).toHaveCount(0);
        await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
      });
    }
  }
}

// Empty, error and loading states (ui-ux.md 시각 회귀 매트릭스 상태 축, D-065): one representative
// screen each, at 1280 only. The header goal ring keeps its fixed data.
const STATES = [
  {
    name: 'review-empty',
    path: '/review',
    heading: '복습',
    ready: '오늘 복습할 개념이 없어요',
    mock: mockEmptyReview,
  },
  {
    name: 'review-mistakes-empty',
    path: '/review/mistakes',
    heading: '복습',
    ready: '아직 틀린 문제가 없어요',
    mock: mockEmptyReview,
  },
  {
    name: 'review-error',
    path: '/review',
    heading: '불러오지 못했어요',
    ready: '불러오지 못했어요',
    mock: (page: Page) => failApi(page, '/review-queue'),
  },
] as const;

for (const scheme of ['light', 'dark'] as const) {
  for (const state of STATES) {
    const name = `${state.name}-${scheme}-1280`;
    test(`${name} @visual`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[0]);
      await page.route('**/api/v1/goals', (route) => route.fulfill({ json: GOALS }));
      await state.mock(page);
      await openScreen(page, state.path, state.heading, scheme);
      await expect(page.getByRole('heading', { name: state.ready })).toBeVisible();
      await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
    });
  }

  test(`dashboard-loading-${scheme}-1280 @visual`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[0]);
    const release = await holdLearningApi(page);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('.pi-skeleton').first()).toBeVisible();
    await expect(page.locator('[data-ai-state]').first()).not.toHaveAttribute(
      'data-ai-state',
      'loading',
    );
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`dashboard-loading-${scheme}-1280.png`, {
      fullPage: true,
    });
    await release();
  });
}
