import type { Page } from '@playwright/test';

/**
 * Fixed API responses for the empty, error and loading states of the main screens (D-065), shared
 * by the visual matrix (visual.spec.ts) and the accessibility checks (a11y.spec.ts). The shapes
 * follow `packages/shared` (`reviewQueueSchema`, `mistakeListSchema`, `weakConceptsSchema`,
 * `masteryChangesSchema`).
 */

const DATE = '2026-11-15';

export const EMPTY_QUEUE = {
  date: DATE,
  budgetMinutes: 20,
  due: [],
  deferred: [],
  estimatedMinutes: 0,
};

export const EMPTY_MISTAKES = {
  items: [],
  total: 0,
  counts: { all: 0, open: 0, resolved: 0 },
  facets: { courses: [], modules: [], concepts: [] },
};

export const EMPTY_WEAK = { concepts: [], suggested: [] };

export const EMPTY_CHANGES = {
  date: DATE,
  weeks: ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'].map((weekStart) => ({
    weekStart,
    promotions: 0,
    demotions: 0,
    concepts: 0,
  })),
  recent: [],
  totals: { promotions: 0, demotions: 0 },
};

const weak = (
  id: string,
  title: string,
  weakness: number,
  effective: number,
  stage: string,
  extra: { misconception?: { id: string; title: string }; prerequisite?: boolean } = {},
) => ({
  concept: { id, title },
  weakness,
  effective,
  stage,
  consecutiveFailures: extra.misconception ? 2 : 0,
  factors: {
    gap: 1 - effective / 100,
    importanceFactor: 1,
    misconceptionFactor: extra.misconception ? 1.5 : 1,
    failureFactor: extra.misconception ? 1.2 : 1,
  },
  misconceptions: extra.misconception ? [{ ...extra.misconception, status: 'confirmed' }] : [],
  prerequisites: extra.prerequisite
    ? [
        {
          concept: { id: 'js.basics.let', title: 'let으로 변수 선언하기' },
          stage: 'introduced',
          effective: 48,
          weak: true,
        },
      ]
    : [],
});

/** 약점 집중 with three weak concepts: a confirmed misconception and a weak prerequisite. */
export const WEAK = {
  concepts: [
    weak('js.basics.const', 'const 선언', 0.82, 38, 'practicing', {
      misconception: { id: 'js.mc.const-reassign', title: 'const 변수도 다시 대입할 수 있다고 봄' },
      prerequisite: true,
    }),
    weak('js.basics.reassign', '다시 대입하기', 0.61, 52, 'introduced'),
    weak('js.basics.console-log', 'console.log로 출력하기', 0.4, 64, 'practicing'),
  ],
  suggested: ['js.basics.const', 'js.basics.reassign'],
};

/** Every review hub section empty: nothing due, no mistakes, no weak concepts, no changes. */
export async function mockEmptyReview(page: Page) {
  await page.route('**/api/v1/review-queue', (route) => route.fulfill({ json: EMPTY_QUEUE }));
  await page.route(/\/api\/v1\/mistakes(\?.*)?$/, (route) =>
    route.fulfill({ json: EMPTY_MISTAKES }),
  );
  await page.route('**/api/v1/weak-concepts', (route) => route.fulfill({ json: EMPTY_WEAK }));
  await page.route('**/api/v1/mastery-changes', (route) => route.fulfill({ json: EMPTY_CHANGES }));
}

/** A non-retryable server error for `path` (the screen shows its error state at once). */
export async function failApi(page: Page, path: string) {
  await page.route(`**/api/v1${path}`, (route) =>
    route.fulfill({
      status: 500,
      json: {
        error: {
          code: 'INTERNAL',
          message: '서버에서 요청을 처리하지 못했어요.',
          retryable: false,
        },
      },
    }),
  );
}

/**
 * Learning data never arrives: every API call except the learner (the onboarding redirect waits
 * for it), the settings and the AI status hangs, so the screen keeps its skeletons. Returns a function that lets the requests go on.
 */
export async function holdLearningApi(page: Page) {
  const held: (() => Promise<void>)[] = [];
  await page.route(
    (url) =>
      url.pathname.startsWith('/api/v1/') &&
      url.pathname !== '/api/v1/learner' &&
      !url.pathname.startsWith('/api/v1/ai/') &&
      !url.pathname.startsWith('/api/v1/settings'),
    (route) => {
      held.push(() => route.continue());
    },
  );
  return async () => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await Promise.all(held.map(async (go) => go().catch(() => undefined)));
  };
}
