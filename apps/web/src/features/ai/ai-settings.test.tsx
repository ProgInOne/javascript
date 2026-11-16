import type { AIModel, AIStatus, AIStatusResponse, AIUsage } from '@proginone/shared';
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
const MODELS: AIModel[] = [
  {
    id: 'gpt-x',
    displayName: 'GPT X',
    description: '빠른 모델',
    isDefault: true,
    supportedEfforts: ['medium'],
  },
];

function aiApi(
  initial: AIStatusResponse,
  options: { models?: AIModel[]; settings?: Record<string, unknown> } = {},
) {
  const events = controlledSse();
  let status = initial;
  let settings: Record<string, unknown> = { theme: 'system', ...options.settings };
  const handler = (method: string, path: string, body?: unknown) => {
    if (method === 'PATCH' && path === '/settings') {
      settings = { ...settings, ...(body as Record<string, unknown>) };
      return { body: settings };
    }
    if (path === '/settings') return { body: settings };
    if (path === '/dashboard') return notFound;
    if (path === '/ai/events') return events.response;
    if (path === '/ai/status') return { body: status };
    if (path === '/ai/models') return { body: { models: options.models ?? MODELS } };
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
    const group = await screen.findByRole('radiogroup', { name: '튜터와 AI 기능이 쓸 모델' });
    expect(within(group).getByRole('radio', { name: 'GPT X (기본)' })).toBeChecked();
    expect(within(group).getByText('빠른 모델 · 추론 강도 보통')).toBeVisible();
  });

  it('explains what is sent to the AI, even before connecting (NFR-08)', async () => {
    const api = aiApi(snapshot({ state: 'logged_out' }));
    renderApp('/settings/ai', api.handler);
    const scope = await screen.findByRole('region', { name: 'AI에 보내는 정보' });
    expect(within(scope).getByText(/학습 기록은 이 컴퓨터에만 저장돼요/)).toBeVisible();
    const [sent, notSent] = within(scope).getAllByRole('list');
    if (!sent || !notSent) throw new Error('lists missing');
    expect(within(sent).getByText(/내 코드와 마지막 실행 결과/)).toBeVisible();
    expect(within(sent).getByText(/이미 열어 본 만큼만/)).toBeVisible();
    expect(within(notSent).getByText(/계정 정보/)).toBeVisible();
    expect(within(scope).getByText(/데이터 정책/)).toBeVisible();
  });

  it('says when the login expired and offers to log in again (D-068)', async () => {
    const api = aiApi(snapshot({ state: 'logged_out', expired: true }));
    renderApp('/settings/ai', api.handler);
    expect(await screen.findByText('ChatGPT 로그인이 만료됐어요')).toBeVisible();
    expect(screen.getByText(/다시 로그인하면 이어서 쓸 수 있어요/)).toBeVisible();
    expect(screen.getByRole('button', { name: '다시 로그인' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'ChatGPT로 연결' })).toBeNull();
  });

  it('warns while the browser is offline', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      renderApp('/settings/ai', aiApi(snapshot({ state: 'ready', planType: 'pro' })).handler);
      expect(await screen.findByText(/인터넷 연결이 끊겨 AI 튜터를 쓸 수 없어요/)).toBeVisible();
      expect(screen.getByRole('link', { name: 'AI 오프라인' })).toBeVisible();
    } finally {
      onLine.mockRestore();
    }
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

describe('settings AI · model selection (FR-SET-01)', () => {
  const models: AIModel[] = [
    ...MODELS,
    {
      id: 'gpt-deep',
      displayName: 'GPT Deep',
      description: '깊게 생각하는 모델',
      isDefault: false,
      supportedEfforts: ['medium', 'high'],
    },
  ];

  it('saves the chosen model, and null for the default model', async () => {
    const user = userEvent.setup();
    const api = aiApi(snapshot({ state: 'ready', planType: 'pro' }), { models });
    const { calls } = renderApp('/settings/ai', api.handler);
    const deep = await screen.findByRole('radio', { name: 'GPT Deep' });
    expect(screen.getByRole('radio', { name: 'GPT X (기본)' })).toBeChecked();
    await user.click(deep);
    await waitFor(() => {
      expect(deep).toBeChecked();
    });
    await user.click(screen.getByRole('radio', { name: 'GPT X (기본)' }));
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'GPT X (기본)' })).toBeChecked();
    });
    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([
      { 'ai.model': 'gpt-deep' },
      { 'ai.model': null },
    ]);
    expect(screen.queryByRole('status', { name: /더 이상 쓸 수 없어서/ })).toBeNull();
  });

  it('explains the fallback when the saved model is no longer listed', async () => {
    const api = aiApi(snapshot({ state: 'ready', planType: 'pro' }), {
      models,
      settings: { 'ai.model': 'gpt-retired' },
    });
    renderApp('/settings/ai', api.handler);
    expect(
      await screen.findByText(/저장한 모델\(gpt-retired\)을 더 이상 쓸 수 없어서/),
    ).toBeVisible();
    expect(screen.getByText(/기본 모델\(GPT X\)로 답해요/)).toBeVisible();
    expect(screen.getByRole('radio', { name: 'GPT X (기본)' })).toBeChecked();
  });
});
