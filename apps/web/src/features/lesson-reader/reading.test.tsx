import { act, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render-app.tsx';
import { fixView, FIX, lesson, LESSON_ID, MCQ, mcqView } from '../../test/practice-fixtures.ts';
import { HEARTBEAT_MS, useActivityHeartbeat } from '../activity/useActivityHeartbeat.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const withChecks = {
  ...lesson,
  sections: [
    { id: 'intro', kind: 'intro', title: null },
    { id: 'check', kind: 'check', title: null },
  ],
  body: [
    ...lesson.body,
    {
      type: 'component',
      name: 'Section',
      props: { kind: 'check', id: 'check' },
      children: [
        { type: 'component', name: 'InlineExercise', props: { ref: MCQ } },
        { type: 'component', name: 'InlineExercise', props: { ref: FIX } },
      ],
    },
  ],
};

const progress = (lastSectionId: string | null) => ({
  lessonId: LESSON_ID,
  status: 'reading',
  readProgress: 0.4,
  lastSectionId,
  practiceSetId: null,
  startedAt: 1,
  completedAt: null,
  introducedConcepts: [],
});

function api(method: string, path: string, body: unknown) {
  if (path === '/settings') return { body: { theme: 'system' } };
  if (path === `/lessons/${encodeURIComponent(LESSON_ID)}`) return { body: withChecks };
  if (path === `/lessons/${encodeURIComponent(LESSON_ID)}/progress`) {
    return { body: progress('check') };
  }
  if (path === `/exercises/${encodeURIComponent(MCQ)}`) return { body: mcqView };
  if (path === `/exercises/${encodeURIComponent(FIX)}`) return { body: fixView };
  if (method === 'POST' && path.endsWith('/inline-attempts')) {
    const correct = (body as { answer: { optionId: string } }).answer.optionId === 'a';
    return {
      status: 201,
      body: {
        attempt: {
          id: '01JD3Z8Q6V2K9M4T7R1X5W0ATT',
          outcome: correct ? 'correct' : 'incorrect',
          score: correct ? 1 : 0,
          correct,
          engineApplied: true,
          attemptNo: 1,
          attemptInItem: 1,
        },
        grade: { feedback: [], misconceptions: [], explanation: '해설이에요.' },
        masteryChanges: [],
        misconceptionChanges: [],
      },
    };
  }
  return { status: 404, body: { error: { code: 'NOT_FOUND', message: '없음', retryable: false } } };
}

describe('reading mode', () => {
  it('starts the lesson, offers to resume and grades inline checks right away', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(`/learn/${LESSON_ID}`, api);

    expect(await screen.findByText(/지난번에 ‘이해도 확인’까지 읽었어요/)).toBeVisible();
    expect(screen.getByRole('link', { name: '이어서 읽기' })).toHaveAttribute('href', '#check');
    expect(calls).toContainEqual({
      method: 'POST',
      path: `/lessons/${encodeURIComponent(LESSON_ID)}/progress`,
      body: { readProgress: 0 },
    });

    // Code exercises are not inline checks.
    expect(await screen.findByText('이 확인 문제는 실습 모드에서 풀 수 있어요.')).toBeVisible();

    await user.click(await screen.findByRole('radio', { name: /값을 저장한다/ }));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByRole('heading', { name: '정답이 아니에요.' })).toBeVisible();
    expect(calls.find((c) => c.path.endsWith('/inline-attempts'))).toMatchObject({
      path: `/exercises/${encodeURIComponent(MCQ)}/inline-attempts`,
      body: { answer: { optionId: 'b' }, confidence: 'sure' },
    });
    await user.click(screen.getByRole('button', { name: '다시 풀기' }));
    await user.click(screen.getByRole('radio', { name: /글자를 보여 준다/ }));
    await user.click(screen.getByRole('button', { name: '찍었어요' }));
    expect(await screen.findByRole('heading', { name: '정답이에요.' })).toBeVisible();
    expect(screen.getByText(/맞혔지만 찍었다고 했죠/)).toBeVisible();
  });
});

describe('activity heartbeat', () => {
  it('sends every 30 s while visible and active, and stops when idle', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const send = vi.fn(() => Promise.resolve());
    renderHook(() => {
      useActivityHeartbeat(send);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ lastInputAt: 1_000_000, visible: true }),
    );
    // No input for more than two minutes: no more heartbeats.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * HEARTBEAT_MS);
    });
    const idleCount = send.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * HEARTBEAT_MS);
    });
    expect(send.mock.calls.length).toBe(idleCount);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    });
    expect(send.mock.calls.length).toBe(idleCount + 1);
  });
});
