import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render-app.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing element');
  return value;
}

const backup = (
  id: string,
  createdAt: string,
  kind = 'daily',
  schema = '0005_session_summaries',
) => ({
  id: `${kind}:${id}`,
  kind,
  createdAt,
  appVersion: '0.2.0',
  schemaMigration: schema,
  sizeBytes: 2_400_000,
});

const LOCATION = {
  path: '/data/backups',
  defaultPath: '/data/backups',
  source: 'default',
  editable: true,
  cloudSynced: false,
};

const LIST = [
  backup('2026-11-13T091200000Z', '2026-11-13T09:12:00.000Z'),
  backup('b', '2026-11-12T08:40:00.000Z', 'pre-migration', '0004_goals'),
];

interface Reply {
  status?: number;
  body: unknown;
}
type Route = (method: string, path: string, body: unknown) => Reply | undefined;

/** Fake API for 설정 > 데이터; `route` overrides individual calls. */
function renderData(route: Route = () => undefined) {
  return renderApp('/settings/data', (method, path, body) => {
    const custom = route(method, path, body);
    if (custom) return custom;
    if (path === '/settings') return { body: { theme: 'system' } };
    if (path === '/backups/location') return { body: LOCATION };
    if (path.endsWith('/check')) {
      const id = decodeURIComponent(path.split('/')[2] ?? '');
      return { body: { id, ok: true, problem: null, migrationNeeded: false } };
    }
    if (path === '/backups') return { body: { backups: LIST } };
    if (path === '/learner')
      return {
        body: { experienceLevel: 'none', onboardedAt: null, needsOnboarding: true },
      };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: path, retryable: false } } };
  });
}

