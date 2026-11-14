import { expect, test as setup } from '@playwright/test';

// The main E2E server's learner has finished onboarding, so every other test opens the dashboard
// and its screens directly. The first-run flow runs on its own server (journey.spec.ts).
setup('main learner finished onboarding', async ({ page, request }) => {
  await page.goto('/settings/appearance');
  const token = await page.locator('meta[name="proginone-token"]').getAttribute('content');
  const res = await request.patch('/api/v1/learner', {
    headers: { 'x-proginone-token': token ?? '' },
    data: { onboarded: true },
  });
  expect(res.ok()).toBe(true);
  expect((await res.json()) as unknown).toMatchObject({ needsOnboarding: false });
});
