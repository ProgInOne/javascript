import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  addPerfHooks,
  applyCpuThrottle,
  firstReadyTime,
  navigationTimings,
  startFrameMonitor,
  stopFrameMonitor,
  summarize,
  timeInteraction,
  type ReadySpec,
} from './measure.ts';

/**
 * NFR-01 (first screen, route transitions, deterministic grading), NFR-02 (code run → first
 * console line) and NFR-03 (infinite loop, UI stays responsive) on the production build with the
 * real content pack. Each measurement repeats; the median is checked against the target and all
 * samples are written to `e2e/perf-results/` and printed as a table.
 */

const TARGETS = {
  firstScreen: 2000,
  transition: 200,
  grading: 300,
  firstConsole: 500,
  // NFR-03 has no number; 100 ms is the usual limit for a UI to still feel responsive (RAIL).
  loopFrameGap: 100,
} as const;

const ROUNDS = Number(process.env['PERF_ROUNDS'] ?? 5);

interface Row {
  metric: string;
  nfr: string;
  target: number;
  samples: number[];
  note?: string;
}
const rows: Row[] = [];
const extra: Record<string, unknown> = {};

function record(row: Row) {
  rows.push(row);
  const { median } = summarize(row.samples);
  expect
    .soft(median, `${row.metric}: median ${String(median)} ms > ${String(row.target)} ms`)
    .toBeLessThanOrEqual(row.target);
}

/** The page `h1` (the dashboard's also carries a screen-reader summary after its name). */
const heading = (text: string, exact = true): ReadySpec => ({
  selector: 'h1',
  text: exact ? `^${text}$` : `^${text}`,
  fresh: true,
  settled: true,
});

async function token(page: Page) {
  if (!page.url().startsWith('http')) await page.goto('/settings/appearance');
  return (await page.locator('meta[name="proginone-token"]').getAttribute('content')) ?? '';
}

async function api(page: Page, request: APIRequestContext) {
  const headers = { 'x-proginone-token': await token(page) };
  return {
    patch: async (path: string, data: unknown) => {
      const res = await request.patch(`/api/v1${path}`, { headers, data });
      expect(res.ok(), await res.text()).toBe(true);
      return (await res.json()) as unknown;
    },
    post: async (path: string, data: unknown) => {
      const res = await request.post(`/api/v1${path}`, { headers, data });
      expect(res.ok(), await res.text()).toBe(true);
      return (await res.json()) as unknown;
    },
  };
}

/** Exercises of the real content pack, chosen by type (practice usage, stable order). */
function pickExercises(): { deterministic: string[]; code: string[] } {
  const db = new DatabaseSync(process.env['PERF_CONTENT_DB'] ?? '', { readOnly: true });
  try {
    const pick = (type: string, n: number, where = '') =>
      (
        db
          .prepare(
            `SELECT id FROM exercises WHERE type = ? AND usage = 'practice' ${where}
             ORDER BY id LIMIT ?`,
          )
          .all(type, n) as { id: string }[]
      ).map((r) => r.id);
    return {
      deterministic: [
        ...pick('mcq_single', 3, `AND id LIKE 'js-basics.%'`),
        ...pick('mcq_multi', 2, `AND id LIKE 'js-basics.%'`),
        ...pick('true_false', 2, `AND id LIKE 'js-basics.%'`),
        ...pick(
          'predict_output',
          3,
          `AND id LIKE 'js-basics.%' AND json_extract(public_spec_json, '$.answerKind') = 'console'`,
        ),
      ],
      // One-file js-console programs (`main.js`), the "일반 예제" of NFR-02.
      code: pick(
        'fix_bug',
        3,
        `AND id LIKE 'js-basics.%' AND json_array_length(spec_json, '$.buggy.files') = 1
         AND json_extract(spec_json, '$.buggy.files[0].path') = 'main.js'
         AND json_extract(spec_json, '$.buggy.files[0].content') LIKE 'console.log(%'`,
      ),
    };
  } finally {
    db.close();
  }
}

