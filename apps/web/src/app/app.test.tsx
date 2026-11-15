import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render-app.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset['theme'];
});

describe('app shell', () => {
  it('shows the header and the dashboard', async () => {
    renderApp('/', () => ({ body: { theme: 'system' } }));
    // The fake server has no learning data: the dashboard shows its page error.
    expect(await screen.findByRole('heading', { level: 1, name: /대시보드/ })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: '주 메뉴' });
    expect(within(nav).getByRole('link', { name: '대시보드' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: '본문으로 건너뛰기' })).toHaveAttribute(
      'href',
      '#main',
    );
  });

  it('shows a not-found page for unknown routes', async () => {
    renderApp('/nope', () => ({ body: { theme: 'system' } }));
    expect(
      await screen.findByRole('heading', { level: 1, name: '찾는 화면이 없어요' }),
    ).toBeInTheDocument();
  });

  it('redirects /settings to the appearance section', async () => {
    const { router } = renderApp('/settings', () => ({ body: { theme: 'system' } }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings/appearance');
    });
  });
});

describe('설정 > 화면', () => {
  it('applies the stored theme and saves a new one', async () => {
    let theme = 'dark';
    const { calls } = renderApp('/settings/appearance', (method, _path, body) => {
      if (method === 'PATCH') theme = (body as { theme: string }).theme;
      return { body: { theme } };
    });
    const dark = await screen.findByRole('radio', { name: /다크/ });
    expect(dark).toBeChecked();
    await waitFor(() => {
      expect(document.documentElement.dataset['theme']).toBe('dark');
    });

    await userEvent.click(screen.getByRole('radio', { name: /라이트/ }));
    await waitFor(() => {
      expect(document.documentElement.dataset['theme']).toBe('light');
    });
    expect(calls).toContainEqual({ method: 'PATCH', path: '/settings', body: { theme: 'light' } });
  });
});
