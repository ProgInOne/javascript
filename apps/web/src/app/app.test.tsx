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
    // Logo (D-079): named by its image, not by the decorative "progınone" text.
    expect(screen.getByRole('link', { name: 'ProgInOne 대시보드' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('img', { name: 'ProgInOne 대시보드' })).toBeInTheDocument();
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

describe('header theme switch (D-078)', () => {
  const darkOs = (dark: boolean) => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: dark && query === '(prefers-color-scheme: dark)',
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
  };

  it('switches light ↔ dark at once and saves it', async () => {
    let theme = 'light';
    const { calls } = renderApp('/', (method, path, body) => {
      if (path !== '/settings') return { status: 404, body: {} };
      if (method === 'PATCH') theme = (body as { theme: string }).theme;
      return { body: { theme } };
    });
    const toDark = await screen.findByRole('button', { name: '다크 테마로 바꾸기' });
    await waitFor(() => {
      expect(toDark).toBeEnabled();
    });
    await userEvent.click(toDark);
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(calls).toContainEqual({ method: 'PATCH', path: '/settings', body: { theme: 'dark' } });
    await userEvent.click(await screen.findByRole('button', { name: '라이트 테마로 바꾸기' }));
    await waitFor(() => {
      expect(document.documentElement.dataset['theme']).toBe('light');
    });
    expect(calls).toContainEqual({ method: 'PATCH', path: '/settings', body: { theme: 'light' } });
  });

  it('turns "system" into the opposite of what the OS shows', async () => {
    darkOs(true);
    const { calls } = renderApp('/', (_method, path, body) =>
      path === '/settings'
        ? { body: { theme: (body as { theme?: string } | undefined)?.theme ?? 'system' } }
        : { status: 404, body: {} },
    );
    const toLight = await screen.findByRole('button', { name: '라이트 테마로 바꾸기' });
    await waitFor(() => {
      expect(toLight).toBeEnabled();
    });
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    await userEvent.click(toLight);
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(calls).toContainEqual({ method: 'PATCH', path: '/settings', body: { theme: 'light' } });
  });

  it('puts the theme back and says so when saving fails', async () => {
    renderApp('/', (method, path) =>
      path !== '/settings'
        ? { status: 404, body: {} }
        : method === 'PATCH'
          ? { status: 500, body: { error: { code: 'INTERNAL', message: '오류', retryable: true } } }
          : { body: { theme: 'light' } },
    );
    const toDark = await screen.findByRole('button', { name: '다크 테마로 바꾸기' });
    await waitFor(() => {
      expect(toDark).toBeEnabled();
    });
    await userEvent.click(toDark);
    expect((await screen.findAllByText('테마를 바꾸지 못했어요')).length).toBeGreaterThan(0);
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(screen.getByRole('button', { name: '다크 테마로 바꾸기' })).toBeInTheDocument();
  });

  it('is also a row of the narrow-screen menu', async () => {
    darkOs(false);
    renderApp('/', (_method, path, body) =>
      path === '/settings'
        ? { body: { theme: (body as { theme?: string } | undefined)?.theme ?? 'dark' } }
        : { status: 404, body: {} },
    );
    await userEvent.click(await screen.findByRole('button', { name: '메뉴' }));
    const menu = screen.getAllByRole('navigation', { name: '주 메뉴' }).at(-1);
    if (!menu) throw new Error('no menu');
    const row = await within(menu).findByRole('button', { name: '라이트 테마로 바꾸기' });
    await waitFor(() => {
      expect(row).toBeEnabled();
    });
    await userEvent.click(row);
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
});