/** Opens an `extra` practice set of these exercises (the mistake-notes "다시 풀기" set). */
async function openSet(page: Page, request: APIRequestContext, exerciseIds: string[]) {
  const set = (await (
    await api(page, request)
  ).post('/practice-sets', {
    kind: 'extra',
    exerciseIds,
  })) as { id: string };
  await page.goto(`/review/session/${set.id}?i=1`);
  await expect(page.locator('.practice-layout')).toBeVisible();
}

/** A syntactically valid answer (right or wrong does not matter for timing). */
const GENERIC_TYPES = new Set(['mcq_single', 'mcq_multi', 'true_false', 'predict_output']);

async function fillAnswer(page: Page, type: string) {
  const main = page.getByRole('main');
  switch (type) {
    case 'mcq_single':
    case 'mcq_multi':
      await main.locator('label.pi-ex-choice').first().click();
      break;
    case 'true_false':
      // Verdict first; the reason choices follow it.
      await main.locator('label.pi-ex-choice').first().click();
      if ((await main.locator('label.pi-ex-choice').count()) > 2)
        await main.locator('label.pi-ex-choice').nth(2).click();
      break;
    case 'predict_output':
      await main.getByLabel('예상 출력').fill('x');
      break;
    default:
      throw new Error(`no generic answer for ${type}`);
  }
}

/** A typical lesson example for NFR-02 ("일반 예제"): a few lines with a loop. */
const example = (n: number) =>
  [
    `console.log("실행 ${String(n)}회");`,
    'const menu = ["김밥", "라면", "떡볶이"];',
    'for (const item of menu) {',
    '  console.log(`${item} 주문`);',
    '}',
    'console.log(menu.length);',
    '',
  ].join('\n');

/** Replaces the editor content. `insertText` avoids CodeMirror's bracket auto-closing. */
async function replaceCode(page: Page, code: string) {
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(code);
}

const FEEDBACK: ReadySpec = {
  selector: ':is(h2, h3, h4)',
  text: '^(정답이에요|정답이 아니에요|부분 정답이에요)\\.',
  fresh: true,
};

async function nextItem(page: Page) {
  await page
    .getByRole('main')
    .getByRole('button', { name: /다음 문제|결과 보기/ })
    .first()
    .click();
}

test.beforeAll(async ({ browser, request }) => {
  const page = await browser.newPage();
  await page.goto('/settings/appearance');
  await (await api(page, request)).patch('/learner', { onboarded: true });
  await page.close();
});

