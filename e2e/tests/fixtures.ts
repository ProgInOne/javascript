import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const SCREENS = [
  { path: '/', heading: '대시보드' },
  { path: '/settings/ai', heading: 'AI' },
  { path: '/settings/learning', heading: '학습 방식' },
  { path: '/settings/appearance', heading: '화면' },
  { path: '/settings/data', heading: '데이터' },
  { path: '/settings/goals', heading: '학습 목표' },
  { path: '/courses', heading: '과정' },
  { path: '/review', heading: '복습' },
  { path: '/courses/js-basics', heading: 'JavaScript 기초' },
  { path: '/learn/js-basics.start.first-program', heading: '첫 프로그램' },
] as const;

export type ColorScheme = 'light' | 'dark';

/** Opens a screen with an explicit theme and waits until it has rendered its h1. */
export async function openScreen(page: Page, path: string, heading: string, scheme: ColorScheme) {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  // The header AI status arrives over /ai/events; wait for it so screenshots are stable.
  await expect(page.locator('[data-ai-state]').first()).not.toHaveAttribute(
    'data-ai-state',
    'loading',
  );
  await page.evaluate(() => document.fonts.ready);
}

/** WCAG 2.2 A/AA in a real browser (contrast included, unlike jsdom). */
export async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}
