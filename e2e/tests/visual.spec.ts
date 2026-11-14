import { expect, test } from '@playwright/test';
import { openScreen, SCREENS } from './fixtures.ts';
import { mockPractice, mockTutor, PRACTICE_URL } from './practice-mocks.ts';

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

for (const viewport of VIEWPORTS) {
  for (const scheme of ['light', 'dark'] as const) {
    // The dashboard's states are covered with real learning data in journey.spec.ts.
    for (const { path, heading } of SCREENS.filter((s) => s.path !== '/')) {
      const slug = path.slice(1).replaceAll('/', '-').replaceAll('.', '_');
      const name = `${slug}-${scheme}-${viewport.width}`;
      test(`${name} @visual`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.route('**/api/v1/backups', (route) => route.fulfill({ json: BACKUPS }));
        // Learning state depends on earlier tests: fixed dashboard, first visit of the lesson.
        await page.route('**/api/v1/dashboard', (route) => route.fulfill({ json: DASHBOARD }));
        await page.route('**/api/v1/review-queue', (route) => route.fulfill({ json: QUEUE }));
        await page.route('**/api/v1/goals', (route) => route.fulfill({ json: GOALS }));
        await page.route('**/api/v1/lessons/*/progress', (route) =>
          route.fulfill({ json: FIRST_VISIT }),
        );
        await openScreen(page, path, heading, scheme);
        if (path === '/settings/ai') await expect(page.getByText('모의 튜터')).toBeVisible();
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
