import { expect, test } from '@playwright/test';

/**
 * Core flow of an installed ProgInOne with its real content pack: local server security,
 * onboarding state, course → lesson, a real code run in the sandbox and its grading, backups.
 * Uses one exercise of the real pack (`js-basics.start.first-program.fix-quoted-total`).
 */

const EXERCISE = 'js-basics.start.first-program.fix-quoted-total';

test.describe.configure({ mode: 'serial' });

test('the API refuses requests without the session token', async ({ request }) => {
  const res = await request.get('/api/v1/settings');
  expect(res.status()).toBe(401);
});

test('core flow on the real content pack', async ({ page, request }) => {
  await page.goto('/');
  const token = (await page.locator('meta[name="proginone-token"]').getAttribute('content')) ?? '';
  const headers = { 'x-proginone-token': token };
  // A fresh install starts with onboarding; the smoke test skips it.
  const learner = await request.patch('/api/v1/learner', { headers, data: { onboarded: true } });
  expect(learner.ok()).toBe(true);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '대시보드' })).toBeVisible();

  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('link', { name: '과정' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: '과정' })).toBeVisible();
  for (const course of ['HTML', 'CSS', 'JavaScript 기초']) {
    await expect(page.getByRole('link', { name: new RegExp(course) }).first()).toBeVisible();
  }
  await page
    .getByRole('link', { name: /JavaScript 기초/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'JavaScript 기초' })).toBeVisible();
  await page
    .getByRole('link', { name: /첫 프로그램/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램' })).toBeVisible();

  // A real run in the sandbox (per-shell *.localhost site or the same-site fallback).
  const created = await request.post('/api/v1/practice-sets', {
    headers,
    data: { kind: 'extra', exerciseIds: [EXERCISE] },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const set = (await created.json()) as { id: string };
  await page.goto(`/review/session/${set.id}?i=1`);
  const main = page.getByRole('main');
  await main.getByRole('tab', { name: '콘솔' }).click();
  await main.getByRole('button', { name: /^실행/ }).click();
  await expect(main.locator('.pi-ex-console__entries')).toContainText('김밥 2줄', {
    timeout: 15_000,
  });
  await main.getByRole('button', { name: /확실해요|^제출/ }).click();
  // The buggy starter code prints the expression as text, so the grade is "not correct".
  await expect(main.getByRole('heading', { name: '정답이 아니에요.' })).toBeVisible({
    timeout: 15_000,
  });

  // In-app navigation: with Fission on, Playwright's Firefox does not finish a full page load
  // that leaves the runner's out-of-process frames (compatibility review).
  await page.getByRole('button', { name: '설정' }).click();
  await page.getByRole('link', { name: '데이터' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '데이터' })).toBeVisible();
  const backups = page.getByRole('list', { name: '백업 목록' });
  await expect(backups.getByRole('listitem').first()).toBeVisible();
});