describe('설정 > 데이터: 백업', () => {
  it('lists backups with kind, app and schema version', async () => {
    renderData();
    const list = await screen.findByRole('list', { name: '백업 목록' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(must(items[0])).getByText('일일')).toBeInTheDocument();
    expect(within(must(items[0])).getByText('v0.2.0 · DB 0005')).toBeInTheDocument();
    expect(within(must(items[1])).getByText('업데이트 전')).toBeInTheDocument();
    expect(await screen.findByTestId('backup-location')).toHaveTextContent('/data/backups');
  });

  it('checks the file, then restores after confirmation', async () => {
    const { calls } = renderData((method, path) => {
      if (path.endsWith('/check'))
        return {
          body: { id: LIST[1]?.id, ok: true, problem: null, migrationNeeded: true },
        };
      if (method === 'POST' && path.endsWith('/restore')) return { body: { restored: LIST[1] } };
      return undefined;
    });
    const list = await screen.findByRole('list', { name: '백업 목록' });
    await userEvent.click(
      within(must(within(list).getAllByRole('listitem')[1])).getByRole('button', { name: /복원/ }),
    );
    const dialog = await screen.findByRole('dialog', { name: '이 백업으로 복원할까요?' });
    expect(within(dialog).getByText(/복원 직전 상태를 따로 백업해 둘게요/)).toBeInTheDocument();
    expect(await within(dialog).findByText(/데이터 형식을 지금 버전에 맞게 바꿔요/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: '복원' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(calls).toContainEqual({
      method: 'POST',
      path: `/backups/${encodeURIComponent('pre-migration:b')}/restore`,
      body: undefined,
    });
    expect(await screen.findByText('복원했어요')).toBeInTheDocument();
  });

  it('keeps restore off for a damaged backup', async () => {
    const { calls } = renderData((_method, path) =>
      path.endsWith('/check')
        ? { body: { id: LIST[0]?.id, ok: false, problem: 'integrity', migrationNeeded: false } }
        : undefined,
    );
    const list = await screen.findByRole('list', { name: '백업 목록' });
    await userEvent.click(
      within(must(within(list).getAllByRole('listitem')[0])).getByRole('button', { name: /복원/ }),
    );
    const dialog = await screen.findByRole('dialog', { name: '이 백업으로 복원할까요?' });
    expect(await within(dialog).findByText(/백업 파일이 손상되어 열 수 없어요/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '복원' })).toBeDisabled();
    expect(calls.some((c) => c.path.endsWith('/restore'))).toBe(false);
  });

  it('creates a manual backup', async () => {
    const { calls } = renderData((method, path) => {
      if (path === '/backups' && method === 'POST')
        return { status: 201, body: backup('m', '2026-11-14T00:00:00.000Z', 'manual') };
      if (path === '/backups') return { body: { backups: [] } };
      return undefined;
    });
    expect(await screen.findByText('아직 백업이 없어요')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '지금 백업' }));
    expect(await screen.findByText('백업을 만들었어요')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/backups')).toHaveLength(1);
  });

  it('shows an inline error when the list fails', async () => {
    renderData((_method, path) =>
      path === '/backups'
        ? {
            status: 500,
            body: { error: { code: 'INTERNAL', message: '예기치 않은 오류', retryable: false } },
          }
        : undefined,
    );
    expect(await screen.findByText('백업 목록을 불러오지 못했어요')).toBeInTheDocument();
  });
});

describe('설정 > 데이터: 백업 위치', () => {
  it('changes the folder and tells where the old backups are', async () => {
    let location = LOCATION;
    const { calls } = renderData((method, path, body) => {
      if (path !== '/backups/location') return undefined;
      if (method === 'PUT') {
        location = { ...LOCATION, path: (body as { path: string }).path, source: 'config' };
        return {
          body: {
            location,
            previousPath: '/data/backups',
            backup: backup('n', '2026-11-15T00:00:00.000Z', 'manual'),
          },
        };
      }
      return { body: location };
    });
    await userEvent.click(await screen.findByRole('button', { name: '변경' }));
    const dialog = await screen.findByRole('dialog', { name: '백업 위치 바꾸기' });
    const input = within(dialog).getByRole('textbox', { name: '폴더 경로' });
    expect(input).toHaveValue('/data/backups');
    await userEvent.clear(input);
    await userEvent.type(input, '/Users/me/Dropbox/ProgInOne');
    // Cloud folders get the privacy notice before saving.
    expect(within(dialog).getByText(/대화 원문이 포함돼요/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '바꾸기' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(calls).toContainEqual({
      method: 'PUT',
      path: '/backups/location',
      body: { path: '/Users/me/Dropbox/ProgInOne' },
    });
    expect(await screen.findByText(/이전 위치의 백업은 그대로 남아 있어요/)).toBeInTheDocument();
    expect(await screen.findByTestId('backup-location')).toHaveTextContent(
      '/Users/me/Dropbox/ProgInOne',
    );
  });

  it('shows the server reason inside the dialog', async () => {
    renderData((method, path) =>
      method === 'PUT' && path === '/backups/location'
        ? {
            status: 400,
            body: {
              error: {
                code: 'BACKUP_LOCATION_INVALID',
                message: '비어 있는 폴더나 기존 ProgInOne 백업 폴더를 고르세요.',
                retryable: false,
                details: { reason: 'not-empty' },
              },
            },
          }
        : undefined,
    );
    await userEvent.click(await screen.findByRole('button', { name: '변경' }));
    const dialog = await screen.findByRole('dialog', { name: '백업 위치 바꾸기' });
    await userEvent.click(within(dialog).getByRole('button', { name: '바꾸기' }));
    const input = within(dialog).getByRole('textbox', { name: '폴더 경로' });
    await waitFor(() => {
      expect(input).toHaveAccessibleDescription(/기존 ProgInOne 백업 폴더를 고르세요/);
    });
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('cannot change a folder fixed by the environment', async () => {
    renderData((_method, path) =>
      path === '/backups/location'
        ? { body: { ...LOCATION, source: 'env', editable: false } }
        : undefined,
    );
    const button = await screen.findByRole('button', { name: '변경' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('설정 > 데이터: 학습 데이터 초기화', () => {
  it('enables the button only after typing 초기화, then goes to onboarding', async () => {
    const { calls, router } = renderData((method, path) =>
      method === 'POST' && path === '/data/reset'
        ? { body: { backup: backup('r', '2026-11-15T01:00:00.000Z', 'pre-reset') } }
        : undefined,
    );
    const region = await screen.findByRole('region', { name: '학습 데이터 초기화' });
    const button = within(region).getByRole('button', { name: '학습 데이터 초기화' });
    expect(button).toBeDisabled();
    const input = within(region).getByRole('textbox', { name: /"초기화"를 입력하세요/ });
    await userEvent.type(input, '초기');
    expect(button).toBeDisabled();
    await userEvent.type(input, '화');
    expect(button).toBeEnabled();
    await userEvent.click(button);

    expect(calls).toContainEqual({
      method: 'POST',
      path: '/data/reset',
      body: { confirm: '초기화' },
    });
    expect(await screen.findByText('학습 데이터를 초기화했어요')).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding');
    });
  });

  it('reports a failed reset and stays', async () => {
    const { router } = renderData((method, path) =>
      method === 'POST' && path === '/data/reset'
        ? {
            status: 500,
            body: {
              error: {
                code: 'BACKUP_FAILED',
                message: '백업을 만들지 못했습니다.',
                retryable: false,
              },
            },
          }
        : undefined,
    );
    const region = await screen.findByRole('region', { name: '학습 데이터 초기화' });
    await userEvent.type(within(region).getByRole('textbox'), '초기화');
    await userEvent.click(within(region).getByRole('button', { name: '학습 데이터 초기화' }));
    expect(await screen.findByText('초기화하지 못했어요')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings/data');
  });
});
