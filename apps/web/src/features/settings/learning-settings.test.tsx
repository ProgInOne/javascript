import { SETTINGS_DEFAULTS, type Settings } from '@proginone/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render-app.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  const root = document.documentElement;
  delete root.dataset['theme'];
  delete root.dataset['workbench'];
  root.style.removeProperty('--lesson-font-size');
});

/** A fake settings API that stores PATCHes like the server (`settings` is mutated). */
function settingsApi(initial: Partial<Settings> = {}) {
  const settings: Settings = { ...SETTINGS_DEFAULTS, ...initial };
  return {
    settings,
    handler: (method: string, path: string, body: unknown) => {
      if (path === '/settings') {
        if (method === 'PATCH') Object.assign(settings, body);
        return { body: settings };
      }
      return {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: path, retryable: false } },
      };
    },
  };
}

describe('설정 > 학습 방식', () => {
  it('shows the defaults from the design', async () => {
    const { handler } = settingsApi();
    renderApp('/settings/learning', handler);
    expect(await screen.findByRole('heading', { level: 1, name: '학습 방식' })).toBeVisible();
    expect(await screen.findByRole('checkbox', { name: /확신도 묻기/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /자동 완성/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /튜터 선제 제안/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^기본/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^권장/ })).toBeChecked();
    expect(
      within(screen.getByRole('navigation', { name: '설정 섹션' })).getByRole('link', {
        name: '학습 방식',
      }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('saves each change at once', async () => {
    const user = userEvent.setup();
    const { handler, settings } = settingsApi();
    const { calls } = renderApp('/settings/learning', handler);

    await user.click(await screen.findByRole('checkbox', { name: /자동 완성/ }));
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /자동 완성/ })).toBeChecked();
    });
    await user.click(screen.getByRole('checkbox', { name: /확신도 묻기/ }));
    await user.click(screen.getByRole('radio', { name: /먼저 풀어 보기/ }));
    await user.click(screen.getByRole('radio', { name: /^필수/ }));
    await user.click(screen.getByRole('checkbox', { name: /튜터 선제 제안/ }));

    await waitFor(() => {
      expect(settings).toMatchObject({
        'editor.autocomplete': true,
        'practice.askConfidence': false,
        'hints.policy': 'after-attempt',
        'lesson.predictFirst': 'required',
        'tutor.proactiveSuggestions': false,
      });
    });
    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([
      { 'editor.autocomplete': true },
      { 'practice.askConfidence': false },
      { 'hints.policy': 'after-attempt' },
      { 'lesson.predictFirst': 'required' },
      { 'tutor.proactiveSuggestions': false },
    ]);
  });

  it('reports a failed save', async () => {
    const user = userEvent.setup();
    renderApp('/settings/learning', (method) =>
      method === 'PATCH'
        ? {
            status: 500,
            body: { error: { code: 'INTERNAL', message: '저장 실패', retryable: false } },
          }
        : { body: SETTINGS_DEFAULTS },
    );
    await user.click(await screen.findByRole('checkbox', { name: /자동 완성/ }));
    expect(await screen.findByText('자동 완성 설정을 저장하지 못했어요')).toBeInTheDocument();
  });
});

describe('설정 > 화면', () => {
  it('applies the lesson size and the dark workbench', async () => {
    const user = userEvent.setup();
    const { handler } = settingsApi();
    const { calls } = renderApp('/settings/appearance', handler);

    await user.click(await screen.findByRole('radio', { name: /크게/ }));
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--lesson-font-size')).toBe('1.25rem');
    });
    await user.click(screen.getByRole('radio', { name: /어둡게/ }));
    await waitFor(() => {
      expect(document.documentElement.dataset['workbench']).toBe('dark');
    });
    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([
      { 'lesson.fontSize': 'large' },
      { 'appearance.workbench': 'dark' },
    ]);
  });
});
