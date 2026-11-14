import axe from 'axe-core';

/**
 * Runs axe-core (WCAG 2.2 A/AA rules) on a rendered subtree and returns violation ids.
 * Color contrast is skipped: jsdom has no layout or computed colors; token contrast
 * is covered by `pnpm check:contrast` and browser checks by the e2e suite.
 */
export async function axeViolations(node: Element): Promise<string[]> {
  const results = await axe.run(node, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations.map((v) => `${v.id}: ${v.help}`);
}