test.afterAll(() => {
  const table = rows.map((r) => ({
    metric: r.metric,
    nfr: r.nfr,
    target: r.target,
    ...summarize(r.samples),
    ...(r.note ? { note: r.note } : {}),
  }));
  const report = {
    when: new Date().toISOString(),
    machine: {
      platform: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model ?? 'unknown',
      cores: cpus().length,
      memoryGb: Math.round(totalmem() / 2 ** 30),
      node: process.version,
    },
    rounds: ROUNDS,
    cpuThrottle: Number(process.env['PERF_CPU_THROTTLE'] ?? 1),
    results: table,
    samples: Object.fromEntries(rows.map((r) => [r.metric, r.samples.map(Math.round)])),
    extra,
  };
  const dir = join(import.meta.dirname, '..', 'perf-results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `perf-${report.when.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${JSON.stringify(report.machine)}`);
  console.table(table);
  console.log(JSON.stringify(extra));
  console.log(`results: ${file}`);
});

test('deterministic grading: submit → feedback (NFR-01, 300 ms)', async ({ page, request }) => {
  const { deterministic } = pickExercises();
  expect(deterministic.length).toBeGreaterThanOrEqual(8);
  await addPerfHooks(page);
  await applyCpuThrottle(page);
  await openSet(page, request, deterministic);
  const samples: number[] = [];
  const main = page.getByRole('main');
  // Wrong answers append follow-up items of any type; those are skipped, not timed.
  for (let step = 0; step < 40 && samples.length < deterministic.length; step++) {
    const type = (await page.locator('.practice-layout').getAttribute('data-type')) ?? '';
    if (GENERIC_TYPES.has(type)) {
      await fillAnswer(page, type);
      const submit = main.getByRole('button', { name: /확실해요|^제출/ });
      samples.push(await timeInteraction(page, FEEDBACK, () => submit.click()));
      await nextItem(page);
    } else {
      await main.getByRole('button', { name: '건너뛰기' }).click();
    }
    if (await page.getByRole('region', { name: /마쳤어요/ }).isVisible()) break;
  }
  expect(samples.length).toBe(deterministic.length);
  record({ metric: 'grading (deterministic)', nfr: 'NFR-01', target: TARGETS.grading, samples });
});

test('code run → first console line (NFR-02, 500 ms) and code grading', async ({
  page,
  request,
}) => {
  const { code } = pickExercises();
  expect(code.length).toBe(3);
  await addPerfHooks(page);
  await applyCpuThrottle(page);
  await openSet(page, request, code);
  const cold: number[] = [];
  const warm: number[] = [];
  const grading: number[] = [];
  let runNo = 0;
  for (let i = 0; i < code.length; i++) {
    const run = page.getByRole('main').getByRole('button', { name: /^실행/ });
    // The result panel opens on the checks tab; the console tab shows the output.
    await page.getByRole('main').getByRole('tab', { name: '콘솔' }).click();
    for (let r = 0; r < ROUNDS; r++) {
      // Each run prints its own number first, so the previous run's rows never count.
      runNo += 1;
      await replaceCode(page, example(runNo));
      const firstLine: ReadySpec = {
        selector: '.pi-ex-console__entries > li',
        text: `^실행 ${String(runNo)}회`,
      };
      const ms = await timeInteraction(page, firstLine, () => run.click());
      (i === 0 && r === 0 ? cold : warm).push(ms);
      await expect(run).toBeEnabled();
    }
    const submit = page.getByRole('main').getByRole('button', { name: /확실해요|^제출/ });
    grading.push(await timeInteraction(page, FEEDBACK, () => submit.click()));
    await nextItem(page);
  }
  record({
    metric: 'first console line (warm)',
    nfr: 'NFR-02',
    target: TARGETS.firstConsole,
    samples: warm,
  });
  record({
    metric: 'first console line (first run of the page)',
    nfr: 'NFR-02',
    target: TARGETS.firstConsole,
    samples: cold,
  });
  rows.push({
    metric: 'grading with a run (fix_bug)',
    nfr: '(참고)',
    target: TARGETS.grading,
    samples: grading,
    note: '실행 시간 포함, 결정론적 채점 기준 밖',
  });
});

test('infinite loop: UI keeps painting (NFR-03)', async ({ page, request }) => {
  const { code } = pickExercises();
  await addPerfHooks(page);
  await applyCpuThrottle(page);
  await openSet(page, request, code.slice(0, 1));
  await replaceCode(page, 'console.log("start");\nwhile (true) {}\n');
  await page.getByRole('main').getByRole('tab', { name: '콘솔' }).click();
  await startFrameMonitor(page);
  const started = Date.now();
  await page.getByRole('main').getByRole('button', { name: /^실행/ }).click();
  // The runner stops the loop at the time limit and reports it.
  await expect(page.locator('.pi-ex-console__status')).not.toHaveAttribute(
    'data-status',
    'running',
    { timeout: 15_000 },
  );
  await expect(page.locator('.pi-ex-console__status')).not.toHaveText('실행 중');
  const gap = await stopFrameMonitor(page);
  extra['loopStoppedAfterMs'] = Date.now() - started;
  extra['loopStatus'] = await page.locator('.pi-ex-console__status').textContent();
  record({
    metric: 'longest frame gap during an infinite loop',
    nfr: 'NFR-03',
    target: TARGETS.loopFrameGap,
    samples: [gap],
  });
});

test('route transitions (NFR-01, 200 ms)', async ({ page }) => {
  await addPerfHooks(page);
  await applyCpuThrottle(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '대시보드' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: '주 메뉴' });
  const steps: { name: string; ready: ReadySpec; go: () => Promise<void> }[] = [
    {
      name: '대시보드 → 과정',
      ready: heading('과정'),
      go: () => nav.getByRole('link', { name: '과정' }).click(),
    },
    {
      name: '과정 → 과정 상세',
      ready: heading('JavaScript 기초'),
      go: () =>
        page
          .getByRole('link', { name: /JavaScript 기초/ })
          .first()
          .click(),
    },
    {
      name: '과정 상세 → 레슨',
      ready: heading('첫 프로그램'),
      go: () =>
        page
          .getByRole('link', { name: /첫 프로그램/ })
          .first()
          .click(),
    },
    {
      name: '레슨 → 과정 상세',
      ready: heading('JavaScript 기초'),
      go: () => page.getByRole('link', { name: 'JavaScript 기초 과정으로 돌아가기' }).click(),
    },
    {
      name: '과정 상세 → 복습',
      ready: heading('복습'),
      go: () => nav.getByRole('link', { name: '복습' }).click(),
    },
    {
      name: '복습 → 설정',
      ready: heading('화면'),
      go: () => page.getByRole('button', { name: '설정' }).click(),
    },
    {
      name: '설정 → 대시보드',
      ready: heading('대시보드', false),
      go: () => page.getByRole('link', { name: 'ProgInOne 대시보드' }).click(),
    },
  ];
  const cold: Record<string, number> = {};
  const warm: number[] = [];
  const perStep: Record<string, number[]> = {};
  for (let round = 0; round < ROUNDS; round++) {
    for (const step of steps) {
      const ms = await timeInteraction(page, step.ready, step.go).catch((e: unknown) => {
        throw new Error(`${step.name}: ${String(e)}`);
      });
      (perStep[step.name] ??= []).push(Math.round(ms));
      if (round === 0) cold[step.name] = Math.round(ms);
      else warm.push(ms);
    }
  }
  extra['transitionsPerStep'] = perStep;
  record({
    metric: 'route transition (first visit)',
    nfr: 'NFR-01',
    target: TARGETS.transition,
    samples: Object.values(cold),
  });
  record({
    metric: 'route transition (revisit)',
    nfr: 'NFR-01',
    target: TARGETS.transition,
    samples: warm,
  });
});

