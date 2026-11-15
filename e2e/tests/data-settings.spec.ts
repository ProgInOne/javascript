import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * 설정 > 데이터 against a real server of its own (playwright.config.ts `E2E_DATA_SETTINGS_URL`):
 * backup → change → restore, the learning data reset, and the backup folder change. These rewrite
 * the whole learner, so they never run on the main server.
 */

const URL = process.env['E2E_DATA_SETTINGS_URL'] ?? '';
const DATA_DIR = process.env['E2E_DATA_SETTINGS_DIR'] ?? '';

test.use({ baseURL: URL });
test.describe.configure({ mode: 'serial' });

interface Api {
  get: (path: string) => Promise<unknown>;
  send: (method: 'POST' | 'PUT' | 'PATCH', path: string, data?: unknown) => Promise<unknown>;
}

async function apiFor(page: Page, request: APIRequestContext): Promise<Api> {
  await page.goto('/settings/appearance');
  const token = (await page.locator('meta[name="proginone-token"]').getAttribute('content')) ?? '';
  const headers = { 'x-proginone-token': token };
  const check = async (res: Awaited<ReturnType<APIRequestContext['get']>>) => {
    expect(res.ok(), `${res.url()} → ${String(res.status())} ${await res.text()}`).toBe(true);
    return await res.json();
  };
  return {
    get: async (path) => check(await request.get(`${URL}/api/v1${path}`, { headers })),
    send: async (method, path, data = {}) =>
      check(await request.fetch(`${URL}/api/v1${path}`, { method, headers, data })),
  };
}

const dailyMinutes = async (api: Api) =>
  ((await api.get('/goals')) as { goal: { dailyMinutes: number } }).goal.dailyMinutes;
const needsOnboarding = async (api: Api) =>
  ((await api.get('/learner')) as { needsOnboarding: boolean }).needsOnboarding;

/** A learner who finished onboarding with a 45-minute goal and one lesson read. */
async function seedLearner(api: Api) {
  await api.send('PATCH', '/learner', { onboarded: true, experienceLevel: 'some' });
  await api.send('PUT', '/goals', { dailyMinutes: 45, weeklyDays: 5 });
  await api.send('POST', '/lessons/js-basics.start.first-program/progress', { readProgress: 1 });
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const backupList = (page: Page) => page.getByRole('list', { name: '백업 목록' });

async function restoreFirst(page: Page, kind: string) {
  const row = backupList(page).getByRole('listitem').filter({ hasText: kind }).first();
  await row.getByRole('button', { name: /복원/ }).click();
  const dialog = page.getByRole('dialog', { name: '이 백업으로 복원할까요?' });
  // The server checks the file before the button turns on.
  await expect(dialog.getByText('파일을 확인했어요', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: '복원' }).click();
  await expect(page.getByText('복원했어요').first()).toBeVisible();
  await expect(dialog).toBeHidden();
}

test('backup → change → restore brings the data back', async ({ page, request }) => {
  const api = await apiFor(page, request);
  await seedLearner(api);

  await page.goto('/settings/data');
  // The server makes a daily + weekly backup on first start; a retry may have added more.
  await expect(backupList(page).getByRole('listitem').first()).toBeVisible();
  const manual = backupList(page).getByRole('listitem').filter({ hasText: '수동' });
  const before = await manual.count();
  await page.getByRole('button', { name: '지금 백업' }).click();
  await expect(page.getByText('백업을 만들었어요').first()).toBeVisible();
  await expect(manual).toHaveCount(before + 1);
  await expect(manual.first()).toContainText(/v\d+\.\d+\.\d+ · DB \d{4}/);

  // Change the data after the backup.
  await api.send('PUT', '/goals', { dailyMinutes: 60, weeklyDays: 3 });
  expect(await dailyMinutes(api)).toBe(60);

  await page.reload();
  await restoreFirst(page, '수동');
  // A safety copy of the state before the restore.
  await expect(backupList(page).getByText('복원 전').first()).toBeVisible();

  expect(await dailyMinutes(api)).toBe(45);
  await page.goto('/settings/goals');
  await expect(page.getByRole('radio', { name: '45분' })).toBeChecked();
  await expect(page.getByRole('radio', { name: '5일' })).toBeChecked();
});

test('resetting learning data starts over at onboarding, and the pre-reset backup undoes it', async ({
  page,
  request,
}) => {
  const api = await apiFor(page, request);
  expect(await needsOnboarding(api)).toBe(false);

  await page.goto('/settings/data');
  const reset = page.getByRole('region', { name: '학습 데이터 초기화' });
  const button = reset.getByRole('button', { name: '학습 데이터 초기화' });
  await expect(button).toBeDisabled();
  await reset.getByRole('textbox', { name: /"초기화"를 입력하세요/ }).fill('초기화');
  await expect(button).toBeEnabled();
  await button.click();

  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByText('학습 데이터를 초기화했어요').first()).toBeVisible();
  // Only true without onboarding and without any lesson progress, attempt or goal.
  expect(await needsOnboarding(api)).toBe(true);
  // Settings survive a reset.
  await api.send('PATCH', '/settings', { theme: 'dark' });

  await page.goto('/settings/data');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await restoreFirst(page, '초기화 전');
  expect(await needsOnboarding(api)).toBe(false);
  expect(await dailyMinutes(api)).toBe(45);
  await api.send('PATCH', '/settings', { theme: 'system' });
});

test('moves new backups to another folder and back', async ({ page }) => {
  const target = join(mkdtempSync(join(tmpdir(), 'proginone-e2e-backup-target-')), 'backups');
  await page.goto('/settings/data');
  const location = page.getByTestId('backup-location');
  // The default folder (shown by its real path once it was chosen again, e.g. on a retry).
  const defaultDir = join(DATA_DIR, 'backups');
  await expect(location).toHaveText(
    new RegExp(`^(${escape(defaultDir)}|${escape(realpathSync(defaultDir))})$`),
  );

  const change = async (path: string) => {
    await page.getByRole('button', { name: '변경' }).click();
    const dialog = page.getByRole('dialog', { name: '백업 위치 바꾸기' });
    await dialog.getByRole('textbox', { name: '폴더 경로' }).fill(path);
    await dialog.getByRole('button', { name: '바꾸기' }).click();
    return dialog;
  };

  // Untrusted input is refused with the reason, and nothing changes.
  const dialog = await change('relative/backups');
  await expect(dialog.getByText(/전체 경로를 입력하세요\. 예:/)).toBeVisible();
  await dialog.getByRole('button', { name: '취소' }).click();

  await change(target);
  await expect(page.getByText('백업 위치를 바꿨어요').first()).toBeVisible();
  // Symlinked temp folders (macOS /var) are shown by their real path.
  await expect(location).toHaveText(join(realpathSync(join(target, '..')), 'backups'));
  await expect(page.getByText('이전 위치의 백업은 그대로 남아 있어요')).toBeVisible();
  // Only the proof backup is in the new folder.
  await expect(backupList(page).getByRole('listitem')).toHaveCount(1);
  await expect(backupList(page).getByRole('listitem')).toContainText('수동');

  await change(join(DATA_DIR, 'backups'));
  await expect(location).toHaveText(realpathSync(join(DATA_DIR, 'backups')));
  await expect(backupList(page).getByText('초기화 전').first()).toBeVisible();
});
