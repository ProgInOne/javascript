import type { AIStatusResponse, MistakeExplanation } from '@proginone/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render-app.tsx';
import {
  attemptResponse,
  FIX,
  fixView,
  lesson,
  LESSON_ID,
  MCQ,
  mcqView,
  practiceSet,
  SET_ID,
} from '../../test/practice-fixtures.ts';
import { controlledSse } from '../../test/sse.ts';

// "AI에게 왜 틀렸는지 묻기" after a wrong answer (evaluator.explainMistake).

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const ready: AIStatusResponse = {
  provider: 'mock',
  status: { state: 'ready', planType: 'mock' },
  usage: null,
  pendingLogin: null,
};

const ATTEMPT = '01JD3Z8Q6V2K9M4T7R1X5W0ATT';
const PATH = `/attempts/${ATTEMPT}/explanation`;

function api(status: AIStatusResponse, explanation: () => MistakeExplanation) {
  const events = controlledSse();
  const set = practiceSet();
  return (method: string, path: string) => {
    if (path === '/settings') return { body: { theme: 'system' } };
    if (path === '/ai/events') {
      queueMicrotask(() => {
        events.send('status', status);
      });
      return events.response;
    }
    if (path === `/lessons/${encodeURIComponent(LESSON_ID)}`) return { body: lesson };
    if (path === `/practice-sets/${SET_ID}`) return { body: set };
    if (path.startsWith(`/exercises/${encodeURIComponent(MCQ)}?`)) return { body: mcqView };
    if (path.startsWith(`/exercises/${encodeURIComponent(FIX)}?`)) return { body: fixView };
    if (method === 'POST' && path === '/attempts') {
      return {
        status: 201,
        body: attemptResponse(set, set.items[0]?.id ?? '', 'incorrect', { completed: false }),
      };
    }
    if (method === 'POST' && path === PATH) return { body: explanation() };
    return {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: '없음', retryable: false } },
    };
  };
}

const ai: MistakeExplanation = {
  attemptId: ATTEMPT,
  source: 'ai',
  fallbackCode: null,
  summary: '출력과 반환을 같은 것으로 보았어요.',
  explanationMarkdown: '`console.log`는 값을 **보여 줄 뿐**이에요.',
  mistakeKind: 'concept',
  nextStep: 'retry',
  relatedConcepts: [],
  misconception: { id: 'ai.X', title: '출력을 값으로 착각', status: 'suspected', origin: 'ai' },
};

async function answerWrong(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('radio', { name: /값을 저장한다/ }));
  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(await screen.findByRole('heading', { name: '정답이 아니에요.' })).toBeVisible();
}

describe('AI mistake explanation', () => {
  it('explains a wrong answer below the feedback', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      `/learn/${LESSON_ID}?mode=practice&set=${SET_ID}&i=1`,
      api(ready, () => ai),
    );
    await answerWrong(user);
    await user.click(screen.getByRole('button', { name: 'AI에게 왜 틀렸는지 묻기' }));
    const region = await screen.findByRole('region', { name: 'AI 오답 분석' });
    expect(within(region).getByText('출력과 반환을 같은 것으로 보았어요.')).toBeVisible();
    expect(within(region).getByText('보여 줄 뿐')).toBeVisible();
    expect(within(region).getByText('다시 풀어 보세요.')).toBeVisible();
    expect(within(region).getByText(/오개념 후보로 기록했어요: 출력을 값으로 착각/)).toBeVisible();
    expect(calls.filter((c) => c.path === PATH)).toEqual([
      { method: 'POST', path: PATH, body: {} },
    ]);
  });

  it('shows the authored text and the reason when AI could not help', async () => {
    const user = userEvent.setup();
    renderApp(
      `/learn/${LESSON_ID}?mode=practice&set=${SET_ID}&i=1`,
      api(ready, () => ({
        ...ai,
        source: 'authored',
        fallbackCode: 'AI_RATE_LIMITED',
        summary: '출력을 반환으로 착각함',
        explanationMarkdown: '**출력을 반환으로 착각함**\n\n출력하면 값이 돌아온다고 생각합니다.',
        mistakeKind: null,
        nextStep: null,
        misconception: null,
      })),
    );
    await answerWrong(user);
    await user.click(screen.getByRole('button', { name: 'AI에게 왜 틀렸는지 묻기' }));
    const region = await screen.findByRole('region', { name: '작성된 오답 설명' });
    expect(
      within(region).getByText(/AI 사용량 한도에 도달해 작성된 오개념 설명을 보여 드려요/),
    ).toBeVisible();
    expect(within(region).getByText('출력하면 값이 돌아온다고 생각합니다.')).toBeVisible();
  });

  it('is disabled with a reason when AI is unavailable', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      `/learn/${LESSON_ID}?mode=practice&set=${SET_ID}&i=1`,
      api({ ...ready, status: { state: 'logged_out' } }, () => ai),
    );
    await answerWrong(user);
    const button = screen.getByRole('button', { name: 'AI에게 왜 틀렸는지 묻기' });
    await waitFor(() => {
      expect(button).toHaveAttribute('aria-disabled', 'true');
    });
    await user.click(button);
    expect(calls.some((c) => c.path === PATH)).toBe(false);
  });
});
