import type {
  AIStatusResponse,
  PracticeSetView,
  RunPlan,
  TutorMessage,
  TutorThread,
} from '@proginone/shared';
import type * as RunnerModule from '../runner/runner.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render-app.tsx';
import {
  FIX,
  fixView,
  HINTS,
  lesson,
  LESSON_ID,
  MCQ,
  mcqView,
  practiceSet,
  runResult,
  SET_ID,
} from '../../test/practice-fixtures.ts';
import { controlledSse } from '../../test/sse.ts';

vi.mock('../runner/runner.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof RunnerModule>();
  const host = {
    run: (_plan: RunPlan) => Promise.resolve(runResult(['7000'])),
    abort: () => undefined,
    ready: () => Promise.resolve(),
    dispose: () => undefined,
    stats: { shellsCreated: 1, usingFallback: false },
  };
  return { ...actual, consoleRunner: () => host, previewRunner: () => host };
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  window.getSelection()?.removeAllRanges();
});

const THREAD = '01JD3Z8Q6V2K9M4T7R1X5W0TH1';
const LEARNER_MSG = '01JD3Z8Q6V2K9M4T7R1X5W0ML1';
const TUTOR_MSG = '01JD3Z8Q6V2K9M4T7R1X5W0MT1';

const notFound = {
  status: 404,
  body: { error: { code: 'NOT_FOUND', message: '없음', retryable: false } },
};

const ready: AIStatusResponse = {
  provider: 'mock',
  status: { state: 'ready', planType: 'mock' },
  usage: null,
  pendingLogin: null,
};

const message = (over: Partial<TutorMessage>): TutorMessage => ({
  id: TUTOR_MSG,
  threadId: THREAD,
  role: 'tutor',
  content: '',
  status: 'complete',
  taskName: null,
  taskVersion: null,
  meta: null,
  createdAt: 1,
  ...over,
});

/** Practice + tutor fake API. Every question gets its own controllable SSE reply. */
function tutorApi({
  set = practiceSet(),
  status = ready,
  stored = [] as TutorMessage[],
}: { set?: PracticeSetView; status?: AIStatusResponse; stored?: TutorMessage[] } = {}) {
  const events = controlledSse();
  const replies: ReturnType<typeof controlledSse>[] = [];
  let hints = 0;
  let refuse: { status: number; code: string; message: string } | null = null;
  const threads: { scopeType: string; scopeId: string }[] = [];
  const handler = (method: string, path: string, body: unknown) => {
    if (path === '/settings') return { body: { theme: 'system' } };
    if (path === '/ai/events') {
      queueMicrotask(() => {
        events.send('status', status);
      });
      return events.response;
    }
    if (path === '/ai/status') return { body: status };
    if (path === `/lessons/${encodeURIComponent(LESSON_ID)}`) return { body: lesson };
    if (path.endsWith('/progress')) return notFound;
    if (method === 'POST' && path === '/practice-sets') return { body: set };
    if (path === `/practice-sets/${SET_ID}`) return { body: set };
    if (path.startsWith(`/exercises/${encodeURIComponent(MCQ)}?`)) return { body: mcqView };
    if (path.startsWith(`/exercises/${encodeURIComponent(FIX)}?`)) return { body: fixView };
    if (path.endsWith('/hints')) {
      hints++;
      return { body: { level: hints, text: HINTS[hints - 1], hintCount: 3, remaining: 3 - hints } };
    }
    if (method === 'POST' && path === '/tutor/threads') {
      const req = body as { scopeType: string; scopeId: string };
      threads.push(req);
      const thread: TutorThread = {
        id: THREAD,
        scopeType: req.scopeType as TutorThread['scopeType'],
        scopeId: req.scopeId,
        title: '',
        status: 'open',
        messageCount: stored.length,
        createdAt: 1,
        lastMessageAt: 1,
      };
      return { body: thread };
    }
    if (method === 'GET' && path === `/tutor/threads/${THREAD}/messages`) {
      return {
        body: {
          thread: {
            id: THREAD,
            scopeType: 'exercise',
            scopeId: FIX,
            title: '',
            status: 'open',
            messageCount: stored.length,
            createdAt: 1,
            lastMessageAt: 1,
          },
          messages: stored,
        },
      };
    }
    if (method === 'POST' && path === `/tutor/threads/${THREAD}/messages`) {
      if (refuse) {
        return {
          status: refuse.status,
          body: { error: { code: refuse.code, message: refuse.message, retryable: false } },
        };
      }
      const reply = controlledSse();
      replies.push(reply);
      return reply.response;
    }
    if (method === 'POST' && path.endsWith('/cancel')) {
      return { body: { messageId: TUTOR_MSG, cancelled: true } };
    }
    return notFound;
  };
  return {
    handler,
    events,
    replies,
    threads,
    stored,
    refuseNext: (r: typeof refuse) => {
      refuse = r;
    },
  };
}

