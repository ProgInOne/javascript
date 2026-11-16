import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render-app.tsx';
import {
  item,
  LESSON_ID,
  MCQ,
  mcqView,
  practiceSet,
  SET_ID,
} from '../../test/practice-fixtures.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const dashboard = (over: object = {}) => ({
  date: '2026-11-15',
  activeMinutesToday: 18,
  reviewDueCount: 3,
  continueLesson: {
    id: LESSON_ID,
    title: '첫 프로그램',
    status: 'practicing',
    readProgress: 1,
    practiceSetId: SET_ID,
  },
  ...over,
});

const queue = {
  date: '2026-11-15',
  budgetMinutes: 20,
  due: [
    {
      conceptId: 'js.basics.console-log',
      title: 'console.log로 출력하기',
      dueAt: 1,
      overdue: false,
      overdueDays: 0,
      itemCount: 1,
      estimatedSeconds: 60,
      priority: 1,
    },
  ],
  deferred: [],
  estimatedMinutes: 1,
};

const reviewSet = practiceSet({
  kind: 'review',
  lessonId: null,
  passRule: null,
  items: [item(0, MCQ, 'mcq_single', { reason: 'review_due' })],
});

describe('review', () => {
  it('starts today’s review set and hides the concept until the answer is graded', async () => {
    const user = userEvent.setup();
    const { router, calls } = renderApp('/review', (method, path) => {
      if (path === '/settings') return { body: { theme: 'system' } };
      if (path === '/dashboard') return { body: dashboard() };
      if (path === '/review-queue') return { body: queue };
      if (method === 'POST' && path === '/practice-sets') return { body: reviewSet };
      if (path === `/practice-sets/${SET_ID}`) return { body: reviewSet };
      if (path.startsWith(`/exercises/${encodeURIComponent(MCQ)}?`)) return { body: mcqView };
      return {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'x', retryable: false } },
      };
    });
    expect(await screen.findByText('console.log로 출력하기')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '복습 시작' }));
    expect(await screen.findByRole('heading', { level: 1, name: '오늘의 복습' })).toBeVisible();
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/practice-sets',
      body: { kind: 'review' },
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/review/session/${SET_ID}`);
    });
    expect(await screen.findByRole('heading', { name: /문제 1/ })).toBeVisible();
    expect(screen.queryByText(/개념: console.log로 출력하기/)).not.toBeInTheDocument();
  });

  it('shows the empty state when nothing is due', async () => {
    const user = userEvent.setup();
    renderApp('/review', (method, path) => {
      if (path === '/settings') return { body: { theme: 'system' } };
      if (path === '/dashboard') return { body: dashboard() };
      if (path === '/review-queue') return { body: queue };
      if (method === 'POST' && path === '/practice-sets') {
        return {
          status: 409,
          body: { error: { code: 'PRACTICE_NOTHING_DUE', message: '없음', retryable: false } },
        };
      }
      return {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'x', retryable: false } },
      };
    });
    await user.click(await screen.findByRole('button', { name: '복습 시작' }));
    expect(await screen.findByRole('heading', { name: '오늘 복습할 개념이 없어요' })).toBeVisible();
  });

  it('shows an empty state for a set without items (FR-UI-03)', async () => {
    const empty = practiceSet({ kind: 'review', lessonId: null, passRule: null, items: [] });
    renderApp(`/review/session/${SET_ID}`, (_method, path) => {
      if (path === '/settings') return { body: { theme: 'system' } };
      if (path === `/practice-sets/${SET_ID}`) return { body: empty };
      return {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: '없음', retryable: false } },
      };
    });
    expect(
      await screen.findByRole('heading', { name: '이 세트에는 풀 문제가 없어요' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: '대시보드로 가기' })).toHaveAttribute('href', '/');
  });
});
