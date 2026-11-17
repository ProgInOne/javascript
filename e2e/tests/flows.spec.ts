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

  test('switches the theme from the header and keeps it (D-078)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: '대시보드' })).toBeVisible();
    // The learner follows the OS (onboarded.setup.ts), which is light: the switch offers dark.
    await page.getByRole('button', { name: '다크 테마로 바꾸기' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: '라이트 테마로 바꾸기' })).toBeVisible();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: '설정' }).click();
    await expect(page.getByRole('radio', { name: /다크/ })).toBeChecked();

    // The learning screen has the switch too.
    await page.goto('/learn/js-basics.start.first-program');
    await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램' })).toBeVisible();
    await page.getByRole('button', { name: '라이트 테마로 바꾸기' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Back to following the OS for the other specs.
    await page.goto('/settings/appearance');
    await expect(page.getByRole('radio', { name: /라이트/ })).toBeChecked();
    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/settings') && r.request().method() === 'PATCH',
    );
    await page.getByRole('radio', { name: /시스템/ }).click();
    await saved;
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

test.describe('curriculum', () => {
  test('reads a lesson from the course list', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: '주 메뉴' })
      .getByRole('link', { name: '과정' })
      .click();
    await page.getByRole('link', { name: /JavaScript 기초/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'JavaScript 기초' })).toBeVisible();
    await page.getByRole('link', { name: '학습 시작' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '첫 프로그램' })).toBeFocused();
    await expect(page.getByRole('region', { name: '흔한 실수' })).toContainText(
      '출력한 값은 어딘가에 저장된다.',
    );
    await page
      .getByRole('navigation', { name: '목차' })
      .getByRole('link', { name: '핵심 요약' })
      .click();
    await expect(page).toHaveURL(/#summary$/);
    await page.getByRole('link', { name: 'JavaScript 기초 과정으로 돌아가기' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'JavaScript 기초' })).toBeVisible();
  });
});