test('first screen: cold load of the dashboard (NFR-01, 2 s)', async ({ browser }) => {
  const cold: number[] = [];
  const reload: number[] = [];
  const fcp: number[] = [];
  let nav: Awaited<ReturnType<typeof navigationTimings>> | undefined;
  for (let i = 0; i < ROUNDS; i++) {
    // A new context has an empty HTTP cache: the first start of the app in a browser.
    const context = await browser.newContext();
    const page = await context.newPage();
    await addPerfHooks(page, heading('대시보드', false));
    await applyCpuThrottle(page);
    await page.goto('/');
    cold.push(await firstReadyTime(page));
    nav = await navigationTimings(page);
    fcp.push(nav.firstContentfulPaint);
    await page.reload();
    reload.push(await firstReadyTime(page));
    await context.close();
  }
  extra['firstScreenNavigation'] = nav;
  record({
    metric: 'first screen (empty cache)',
    nfr: 'NFR-01',
    target: TARGETS.firstScreen,
    samples: cold,
  });
  record({
    metric: 'first screen (reload)',
    nfr: 'NFR-01',
    target: TARGETS.firstScreen,
    samples: reload,
  });
  rows.push({
    metric: 'first contentful paint (empty cache)',
    nfr: '(참고)',
    target: TARGETS.firstScreen,
    samples: fcp,
  });
});
