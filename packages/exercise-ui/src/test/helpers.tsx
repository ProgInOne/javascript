import { render, type RenderResult } from '@testing-library/react';
import { userEvent, type UserEvent } from '@testing-library/user-event';
import { UiProvider } from '@proginone/ui';
import axe from 'axe-core';
import type { ReactElement } from 'react';

// jsdom has no layout. CodeMirror measures text ranges after rendering; give it empty geometry.
const rangeProto = Range.prototype as Partial<Range>;
rangeProto.getClientRects ??= () => Object.assign([], { item: () => null });
rangeProto.getBoundingClientRect ??= () => new DOMRect();

/** Renders inside UiProvider (tooltips, dialogs) and returns a user-event instance. */
export function renderUi(ui: ReactElement): RenderResult & { user: UserEvent } {
  const user = userEvent.setup();
  return { user, ...render(<UiProvider>{ui}</UiProvider>) };
}

/**
 * axe-core WCAG 2.2 A/AA violations of a subtree (same rules as packages/ui/src/test/axe.ts).
 * Color contrast is skipped: jsdom has no computed colors (covered by check:contrast and e2e).
 */
export async function axeViolations(node: Element): Promise<string[]> {
  const results = await axe.run(node, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations.map((v) => `${v.id}: ${v.help}`);
}
