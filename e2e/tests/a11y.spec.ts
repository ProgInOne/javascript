import { test } from '@playwright/test';
import { expectNoA11yViolations, openScreen, SCREENS } from './fixtures.ts';

for (const scheme of ['light', 'dark'] as const) {
  for (const { path, heading } of SCREENS) {
    test(`${path} has no WCAG 2.2 AA violations (${scheme})`, async ({ page }) => {
      await openScreen(page, path, heading, scheme);
      await expectNoA11yViolations(page);
    });
  }
}
