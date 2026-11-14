import type { DailyPlanView, ReviewQueue, WeakConcepts } from '@proginone/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emptyQueue,
  firstDayPlan,
  goalStatus,
  masteryOverview,
  noWeakConcepts,
  onboarded,
  tile,
  TODAY,
} from '../../test/learning-fixtures.ts';
import { item, MCQ, mcqView, practiceSet, SET_ID } from '../../test/practice-fixtures.ts';
import { renderApp } from '../../test/render-app.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOT_FOUND = {
  status: 404,
  body: { error: { code: 'NOT_FOUND', message: 'x', retryable: false } },
};

interface State {
  plan: DailyPlanView;
  goals: ReturnType<typeof goalStatus>;
  mastery: ReturnType<typeof masteryOverview>;
  queue: ReviewQueue;
  weak: WeakConcepts;
}

function server(state: State) {
  return (method: string, path: string) => {
    switch (path) {
      case '/learner':
        return { body: onboarded };
      case '/daily-plan':
        return { body: state.plan };
      case '/goals':
        return { body: state.goals };
      case '/mastery':
        return { body: state.mastery };
      case '/review-queue':
        return { body: state.queue };
      case '/weak-concepts':
        return { body: state.weak };
      case '/dashboard':
        return {
          body: {
            date: TODAY,
            activeMinutesToday: 0,
            reviewDueCount: state.queue.due.length,
            continueLesson: null,
          },
        };
      case '/settings':
        return { body: { theme: 'system' } };
    }
    if (method === 'POST' && path === '/practice-sets') return { body: weaknessSet };
    if (path === `/practice-sets/${SET_ID}`) return { body: weaknessSet };
    if (path.startsWith(`/exercises/${encodeURIComponent(MCQ)}`)) return { body: mcqView };
    return NOT_FOUND;
  };
}

const weaknessSet = practiceSet({
  kind: 'weakness',
  lessonId: null,
  passRule: null,
  items: [item(0, MCQ, 'mcq_single', { reason: 'weakness' })],
});

const fresh = (): State => ({
  plan: firstDayPlan(),
  goals: goalStatus(),
  mastery: masteryOverview(),
  queue: emptyQueue,
  weak: noWeakConcepts,
});

const due = (conceptId: string, title: string) => ({
  conceptId,
  title,
  dueAt: 1,
  overdue: false,
  overdueDays: 0,
  itemCount: 1,
  estimatedSeconds: 90,
  priority: 1,
});

/** A learner a few weeks in: reviews due, a lesson in progress, a weak concept. */
const active = (): State => {
  const plan: DailyPlanView = {
    ...firstDayPlan(),
    activeMinutesToday: 12,
    budgetMinutes: 18,
    blocks: [
      {
        kind: 'review',
        minutes: 6,
        reason: { code: 'reviews_due', count: 2, overdueCount: 1 },
        concepts: [
          { id: 'js.basics.statement', title: '문장과 실행 순서' },
          { id: 'js.basics.console-log', title: 'console.log로 출력하기' },
        ],
        lesson: null,
        partial: false,
      },
      {
        kind: 'continue',
        minutes: 8,
        reason: { code: 'continue_lesson', remainingMinutes: 8 },
        concepts: [],
        lesson: {
          id: 'js-basics.values.variables',
          title: '변수 선언',
          status: 'practicing',
          practiceSetId: SET_ID,
        },
        partial: false,
      },
      {
        kind: 'weakness',
        minutes: 4,
        reason: { code: 'weak_concepts', topEffective: 38 },
        concepts: [{ id: 'js.basics.const', title: 'const 선언' }],
        lesson: null,
        partial: false,
      },
    ],
    totalMinutes: 18,
    goal: {
      ...firstDayPlan().goal,
      targetCourse: { id: 'js-basics', title: 'JavaScript 기초' },
      targetDate: '2027-03-31',
    },
    pace: {
      status: 'behind',
      targetDate: '2027-03-31',
      remainingMinutes: 600,
      studyDaysLeft: 10,
      requiredPerDay: 60,
      newLearningBudget: 15,
      suggestedDailyMinutes: 60,
      suggestedTargetDate: '2027-05-01',
      calibration: 1,
    },
  };
  return {
    plan,
    goals: goalStatus(12, [35, 0, 40]),
    mastery: masteryOverview(
      {
        start: [
          tile('js.basics.statement', '문장과 실행 순서', {
            stage: 'proficient',
            effective: 72,
            reviewDue: true,
            nextReviewDate: TODAY,
          }),
          tile('js.basics.console-log', 'console.log로 출력하기', {
            stage: 'mastered',
            effective: 91,
            nextReviewDate: '2026-11-16',
          }),
        ],
        values: [
          tile('js.basics.let', 'let 선언', {
            stage: 'practicing',
            effective: 55,
            nextReviewDate: '2026-11-20',
          }),
          tile('js.basics.const', 'const 선언', {
            stage: 'introduced',
            effective: 38,
            misconceptions: [
              { id: 'js.mc.const', title: 'const도 다시 대입할 수 있다', status: 'confirmed' },
            ],
          }),
        ],
      },
      1,
    ),
    queue: {
      ...emptyQueue,
      due: [
        due('js.basics.statement', '문장과 실행 순서'),
        due('js.basics.console-log', 'console.log로 출력하기'),
      ],
      estimatedMinutes: 3,
    },
    weak: {
      suggested: ['js.basics.const'],
      concepts: [
        {
          concept: { id: 'js.basics.const', title: 'const 선언' },
          weakness: 0.8,
          effective: 38,
          stage: 'introduced',
          consecutiveFailures: 2,
          factors: { gap: 1, importanceFactor: 1, misconceptionFactor: 1.5, failureFactor: 1.2 },
          misconceptions: [
            { id: 'js.mc.const', title: 'const도 다시 대입할 수 있다', status: 'confirmed' },
          ],
          prerequisites: [
            {
              concept: { id: 'js.basics.let', title: 'let 선언' },
              stage: 'practicing',
              effective: 55,
              weak: true,
            },
          ],
        },
      ],
    },
  };
};

