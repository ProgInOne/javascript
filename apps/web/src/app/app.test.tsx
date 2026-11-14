import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render-app.tsx';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing element');
  return value;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset['theme'];
});

const backup = (id: string, createdAt: string, kind = 'daily') => ({
  id: `${kind}:${id}`,
  kind,
  createdAt,
  appVersion: '0.0.0',
  schemaMigration: '0000_init',
  sizeBytes: 2_400_000,
});

describe('app shell', () => {
  it('shows the header and the dashboard placeholder', async () => {
    renderApp('/', () => ({ body: { theme: 'system' } }));
    expect(await screen.findByRole('heading', { level: 1, name: '대시보드' })).toBeInTheDocument();
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

describe('설정 > 데이터', () => {
  it('lists backups and restores after confirmation', async () => {
    const list = [
      backup('2026-11-13T091200000Z', '2026-11-13T09:12:00.000Z'),
      backup('b', '2026-11-12T08:40:00.000Z'),
    ];
    const { calls } = renderApp('/settings/data', (method, path) => {
      if (path === '/settings') return { body: { theme: 'system' } };
      if (method === 'POST' && path.endsWith('/restore')) return { body: { restored: list[0] } };
      return { body: { backups: list } };
    });

    const listEl = await screen.findByRole('list', { name: '백업 목록' });
    const items = within(listEl).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(must(items[0])).getByText('일일')).toBeInTheDocument();

    await userEvent.click(within(must(items[0])).getByRole('button', { name: /복원/ }));
    const dialog = await screen.findByRole('dialog', { name: '이 백업으로 복원할까요?' });
    expect(within(dialog).getByText(/복원 직전 상태를 따로 백업해 둘게요/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '복원' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(calls).toContainEqual({
      method: 'POST',
      path: `/backups/${encodeURIComponent('daily:2026-11-13T091200000Z')}/restore`,
      body: undefined,
    });
    expect(await screen.findByText('복원했어요')).toBeInTheDocument();
  });

  it('creates a manual backup', async () => {
    const { calls } = renderApp('/settings/data', (method, path) => {
      if (path === '/settings') return { body: { theme: 'system' } };
      if (method === 'POST')
        return { status: 201, body: backup('m', '2026-11-14T00:00:00.000Z', 'manual') };
      return { body: { backups: [] } };
    });
    expect(await screen.findByText('아직 백업이 없어요')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '지금 백업' }));
    expect(await screen.findByText('백업을 만들었어요')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/backups')).toHaveLength(1);
  });

  it('shows an inline error when the list fails', async () => {
    renderApp('/settings/data', (_method, path) =>
      path === '/settings'
        ? { body: { theme: 'system' } }
        : {
            status: 500,
            body: { error: { code: 'INTERNAL', message: '예기치 않은 오류', retryable: false } },
          },
    );
    expect(await screen.findByText('백업 목록을 불러오지 못했어요')).toBeInTheDocument();
  });
});
