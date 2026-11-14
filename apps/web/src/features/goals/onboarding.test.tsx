import type { GoalRequest, LearnerPatch, LearnerProfile } from '@proginone/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  course,
  courses,
  firstDayPlan,
  FIRST_LESSON,
  goalStatus,
  newLearner,
  onboarded,
} from '../../test/learning-fixtures.ts';
import { lesson } from '../../test/practice-fixtures.ts';
import { renderApp } from '../../test/render-app.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

const DASHBOARD = {
  date: '2026-11-15',
  activeMinutesToday: 0,
  reviewDueCount: 0,
  continueLesson: null,
};

/** A fake server with the learner profile and goal kept in memory. */
function fakeServer(initial: LearnerProfile = newLearner) {
  let learner = initial;
  let goal = goalStatus();
  return (method: string, path: string, body: unknown) => {
    if (path === '/learner') {
      if (method === 'PATCH') {
        const patch = body as LearnerPatch;
        learner = {
          ...learner,
          ...(patch.experienceLevel ? { experienceLevel: patch.experienceLevel } : {}),
          ...(patch.onboarded ? { onboardedAt: 1, needsOnboarding: false } : {}),
        };
      }
      return { body: learner };
    }
    if (path === '/goals') {
      if (method === 'PUT') {
        const req = body as GoalRequest;
        goal = goalStatus(0, [], {
          dailyMinutes: req.dailyMinutes,
          weeklyDays: req.weeklyDays,
          isDefault: false,
        });
      }
      return { body: goal };
    }
    if (path === '/courses') return { body: courses };
    if (path === '/courses/js-basics') return { body: course };
    if (path === '/daily-plan') return { body: firstDayPlan(goal.goal) };
    if (path === '/dashboard') return { body: DASHBOARD };
    if (path === `/lessons/${FIRST_LESSON.id}`) return { body: lesson };
    if (path.startsWith('/lessons/')) return { status: 404, body: {} };
    return { body: { theme: 'system' } };
  };
}