describe('대시보드', () => {
  it('first run: one item, an empty concept map and empty cards', async () => {
    renderApp('/', server(fresh()));
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /환영해요! 첫 단원부터 시작해 볼까요?/,
      }),
    ).toBeInTheDocument();
    const plan = screen.getByRole('region', { name: '오늘의 학습' });
    const items = within(plan).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('새 단원 · 첫 프로그램');
    expect(items[0]).toHaveTextContent('첫 단원부터 시작해요');
    const startLink = within(plan).getByRole('link', { name: '단원 시작' });
    expect(startLink).toHaveClass('pi-button--primary');
    expect(startLink).toHaveAttribute('href', '/learn/js-basics.start.first-program');

    const map = screen.getByRole('region', { name: /개념 지도/ });
    expect(await within(map).findByText(/학습하면 여기가 채워져요/)).toBeInTheDocument();
    expect(within(map).getAllByRole('img', { name: '숙련 단계: 미학습' })).toHaveLength(4);
    expect(within(map).getByRole('heading', { name: /1\. 시작하기/ })).toHaveTextContent(
      '0 / 1단원 완료',
    );

    expect(
      within(screen.getByRole('region', { name: '오늘의 복습' })).getByText(
        '오늘 복습할 개념이 없어요.',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: '약점 개념' })).getByText(/아직 약점이 없어요/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: '과정 진도' })).getByText(
        /0 \/ 2단원 완료 · 아직 시작 전/,
      ),
    ).toBeInTheDocument();
    // Only one primary action on the page.
    expect(document.querySelectorAll('.pi-button--primary')).toHaveLength(1);
  });

  it('active learner: plan with reasons, reviews, pace, concept map markers and progress', async () => {
    renderApp('/', server(active()));
    expect(
      await screen.findByRole('heading', { level: 1, name: /오늘 12분 공부했어요/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('오늘 목표 30분까지 18분 남았어요.')).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: '이번 주 학습 현황: 목표 5일 중 3일' }),
    ).toBeInTheDocument();

    const plan = screen.getByRole('region', { name: '오늘의 학습' });
    const items = within(plan).getAllByRole('listitem');
    const [first, second] = items.map((i) => within(i));
    expect(items.map((i) => i.querySelector('.plan-item__title')?.textContent)).toEqual([
      '복습 2개 개념',
      '이어서 학습 · 변수 선언',
      '약점 집중 · const 선언',
    ]);
    expect(items[0]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).toHaveTextContent('예정일이 지난 개념 1개');
    expect(first?.getByRole('button', { name: '복습 시작' })).toHaveClass('pi-button--primary');
    expect(second?.getByRole('link', { name: '이어서 학습' })).toHaveAttribute(
      'href',
      `/learn/js-basics.values.variables?mode=practice&set=${SET_ID}`,
    );
    // Pace "behind" is amber text with a way to change the goal, never an alarm.
    expect(within(plan).getByText(/목표일을 맞추려면 하루 60분이 필요해요/)).toBeInTheDocument();
    expect(within(plan).getByRole('link', { name: '목표 수정' })).toHaveAttribute(
      'href',
      '/settings/goals',
    );

    const review = screen.getByRole('region', { name: '오늘의 복습' });
    expect(within(review).getByText('2개')).toBeInTheDocument();
    expect(within(review).getByText('console.log로 출력하기')).toBeInTheDocument();

    const map = screen.getByRole('region', { name: /개념 지도/ });
    expect(
      within(map).getByRole('img', { name: '숙련 단계: 숙련, 복습 예정' }),
    ).toBeInTheDocument();
    expect(within(map).getByRole('img', { name: '숙련 단계: 숙달' })).toBeInTheDocument();
    expect(within(map).getByRole('img', { name: '숙련 단계: 입문, 약점' })).toBeInTheDocument();
    expect(within(map).getByText('내일')).toBeInTheDocument();
    expect(within(map).getByText('11/20')).toBeInTheDocument();

    expect(
      within(screen.getByRole('region', { name: '과정 진도' })).getByRole('progressbar', {
        name: 'JavaScript 기초 단원 진도',
      }),
    ).toHaveAttribute('aria-valuenow', '50');
  });

  it('filters the concept map to due or weak concepts', async () => {
    const user = userEvent.setup();
    renderApp('/', server(active()));
    const map = await screen.findByRole('region', { name: /개념 지도/ });
    await within(map).findByText('let 선언');
    await user.click(within(map).getByRole('combobox', { name: '보기' }));
    await user.click(await screen.findByRole('option', { name: '복습 예정만' }));
    await waitFor(() => {
      expect(within(map).queryByText('let 선언')).not.toBeInTheDocument();
    });
    expect(within(map).getByText('문장과 실행 순서')).toBeInTheDocument();

    await user.click(within(map).getByRole('combobox', { name: '보기' }));
    await user.click(await screen.findByRole('option', { name: '약점만' }));
    await waitFor(() => {
      expect(within(map).queryByText('문장과 실행 순서')).not.toBeInTheDocument();
    });
    expect(within(map).getByText('const 선언')).toBeInTheDocument();
  });

  it('starts a weakness set from the weak concepts card', async () => {
    const user = userEvent.setup();
    const { calls, router } = renderApp('/', server(active()));
    const weak = await screen.findByRole('region', { name: '약점 개념' });
    const box = await within(weak).findByRole('checkbox', { name: /const 선언/ });
    expect(box).toBeChecked();
    expect(within(weak).getByText(/오개념 ‘const도 다시 대입할 수 있다’/)).toBeInTheDocument();
    expect(within(weak).getByText(/선수 개념 ‘let 선언’부터 확인해요/)).toBeInTheDocument();
    await user.click(within(weak).getByRole('button', { name: '약점 집중 시작 (1개 개념)' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/review/session/${SET_ID}`);
    });
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/practice-sets',
      body: { kind: 'weakness', conceptIds: ['js.basics.const'] },
    });
    expect(await screen.findByRole('heading', { level: 1, name: '약점 집중' })).toBeInTheDocument();
  });

  it('cannot start a weakness set with nothing selected', async () => {
    const user = userEvent.setup();
    renderApp('/', server(active()));
    const weak = await screen.findByRole('region', { name: '약점 개념' });
    await user.click(await within(weak).findByRole('checkbox', { name: /const 선언/ }));
    expect(within(weak).getByRole('button', { name: '약점 집중 시작' })).toBeDisabled();
  });

  it('shows the next review when nothing is due today', async () => {
    const state = active();
    renderApp('/', server({ ...state, queue: emptyQueue }));
    const review = await screen.findByRole('region', { name: '오늘의 복습' });
    expect(await within(review).findByText('다음 복습: 내일 1개')).toBeInTheDocument();
  });

  it('shows a page error when the server cannot be reached', async () => {
    renderApp('/', (_m, path) => {
      if (path === '/learner') return { body: onboarded };
      return {
        status: 500,
        body: { error: { code: 'INTERNAL', message: '오류', retryable: false } },
      };
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: '대시보드를 불러오지 못했어요' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });
});
