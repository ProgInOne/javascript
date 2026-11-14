import { expect, test } from '@playwright/test';

test.describe('app shell', () => {
  test('navigates from the dashboard to settings and back', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: '대시보드' })).toBeVisible();
    await page.getByRole('button', { name: '설정' }).click();
    await expect(page).toHaveURL(/\/settings\/appearance$/);
    // Focus moves to the new page heading (docs/design/ui-ux.md#포커스-관리).
    await expect(page.getByRole('heading', { level: 1, name: '화면' })).toBeFocused();
    await page.getByRole('link', { name: 'ProgInOne 대시보드' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '대시보드' })).toBeVisible();
  });

  test('keeps the chosen theme across reloads without a flash', async ({ page }) => {
    await page.goto('/settings/appearance');
    await page.getByRole('radio', { name: /다크/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    // theme-init.js applies it before the app loads.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('radio', { name: /다크/ })).toBeChecked();
    await page.getByRole('radio', { name: /시스템/ }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });
});

test.describe('backups', () => {
  test('creates a backup and restores it', async ({ page }) => {
    await page.goto('/settings/data');
    const list = page.getByRole('list', { name: '백업 목록' });
    // The server makes a daily + weekly backup on first start; earlier tests or retries may add more.
    await expect(list.getByRole('listitem').first()).toBeVisible();
    const before = await list.getByRole('listitem').count();
    expect(before).toBeGreaterThanOrEqual(2);

    await page.getByRole('button', { name: '지금 백업' }).click();
    // The toast text is also announced in a live region, so take the visible one.
    await expect(page.getByText('백업을 만들었어요').first()).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(before + 1);

    await list.getByRole('listitem').first().getByRole('button', { name: /복원/ }).click();
    const dialog = page.getByRole('dialog', { name: '이 백업으로 복원할까요?' });
    await dialog.getByRole('button', { name: '복원' }).click();
    await expect(page.getByText('복원했어요').first()).toBeVisible();
    // Restore keeps a pre-restore safety copy.
    await expect(list.getByText('복원 전').first()).toBeVisible();
  });
});

test.describe('local server security', () => {
  test('rejects API calls without the session token', async ({ request }) => {
    const res = await request.get('/api/v1/settings');
    expect(res.status()).toBe(401);
    expect((await res.json()) as unknown).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  test('rejects a foreign Host header (DNS rebinding)', async ({ request }) => {
    const res = await request.get('/', { headers: { host: 'evil.example:4391' } });
    expect(res.status()).toBe(403);
  });
});