const PRACTICE_FIX = `/learn/${LESSON_ID}?mode=practice&set=${SET_ID}&i=2`;

async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /튜터/ }));
  return screen.findByRole('complementary', { name: 'AI 튜터' });
}

describe('tutor drawer', () => {
  it('asks about the current exercise and renders the streamed reply', async () => {
    const user = userEvent.setup();
    const api = tutorApi();
    const { calls } = renderApp(PRACTICE_FIX, api.handler);
    expect(await screen.findByRole('heading', { name: /문제 2/ })).toBeVisible();

    const drawer = await openDrawer(user);
    const input = within(drawer).getByRole('textbox', { name: '튜터에게 질문' });
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
    expect(within(drawer).getByText('첫 프로그램 연습 · 문제 2')).toBeVisible();
    const chips = within(drawer).getByRole('list', { name: '튜터에게 함께 보내는 정보' });
    expect(within(chips).getByText('현재 문제')).toBeVisible();
    expect(within(chips).getByText('내 코드')).toBeVisible();
    expect(api.threads).toEqual([{ scopeType: 'exercise', scopeId: FIX }]);
    // Opening the tutor is a lazy-start trigger.
    expect(calls.some((c) => c.path === '/ai/status')).toBe(true);

    await user.type(input, '왜 글자로 나오나요?{Enter}');
    await waitFor(() => {
      expect(api.replies).toHaveLength(1);
    });
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/messages'));
    expect(post?.body).toEqual({
      question: '왜 글자로 나오나요?',
      entryPoint: 'free',
      lessonId: LESSON_ID,
      exerciseId: FIX,
      practiceSetItemId: practiceSet().items[1]?.id,
      currentCode: { 'main.js': 'console.log("3500 * 2");\n' },
    });
    expect(within(drawer).getByText('왜 글자로 나오나요?')).toBeVisible();
    expect(input).toHaveValue('');

    const reply = api.replies[0];
    if (!reply) throw new Error('no reply');
    reply.send('message.created', {
      learnerMessageId: LEARNER_MSG,
      messageId: TUTOR_MSG,
      role: 'tutor',
      taskName: 'tutor.reply',
      taskVersion: 1,
    });
    reply.send('status', { messageId: TUTOR_MSG, state: 'queued', position: 1 });
    expect(
      await within(drawer).findByText(/앞선 답변을 기다리는 중이에요 \(1번째\)/),
    ).toBeVisible();
    expect(within(drawer).getByRole('status')).toHaveTextContent('응답 중…');

    reply.send('delta', { messageId: TUTOR_MSG, text: '따옴표 안은 **문자열**이에요.\n\n' });
    reply.send('delta', { messageId: TUTOR_MSG, text: '`3500 * 2`를 따옴표' });
    expect(await within(drawer).findByText('문자열')).toBeVisible();
    // Announced by paragraph, not per token.
    const live = drawer.querySelector('[aria-live="polite"].sr-only');
    await waitFor(() => {
      expect(live).toHaveTextContent('따옴표 안은 문자열이에요.');
    });
    expect(live).not.toHaveTextContent('3500');

    api.stored.push(
      message({ id: LEARNER_MSG, role: 'learner', content: '왜 글자로 나오나요?' }),
      message({
        content: '따옴표 안은 **문자열**이에요.\n\n`3500 * 2`를 따옴표 밖으로 꺼내 보세요.',
      }),
    );
    reply.send('done', {
      messageId: TUTOR_MSG,
      status: 'complete',
      content: '따옴표 안은 **문자열**이에요.\n\n`3500 * 2`를 따옴표 밖으로 꺼내 보세요.',
      meta: null,
      usage: null,
    });
    reply.close();
    expect(
      await within(within(drawer).getByRole('list', { name: '튜터 대화' })).findByText(
        /따옴표 밖으로 꺼내 보세요/,
      ),
    ).toBeVisible();
    await waitFor(() => {
      expect(live).toHaveTextContent('3500 * 2를 따옴표 밖으로 꺼내 보세요.');
    });
    expect(within(drawer).getByRole('button', { name: '보내기' })).toBeVisible();
    // AI content is marked: the tutor message carries the AI label.
    expect(within(drawer).getByText('AI 튜터', { selector: '.tutor-msg__who' })).toBeVisible();
  });

  it('cancels a reply with the stop button and keeps the partial text', async () => {
    const user = userEvent.setup();
    const api = tutorApi();
    const { calls } = renderApp(PRACTICE_FIX, api.handler);
    const drawer = await openDrawer(user);
    await user.type(within(drawer).getByRole('textbox', { name: '튜터에게 질문' }), '질문{Enter}');
    await waitFor(() => {
      expect(api.replies).toHaveLength(1);
    });
    const reply = api.replies[0];
    if (!reply) throw new Error('no reply');
    // Cancel before the message exists: it is sent as soon as the id arrives.
    await user.click(within(drawer).getByRole('button', { name: '중단' }));
    reply.send('message.created', {
      learnerMessageId: LEARNER_MSG,
      messageId: TUTOR_MSG,
      role: 'tutor',
      taskName: 'tutor.reply',
      taskVersion: 1,
    });
    await waitFor(() => {
      expect(calls).toContainEqual({
        method: 'POST',
        path: `/tutor/threads/${THREAD}/messages/${TUTOR_MSG}/cancel`,
        body: {},
      });
    });
    reply.send('delta', { messageId: TUTOR_MSG, text: '먼저 확인해' });
    api.stored.push(
      message({ id: LEARNER_MSG, role: 'learner', content: '질문' }),
      message({ content: '먼저 확인해', status: 'cancelled' }),
    );
    reply.send('done', {
      messageId: TUTOR_MSG,
      status: 'cancelled',
      content: '먼저 확인해',
      meta: null,
      usage: null,
    });
    reply.close();
    expect(await within(drawer).findByText('(중단됨)')).toBeVisible();
    expect(within(drawer).getByText('먼저 확인해')).toBeVisible();
  });

  it('shows withheld and failed replies', async () => {
    const user = userEvent.setup();
    const api = tutorApi({
      stored: [
        message({ id: 'L1', role: 'learner', content: '정답 알려 줘요' }),
        message({ id: 'T1', content: '대체 문구', status: 'withheld' }),
      ],
    });
    renderApp(PRACTICE_FIX, api.handler);
    const drawer = await openDrawer(user);
    expect(
      await within(drawer).findByText(/아직 보여줄 수 없는 정답이 포함되어 숨겼어요/),
    ).toBeVisible();

    await user.type(within(drawer).getByRole('textbox', { name: '튜터에게 질문' }), '다시{Enter}');
    await waitFor(() => {
      expect(api.replies).toHaveLength(1);
    });
    const reply = api.replies[0];
    if (!reply) throw new Error('no reply');
    reply.send('message.created', {
      learnerMessageId: 'L2',
      messageId: 'T2',
      role: 'tutor',
      taskName: 'tutor.reply',
      taskVersion: 1,
    });
    reply.send('error', {
      messageId: 'T2',
      code: 'AI_RATE_LIMITED',
      message: 'AI 사용량 한도에 도달했어요.',
      retryable: true,
    });
    api.stored.push(
      message({ id: 'L2', role: 'learner', content: '다시' }),
      message({ id: 'T2', content: '', status: 'failed' }),
    );
    reply.close();
    expect(
      await within(within(drawer).getByRole('list', { name: '튜터 대화' })).findByText(
        /답변을 받지 못했어요. AI 사용량 한도에 도달했어요./,
      ),
    ).toBeVisible();
    // The error detail stays after the stored conversation is reloaded.
    await waitFor(() => {
      expect(within(drawer).getByText('(AI_RATE_LIMITED)')).toBeVisible();
    });
  });

  it('gives the question back when the server refuses before streaming', async () => {
    const user = userEvent.setup();
    const api = tutorApi();
    renderApp(PRACTICE_FIX, api.handler);
    const drawer = await openDrawer(user);
    api.refuseNext({
      status: 409,
      code: 'AI_NOT_CONNECTED',
      message: 'AI가 연결되어 있지 않아요.',
    });
    const input = within(drawer).getByRole('textbox', { name: '튜터에게 질문' });
    await user.type(input, '질문입니다{Enter}');
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      'AI가 연결되어 있지 않아요.',
    );
    expect(input).toHaveValue('질문입니다');
  });

  it('explains when AI is not connected and links to the settings', async () => {
    const user = userEvent.setup();
    const api = tutorApi({ status: { ...ready, status: { state: 'logged_out' } } });
    renderApp(PRACTICE_FIX, api.handler);
    const drawer = await openDrawer(user);
    expect(await within(drawer).findByText('AI 튜터를 쓸 수 없어요')).toBeVisible();
    expect(within(drawer).getByText(/ChatGPT 계정을 연결해 주세요/)).toBeVisible();
    expect(within(drawer).getByRole('link', { name: 'AI 연결 설정' })).toHaveAttribute(
      'href',
      '/settings/ai',
    );
    expect(within(drawer).getByRole('textbox', { name: '튜터에게 질문' })).toBeDisabled();
  });

  it('says when the ChatGPT login expired and offers to log in again from the drawer', async () => {
    const user = userEvent.setup();
    const api = tutorApi({ status: { ...ready, status: { state: 'logged_out', expired: true } } });
    renderApp(PRACTICE_FIX, api.handler);
    const drawer = await openDrawer(user);
    expect(await within(drawer).findByText('ChatGPT 로그인이 만료됐어요')).toBeVisible();
    expect(within(drawer).getByText(/학습 기록과 튜터 대화는 그대로/)).toBeVisible();
    expect(within(drawer).getByRole('button', { name: '다시 로그인' })).toBeEnabled();
    expect(within(drawer).getByRole('textbox', { name: '튜터에게 질문' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'AI 로그인 만료' })).toBeVisible();
  });

  it('explains being offline and comes back when the browser is online again', async () => {
    const user = userEvent.setup();
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      renderApp(PRACTICE_FIX, tutorApi().handler);
      const drawer = await openDrawer(user);
      expect(await within(drawer).findByText('인터넷에 연결되어 있지 않아요')).toBeVisible();
      expect(within(drawer).getByText(/인터넷 없이도 그대로 할 수 있어요/)).toBeVisible();
      expect(screen.getByRole('link', { name: 'AI 오프라인' })).toBeVisible();
      const input = within(drawer).getByRole('textbox', { name: '튜터에게 질문' });
      expect(input).toBeDisabled();

      onLine.mockReturnValue(true);
      act(() => {
        window.dispatchEvent(new Event('online'));
      });
      await waitFor(() => {
        expect(input).toBeEnabled();
      });
    } finally {
      onLine.mockRestore();
    }
  });

  it('reopens where it was left open on wide screens, without taking focus', async () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query === '(min-width: 1280px)',
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    localStorage.setItem('proginone:panel:tutor-open', 'true');
    const user = userEvent.setup();
    renderApp(`/learn/${LESSON_ID}`, tutorApi().handler);
    const drawer = await screen.findByRole('complementary', { name: 'AI 튜터' });
    const input = within(drawer).getByRole('textbox', { name: '튜터에게 질문' });
    expect(input).not.toHaveFocus();

    await user.click(within(drawer).getByRole('button', { name: /닫기/ }));
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: 'AI 튜터' })).not.toBeInTheDocument();
    });
    expect(localStorage.getItem('proginone:panel:tutor-open')).toBeNull();
  });

  it('toggles with Ctrl+J, closes with Esc and returns focus, cycles regions with F6', async () => {
    const user = userEvent.setup();
    const api = tutorApi();
    renderApp(`/learn/${LESSON_ID}`, api.handler);
    expect(await screen.findByRole('heading', { level: 1, name: '첫 프로그램' })).toBeVisible();
    const trigger = screen.getByRole('button', { name: /튜터/ });
    expect(trigger).toHaveAttribute('aria-keyshortcuts', 'Control+J');
    trigger.focus();

    await user.keyboard('{Control>}j{/Control}');
    const drawer = await screen.findByRole('complementary', { name: 'AI 튜터' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(drawer).getByText('첫 프로그램')).toBeVisible();
    expect(within(drawer).getByText('이 단원')).toBeVisible();
    expect(api.threads).toEqual([{ scopeType: 'lesson', scopeId: LESSON_ID }]);
    const input = within(drawer).getByRole('textbox', { name: '튜터에게 질문' });
    await waitFor(() => {
      expect(input).toHaveFocus();
    });

    // F6: drawer → header → page body → drawer (no focus trap).
    await user.keyboard('{F6}');
    expect(document.activeElement?.closest('header')).not.toBeNull();
    await user.keyboard('{F6}');
    expect(document.activeElement?.closest('.tutor-layout__main')).not.toBeNull();
    await user.keyboard('{F6}');
    expect(input).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: 'AI 튜터' })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it('resizes with the keyboard between 360 and 560px and remembers the width', async () => {
    const user = userEvent.setup();
    renderApp(`/learn/${LESSON_ID}`, tutorApi().handler);
    const drawer = await openDrawer(user);
    const handle = within(drawer).getByRole('separator', { name: '튜터 드로어 폭' });
    expect(handle).toHaveAttribute('aria-valuenow', '400');
    handle.focus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(handle).toHaveAttribute('aria-valuenow', '420');
    await user.keyboard('{End}');
    expect(handle).toHaveAttribute('aria-valuenow', '560');
    await user.keyboard('{ArrowLeft}');
    expect(handle).toHaveAttribute('aria-valuenow', '560');
    await user.keyboard('{Home}');
    expect(handle).toHaveAttribute('aria-valuenow', '360');
    expect(localStorage.getItem('proginone:tutor-width')).toBe('360');
  });

  it('asks about selected lesson text (선택해서 질문하기)', async () => {
    const user = userEvent.setup();
    const api = tutorApi();
    const { calls } = renderApp(`/learn/${LESSON_ID}`, api.handler);
    const paragraph = await screen.findByText('본문');

    // Select the paragraph text the way a pointer drag would.
    act(() => {
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    const ask = await screen.findByRole('button', { name: /튜터에게 질문/ });
    await user.click(ask);

    const drawer = await screen.findByRole('complementary', { name: 'AI 튜터' });
    expect(within(drawer).getByText('선택한 텍스트 2자')).toBeVisible();
    await user.type(
      within(drawer).getByRole('textbox', { name: '튜터에게 질문' }),
      '이게 뭐예요?{Enter}',
    );
    await waitFor(() => {
      expect(api.replies).toHaveLength(1);
    });
    expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/messages'))?.body).toEqual({
      question: '이게 뭐예요?',
      entryPoint: 'selection',
      selection: { kind: 'lesson_text', text: '본문', sectionId: 'intro' },
      lessonId: LESSON_ID,
    });
    // The chip is used up by the question.
    expect(
      within(drawer).queryByText('선택한 텍스트 2자', { selector: 'li' }),
    ).not.toBeInTheDocument();
  });
});

