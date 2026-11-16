import { UiProvider } from '@proginone/ui';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { openShortcutHelp, SHORTCUT_GROUPS, ShortcutHelp } from './ShortcutHelp.tsx';

function renderHelp() {
  const user = userEvent.setup();
  render(
    <UiProvider>
      <label>
        메모
        <textarea />
      </label>
      <ShortcutHelp />
    </UiProvider>,
  );
  return user;
}

describe('ShortcutHelp', () => {
  it('opens with ? outside text fields and lists the shortcuts with the platform modifier', async () => {
    const user = renderHelp();
    await user.type(screen.getByRole('textbox', { name: '메모' }), '?');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('?');
    const dialog = await screen.findByRole('dialog', { name: '단축키' });
    expect(within(dialog).getByRole('heading', { name: '문제' })).toBeVisible();
    expect(within(dialog).getByText('제출 (확신도 "확실해요")')).toBeVisible();
    expect(within(dialog).getByText('다음 힌트')).toBeVisible();
    expect(within(dialog).getByText(/튜터 열기·닫기/)).toBeVisible();
    // jsdom is not an Apple platform: Ctrl, never ⌘.
    expect(within(dialog).getAllByText('Ctrl').length).toBeGreaterThan(3);
    expect(within(dialog).queryByText('⌘')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '닫기' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('opens from the learning header button event', async () => {
    renderHelp();
    act(() => {
      openShortcutHelp();
    });
    expect(await screen.findByRole('dialog', { name: '단축키' })).toBeVisible();
  });

  it('lists only shortcuts that exist (no command palette yet)', () => {
    const actions = SHORTCUT_GROUPS.flatMap((g) => g.items.map((i) => i.action)).join(' ');
    expect(actions).not.toMatch(/팔레트/);
    expect(actions).toMatch(/레슨 예제 실행/);
  });
});
