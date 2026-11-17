import { expect, test as setup, type APIRequestContext, type Page } from '@playwright/test';

/** PATCHes the learner of the server `page` is on, with the token from its page. */
async function patch(page: Page, request: APIRequestContext, path: string, data: object) {
  const token = await page.locator('meta[name="proginone-token"]').getAttribute('content');
  const res = await request.patch(new URL(`/api/v1${path}`, page.url()).href, {
    headers: { 'x-proginone-token': token ?? '' },
    data,
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as unknown;
}

// The main E2E server's learner has finished onboarding, so every other test opens the dashboard
// and its screens directly. The first-run flow runs on its own server (journey.spec.ts).
setup('main learner finished onboarding', async ({ page, request }) => {
  await page.goto('/settings/appearance');
  expect(await patch(page, request, '/learner', { onboarded: true })).toMatchObject({
    needsOnboarding: false,
  });
  // The light/dark checks and screenshots pick the scheme with `emulateMedia`, so the main and the
  // journey learners follow the OS (`system`) instead of the light default (D-078).
  await patch(page, request, '/settings', { theme: 'system' });
});

setup('journey learner follows the OS theme', async ({ page, request }) => {
  // A new learner sees the light default even on a dark OS, from the first paint on (D-078).
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${process.env['E2E_JOURNEY_URL'] ?? ''}/onboarding`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await patch(page, request, '/settings', { theme: 'system' });
});