describe('AI hint', () => {
  it('re-explains the opened hint level and shows authored fallbacks as such', async () => {
    const user = userEvent.setup();
    const api = tutorApi();
    let source: 'ai' | 'authored' = 'ai';
    const { calls } = renderApp(PRACTICE_FIX, (method, path, body) => {
      if (path.endsWith('/ai-hint')) {
        return {
          body:
            source === 'ai'
              ? {
                  level: 1,
                  hintMarkdown: '따옴표가 **어디서** 시작하는지 보세요.',
                  focusLine: 1,
                  checkQuestion: '따옴표 안은 어떤 값일까요?',
                  source: 'ai',
                  fallbackCode: null,
                }
              : {
                  level: 1,
                  hintMarkdown: '첫 번째 힌트',
                  focusLine: null,
                  checkQuestion: null,
                  source: 'authored',
                  fallbackCode: 'AI_NOT_CONNECTED',
                },
        };
      }
      return api.handler(method, path, body);
    });
    expect(screen.queryByRole('button', { name: /AI에게/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /힌트 1\/3 보기/ }));
    await user.click(await screen.findByRole('button', { name: 'AI에게 이 단계 다시 설명받기' }));

    const result = await screen.findByRole('region', { name: 'AI 힌트 1단계' });
    expect(within(result).getByText('어디서')).toBeVisible();
    expect(within(result).getByText('에디터 1번째 줄을 살펴보세요.')).toBeVisible();
    expect(within(result).getByText(/따옴표 안은 어떤 값일까요/)).toBeVisible();
    expect(calls.find((c) => c.path.endsWith('/ai-hint'))?.body).toEqual({
      practiceSetItemId: practiceSet().items[1]?.id,
      currentCode: { 'main.js': 'console.log("3500 * 2");\n' },
    });

    source = 'authored';
    await user.click(screen.getByRole('button', { name: 'AI에게 다시 설명받기' }));
    expect(
      await screen.findByText(/AI가 연결되지 않아 작성된 힌트를 다시 보여 드려요/),
    ).toBeVisible();
  });

  it('is disabled with a reason when AI is unavailable', async () => {
    const user = userEvent.setup();
    const api = tutorApi({
      status: { ...ready, status: { state: 'not_installed', hint: '' } },
    });
    const { calls } = renderApp(PRACTICE_FIX, api.handler);
    await user.click(await screen.findByRole('button', { name: /힌트 1\/3 보기/ }));
    const button = await screen.findByRole('button', { name: 'AI에게 이 단계 다시 설명받기' });
    await waitFor(() => {
      expect(button).toHaveAttribute('aria-disabled', 'true');
    });
    expect(screen.getByText('Codex CLI를 설치해야 AI 튜터를 쓸 수 있어요')).toBeVisible();
    await user.click(button);
    expect(calls.some((c) => c.path.endsWith('/ai-hint'))).toBe(false);
  });
});
