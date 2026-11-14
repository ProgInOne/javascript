import { expect, test } from '@playwright/test';
import { openScreen, SCREENS } from './fixtures.ts';

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

// Baselines are generated in the Playwright Docker image: `pnpm test:e2e:visual --update`.
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

for (const viewport of VIEWPORTS) {
  for (const scheme of ['light', 'dark'] as const) {
    for (const { path, heading } of SCREENS) {
      const slug =
        path === '/' ? 'dashboard' : path.slice(1).replaceAll('/', '-').replaceAll('.', '_');
      const name = `${slug}-${scheme}-${viewport.width}`;
      test(`${name} @visual`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.route('**/api/v1/backups', (route) => route.fulfill({ json: BACKUPS }));
        await openScreen(page, path, heading, scheme);
        await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
      });
    }
  }
}
