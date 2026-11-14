import type { AIStatus, AIStatusResponse, AIUsage } from '@proginone/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render-app.tsx';
import { controlledSse } from '../../test/sse.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const snapshot = (status: AIStatus, over: Partial<AIStatusResponse> = {}): AIStatusResponse => ({
  provider: 'codex',
  status,
  usage: null,
  pendingLogin: null,
  ...over,
});

const notFound = {
  status: 404,
  body: { error: { code: 'NOT_FOUND', message: '없음', retryable: false } },
};

/** Fake `/ai/*` API: `status` answers GET /ai/status; the events stream is controlled by the test. */
function aiApi(initial: AIStatusResponse) {
  const events = controlledSse();
  let status = initial;
  const handler = (method: string, path: string) => {
    if (path === '/settings') return { body: { theme: 'system' } };
    if (path === '/dashboard') return notFound;
    if (path === '/ai/events') return events.response;
    if (path === '/ai/status') return { body: status };
    if (path === '/ai/models') {
      return {
        body: {
          models: [
            {
              id: 'gpt-x',
              displayName: 'GPT X',
              description: '빠른 모델',
              isDefault: true,
              supportedEfforts: ['medium'],
            },
          ],
        },
      };
    }
    if (method === 'POST' && path === '/ai/login') {
      return { body: { loginId: 'login-1', authUrl: 'https://auth.example/login' } };
    }
    if (method === 'POST' && path === '/ai/login/cancel') {
      status = snapshot({ state: 'logged_out' });
      return { body: status };
    }
    if (method === 'POST' && path === '/ai/logout') {
      status = snapshot({ state: 'logged_out' });
      return { body: status };
    }
    if (method === 'POST' && path === '/ai/reconnect') return { body: status };
    return notFound;
  };
  return {
    handler,
    events,
    setStatus: (next: AIStatusResponse) => {
      status = next;
    },
  };
}

const usage: AIUsage = {
  windows: [
    { id: 'primary', usedPercent: 85, windowDurationMins: 300, resetsAt: null },
    { id: 'secondary', usedPercent: 100, windowDurationMins: 10_080, resetsAt: null },
  ],
  highestUsedPercent: 100,
  updatedAt: 1,
};

