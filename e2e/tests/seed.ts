import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Learning history through the API (journey.spec.ts): practice and review sets are answered the
 * way the web app would submit them, without the UI. Items whose exercise needs a sandbox run or
 * has shuffled public ids (code, parsons, blanks) are skipped, so only answers known here are
 * sent. Skipping appends one follow-up; skipped follow-ups end the chain.
 */

const P = 'js-basics.start.first-program.';
const V = 'js-basics.values.variables.';

/** Correct and wrong answers of the E2E fixture exercises that need no sandbox run. */
const ANSWERS: Record<string, { right: unknown; wrong: unknown }> = {
  [`${P}mcq-log-role`]: { right: { optionId: 'a' }, wrong: { optionId: 'b' } },
  [`${P}mcq-first-line`]: { right: { optionId: 'a' }, wrong: { optionId: 'b' } },
  [`${P}multi-log-facts`]: { right: { optionIds: ['a', 'b'] }, wrong: { optionIds: ['c'] } },
  [`${P}tf-order`]: {
    right: { value: false, reasonId: 'r1' },
    wrong: { value: true, reasonId: 'r2' },
  },
  [`${P}predict-quoted`]: { right: { console: '1 + 2\n3' }, wrong: { console: '3\n3' } },
  [`${P}predict-order`]: { right: { console: '일어나기\n3' }, wrong: { console: '3\n일어나기' } },
  [`${V}mcq-let`]: { right: { optionId: 'a' }, wrong: { optionId: 'b' } },
  [`${V}mcq-const`]: { right: { optionId: 'a' }, wrong: { optionId: 'b' } },
  [`${V}mcq-reassign`]: { right: { optionId: 'a' }, wrong: { optionId: 'b' } },
};

interface SetView {
  id: string;
  status: string;
  nextItemId: string | null;
  items: { id: string; exerciseId: string; status: string }[];
}

export interface Api {
  get: (path: string) => Promise<unknown>;
  post: (path: string, data?: unknown) => Promise<unknown>;
}

/** API calls with the session token read from the app page. */
export async function apiFor(page: Page, request: APIRequestContext): Promise<Api> {
  if (!/^https?:/.test(page.url())) await page.goto('/settings/appearance');
  const token = (await page.locator('meta[name="proginone-token"]').getAttribute('content')) ?? '';
  const headers = { 'x-proginone-token': token };
  const base = new URL(page.url()).origin;
  const check = async (res: Awaited<ReturnType<APIRequestContext['get']>>) => {
    expect(res.ok(), `${res.url()} → ${String(res.status())} ${await res.text()}`).toBe(true);
    return await res.json();
  };
  return {
    get: async (path) => check(await request.get(`${base}/api/v1${path}`, { headers })),
    post: async (path, data = {}) =>
      check(await request.post(`${base}/api/v1${path}`, { headers, data })),
  };
}

/**
 * Answers a set until it is completed. `wrong` exercises are answered wrong (with confidence
 * `sure`, which confirms a misconception at once) the first `wrongTimes` times they come up.
 */
export async function solveSet(
  api: Api,
  setId: string,
  options: { wrong?: readonly string[]; wrongTimes?: number } = {},
): Promise<void> {
  const wrongLeft = new Map((options.wrong ?? []).map((id) => [id, options.wrongTimes ?? 1]));
  for (let step = 0; step < 60; step++) {
    const set = (await api.get(`/practice-sets/${setId}`)) as SetView;
    if (set.status !== 'active' || set.nextItemId === null) return;
    const item = set.items.find((i) => i.id === set.nextItemId);
    if (!item) return;
    const answer = ANSWERS[item.exerciseId];
    const view = (await api.get(
      `/exercises/${encodeURIComponent(item.exerciseId)}?practiceSetItemId=${item.id}`,
    )) as { requiresRun: boolean };
    if (!answer || view.requiresRun) {
      await api.post(`/practice-sets/${setId}/items/${item.id}/skip`);
      continue;
    }
    const left = wrongLeft.get(item.exerciseId) ?? 0;
    if (left > 0) wrongLeft.set(item.exerciseId, left - 1);
    await api.post('/attempts', {
      practiceSetItemId: item.id,
      exerciseId: item.exerciseId,
      answer: left > 0 ? answer.wrong : answer.right,
      confidence: 'sure',
      startedAt: 0,
      activeMs: 30_000,
    });
  }
  throw new Error(`set ${setId} did not finish`);
}

/** Reads a lesson (the first visit starts it and introduces its concepts). */
export async function readLesson(api: Api, lessonId: string) {
  await api.post(`/lessons/${lessonId}/progress`, { readProgress: 1 });
}

/** Practices a lesson's set to the end. */
export async function practiceLesson(
  api: Api,
  lessonId: string,
  options: Parameters<typeof solveSet>[2] = {},
) {
  const set = (await api.post('/practice-sets', { kind: 'lesson', lessonId })) as SetView;
  await solveSet(api, set.id, options);
}

/** Today's review set, if anything is due. */
export async function reviewToday(api: Api, options: Parameters<typeof solveSet>[2] = {}) {
  const queue = (await api.get('/review-queue')) as { due: unknown[] };
  if (queue.due.length === 0) return false;
  const set = (await api.post('/practice-sets', { kind: 'review' })) as SetView;
  await solveSet(api, set.id, options);
  return true;
}

/**
 * `minutes` of active study today: heartbeats a minute apart with fresh input. The server clock
 * must be moved with `advance` (it counts time between heartbeats on its own clock).
 */
export async function study(api: Api, minutes: number, advance: (ms: number) => void) {
  const beats = Math.ceil(minutes);
  // The server clamps `lastInputAt` to its own clock: "input just now" whatever the test clock.
  const justNow = Number.MAX_SAFE_INTEGER;
  await api.post('/activity/heartbeat', { lastInputAt: justNow, visible: true, focused: true });
  for (let i = 0; i < beats; i++) {
    advance(60_000);
    await api.post('/activity/heartbeat', {
      lastInputAt: justNow,
      visible: true,
      focused: true,
    });
  }
}