describe('온보딩', () => {
  it('sends a first-time learner from the dashboard through every step', async () => {
    const { calls, router } = renderApp('/', fakeServer());
    expect(
      await screen.findByRole('heading', { level: 1, name: '코딩 공부, 이제 한 곳에서 끝까지.' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/onboarding');
    // No global header on the first-run flow.
    expect(screen.queryByRole('navigation', { name: '주 메뉴' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '시작하기' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: '학습 목표를 정해요' }),
    ).toHaveFocus();
    const stepper = screen.getByRole('list', { name: '온보딩 단계' });
    expect(within(stepper).getByText('목표').closest('li')).toHaveAttribute('aria-current', 'step');

    // Defaults: 30 minutes, 5 days.
    expect(screen.getByRole('radio', { name: '30분' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '5일' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: '45분' }));
    await userEvent.click(screen.getByRole('radio', { name: '4일' }));

    // A target date shows the pace right away (2 lessons × 60 min over ~4 study days).
    await userEvent.click(screen.getByRole('checkbox', { name: /목표일 정하기/ }));
    fireEvent.change(screen.getByLabelText('완료 목표일'), { target: { value: '2026-11-21' } });
    expect(await screen.findByText(/하루 약 30분이면 돼요/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('완료 목표일'), { target: { value: '2026-11-16' } });
    expect(await screen.findByText(/조금 빠듯해요/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('완료 목표일'), { target: { value: '2026-12-31' } });

    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: '코딩은 얼마나 해 보셨나요?' }),
    ).toBeInTheDocument();
    expect(calls).toContainEqual({
      method: 'PUT',
      path: '/goals',
      body: {
        dailyMinutes: 45,
        weeklyDays: 4,
        targetCourseId: 'js-basics',
        targetDate: '2026-12-31',
      },
    });

    await userEvent.click(screen.getByRole('radio', { name: /조금 해봤어요/ }));
    expect(screen.getByText(/아는 단원은 바로 건너뛸 수 있어요/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'AI 튜터 연결 (선택)' }),
    ).toBeInTheDocument();
    expect(calls).toContainEqual({
      method: 'PATCH',
      path: '/learner',
      body: { experienceLevel: 'some' },
    });
    expect(
      screen.getByText(/연결하지 않아도 레슨, 연습, 힌트, 해설, 복습을 모두/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ChatGPT로 연결' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '나중에 할게요' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: '시작할 준비가 됐어요' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: FIRST_LESSON.title })).toBeInTheDocument();
    expect(screen.getByText(`새 단원 · ${FIRST_LESSON.title}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '첫 단원 시작' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/learn/${FIRST_LESSON.id}`);
    });
    expect(calls).toContainEqual({ method: 'PATCH', path: '/learner', body: { onboarded: true } });
  });

  it('can be left at any step and is not shown again', async () => {
    const { calls, router } = renderApp('/onboarding?step=goal', fakeServer());
    expect(
      await screen.findByRole('heading', { level: 1, name: '학습 목표를 정해요' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '온보딩 건너뛰기' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(calls).toContainEqual({ method: 'PATCH', path: '/learner', body: { onboarded: true } });
    expect(calls.some((c) => c.method === 'PUT' && c.path === '/goals')).toBe(false);
    expect(await screen.findByRole('heading', { level: 1, name: /대시보드/ })).toBeInTheDocument();
  });

  it('skips a step without saving it', async () => {
    const { calls } = renderApp('/onboarding?step=goal', fakeServer());
    await screen.findByRole('heading', { level: 1, name: '학습 목표를 정해요' });
    await userEvent.click(await screen.findByRole('button', { name: '건너뛰기' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: '코딩은 얼마나 해 보셨나요?' }),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('opens the dashboard directly for learners who are done', async () => {
    const { router } = renderApp('/', fakeServer(onboarded));
    expect(await screen.findByRole('heading', { level: 1, name: /대시보드/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('validates a custom daily goal', async () => {
    const { calls } = renderApp('/onboarding?step=goal', fakeServer());
    await screen.findByRole('heading', { level: 1, name: '학습 목표를 정해요' });
    await userEvent.click(await screen.findByRole('radio', { name: '직접 입력' }));
    const input = screen.getByRole('spinbutton', { name: '하루 공부 시간(분)' });
    await userEvent.clear(input);
    await userEvent.type(input, '2');
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('5분에서 480분 사이로 정해 주세요.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});

describe('헤더 목표 링', () => {
  it('shows today against the goal and the week in a popover', async () => {
    renderApp('/', (_m, path) => {
      if (path === '/learner') return { body: onboarded };
      if (path === '/goals') return { body: goalStatus(18, [40, 0, 31, 0, 25]) };
      if (path === '/dashboard') return { body: DASHBOARD };
      return { body: { theme: 'system' } };
    });
    const chip = await screen.findByRole('button', { name: '오늘 목표 18 / 30분' });
    expect(chip).toHaveTextContent('18 / 30분');
    await userEvent.click(chip);
    const popover = await screen.findByRole('dialog', { name: '이번 주 학습 현황' });
    expect(within(popover).getByText('오늘 30분 중 18분 공부했어요.')).toBeInTheDocument();
    expect(
      within(popover).getByRole('group', { name: '이번 주 학습 현황: 목표 5일 중 4일' }),
    ).toBeInTheDocument();
    expect(within(popover).getByText('화요일: 쉬었어요')).toBeInTheDocument();
    expect(within(popover).getByRole('link', { name: '목표 바꾸기' })).toHaveAttribute(
      'href',
      '/settings/goals',
    );
  });

  it('marks a met goal', async () => {
    renderApp('/settings/appearance', (_m, path) => {
      if (path === '/goals') return { body: goalStatus(32) };
      return { body: { theme: 'system' } };
    });
    expect(
      await screen.findByRole('button', { name: '오늘 목표 32 / 30분, 달성' }),
    ).toBeInTheDocument();
  });
});

describe('설정 > 학습 목표', () => {
  it('saves a new goal', async () => {
    const server = fakeServer(onboarded);
    const { calls } = renderApp('/settings/goals', server);
    expect(await screen.findByRole('heading', { level: 1, name: '학습 목표' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('radio', { name: '60분' }));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('목표를 저장했어요')).toBeInTheDocument();
    expect(calls).toContainEqual({
      method: 'PUT',
      path: '/goals',
      body: { dailyMinutes: 60, weeklyDays: 5, targetCourseId: null, targetDate: null },
    });
  });
});