describe('settings AI section', () => {
  it('shows the connection with the plan only, provider usage bars and models', async () => {
    const api = aiApi(snapshot({ state: 'ready', planType: 'pro' }, { usage }));
    const { calls } = renderApp('/settings/ai', api.handler);

    expect(await screen.findByText('연결됨 · ChatGPT Pro')).toBeVisible();
    // Opening the section is the lazy-start trigger.
    expect(calls.some((c) => c.path === '/ai/status')).toBe(true);

    const bars = screen.getAllByRole('progressbar');
    expect(bars.map((b) => b.getAttribute('aria-label'))).toEqual([
      '5시간 한도 사용량',
      '주간 한도 사용량',
    ]);
    expect(screen.getByText('85%')).toBeVisible();
    expect(screen.getByText('100% · 한도 도달')).toBeVisible();
    expect(screen.getByText(/튜터 대화만 쓸 수 있어요/)).toBeVisible();
    expect(
      screen.getByText(/한도 도달/, { selector: '.ai-usage__value' }).closest('li'),
    ).toHaveAttribute('data-level', 'full');
    expect(await screen.findByText('GPT X')).toBeVisible();
    expect(screen.getByText('(기본)')).toBeVisible();
  });

  it('logs in through a new tab and closes the dialog on the login event', async () => {
    const user = userEvent.setup();
    const tab = { opener: {}, closed: false, location: { href: '' }, close: vi.fn() };
    const open = vi.fn(() => tab);
    vi.stubGlobal('open', open);
    const api = aiApi(snapshot({ state: 'logged_out' }));
    renderApp('/settings/ai', api.handler);

    expect(await screen.findByText(/ChatGPT 계정을 연결해 주세요/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'ChatGPT로 연결' }));

    const dialog = await screen.findByRole('dialog', { name: 'ChatGPT 로그인' });
    expect(within(dialog).getByText('브라우저에서 로그인을 마쳐 주세요.')).toBeVisible();
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe('https://auth.example/login');
    expect(within(dialog).getByRole('link', { name: /로그인 페이지 열기/ })).toHaveAttribute(
      'href',
      'https://auth.example/login',
    );

    api.events.send('login', { loginId: 'login-1', success: true, error: null });
    api.events.send('status', snapshot({ state: 'ready', planType: 'plus' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await screen.findByText('AI 튜터를 연결했어요')).toBeVisible();
    expect(await screen.findByText('연결됨 · ChatGPT Plus')).toBeVisible();
    // The header indicator follows the same stream.
    expect(screen.getByRole('link', { name: 'AI 연결됨' })).toHaveAttribute('href', '/settings/ai');
  });

  it('cancels a login in progress', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'open',
      vi.fn(() => null),
    ); // popup blocked
    const api = aiApi(snapshot({ state: 'logged_out' }));
    const { calls } = renderApp('/settings/ai', api.handler);

    await user.click(await screen.findByRole('button', { name: 'ChatGPT로 연결' }));
    const dialog = await screen.findByRole('dialog', { name: 'ChatGPT 로그인' });
    expect(within(dialog).getByText(/새 탭을 열지 못했어요/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: '취소' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/ai/login/cancel',
      body: { loginId: 'login-1' },
    });
  });

  it('shows a failed login and lets the learner try again', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'open',
      vi.fn(() => null),
    );
    const api = aiApi(snapshot({ state: 'logged_out' }));
    renderApp('/settings/ai', api.handler);
    await user.click(await screen.findByRole('button', { name: 'ChatGPT로 연결' }));
    await screen.findByRole('dialog', { name: 'ChatGPT 로그인' });
    api.events.send('login', { loginId: 'login-1', success: false, error: '승인이 거부됐어요.' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '로그인하지 못했어요. 승인이 거부됐어요.',
    );
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeVisible();
  });

  it('disconnects after confirmation', async () => {
    const user = userEvent.setup();
    const api = aiApi(snapshot({ state: 'ready', planType: 'pro' }));
    const { calls } = renderApp('/settings/ai', api.handler);
    await user.click(await screen.findByRole('button', { name: '연결 해제' }));
    const dialog = await screen.findByRole('dialog', { name: 'AI 연결을 해제할까요?' });
    await user.click(within(dialog).getByRole('button', { name: '연결 해제' }));
    expect(await screen.findByText(/ChatGPT 계정을 연결해 주세요/)).toBeVisible();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/ai/logout')).toBe(true);
  });

  it.each([
    [
      { state: 'not_installed', hint: 'PATH를 확인하세요' } as const,
      'Codex CLI가 설치되어 있지 않아요',
      '다시 확인',
    ],
    [
      { state: 'unsupported_version', found: '0.100.0', required: '0.155.1' } as const,
      '지원하지 않는 Codex CLI 버전이에요',
      '다시 확인',
    ],
    [
      { state: 'isolation_failed', problems: ['web_search 켜짐'] } as const,
      'AI 안전 설정을 확인하지 못했어요',
      '다시 확인',
    ],
    [
      { state: 'error', code: 'AI_PROVIDER_ERROR', message: '재시작 실패' } as const,
      'AI에 연결하지 못했어요',
      '다시 연결',
    ],
  ])('explains %o and offers a retry', async (status, title, action) => {
    const user = userEvent.setup();
    const api = aiApi(snapshot(status as AIStatus));
    const { calls } = renderApp('/settings/ai', api.handler);
    expect(await screen.findByText(title)).toBeVisible();
    await user.click(screen.getByRole('button', { name: action }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.path === '/ai/reconnect')).toBe(true);
    });
  });
});

describe('AI status indicator', () => {
  it('reads the event stream without starting Codex', async () => {
    const api = aiApi(snapshot({ state: 'idle' }));
    const { calls } = renderApp('/settings/appearance', api.handler);
    api.events.raw(': keep-alive\n\n');
    api.events.send('status', snapshot({ state: 'logged_out' }));
    expect(await screen.findByRole('link', { name: 'AI 연결 안 됨' })).toBeVisible();
    api.events.send(
      'status',
      snapshot(
        { state: 'ready', planType: 'pro' },
        { usage: { ...usage, highestUsedPercent: 85 } },
      ),
    );
    expect(await screen.findByRole('link', { name: 'AI 사용량 경고' })).toBeVisible();
    expect(calls.some((c) => c.path === '/ai/status')).toBe(false);
  });
});
