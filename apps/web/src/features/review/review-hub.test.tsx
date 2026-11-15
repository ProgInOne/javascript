import type {
  MasteryChanges,
  MistakeDetail,
  MistakeList,
  MistakeNote,
  WeakConcepts,
} from '@proginone/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { item, MCQ, mcqView, practiceSet, SET_ID } from '../../test/practice-fixtures.ts';
import { renderApp } from '../../test/render-app.tsx';
import { excerpt } from './format.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const notFound = {
  status: 404,
  body: { error: { code: 'NOT_FOUND', message: '없음', retryable: false } },
};

const note = (over: Partial<MistakeNote> = {}): MistakeNote => ({
  exerciseId: MCQ,
  type: 'mcq_single',
  difficulty: 2,
  prompt: '`console.log("1" + 2)`의 **결과**는?',
  concept: { id: 'js.basics.console-log', title: 'console.log로 출력하기' },
  module: { id: 'js-basics.start', title: '시작하기' },
  course: { id: 'js-basics', title: 'JavaScript 기초' },
  lastWrongAt: Date.UTC(2026, 10, 12, 3),
  lastWrongOutcome: 'incorrect',
  lastWrongContext: 'lesson',
  wrongCount: 1,
  confidentWrong: true,
  misconceptions: [{ id: 'mc', title: '문자열 + 숫자를 덧셈으로 생각함' }],
  status: 'open',
  resolvedAt: null,
  archived: false,
  retry: { available: true, blockedBy: null },
  ...over,
});

const list = (items: MistakeNote[], over: Partial<MistakeList> = {}): MistakeList => ({
  items,
  total: items.length,
  counts: {
    all: items.length,
    open: items.filter((n) => n.status === 'open').length,
    resolved: items.filter((n) => n.status === 'resolved').length,
  },
  facets: {
    courses: [{ id: 'js-basics', title: 'JavaScript 기초' }],
    modules: [{ id: 'js-basics.start', title: '시작하기', courseId: 'js-basics' }],
    concepts: [
      { id: 'js.basics.console-log', title: 'console.log로 출력하기', moduleId: 'js-basics.start' },
    ],
  },
  ...over,
});

const OTHER = 'js-basics.start.first-program.tf-x';
const resolvedNote = note({
  exerciseId: OTHER,
  type: 'true_false',
  prompt: '문장은 위에서 아래로 실행된다.',
  status: 'resolved',
  resolvedAt: Date.UTC(2026, 10, 13, 3),
  confidentWrong: false,
  misconceptions: [],
});

const base = (method: string, path: string) => {
  if (path === '/settings') return { body: { theme: 'system' } };
  if (path === '/dashboard') {
    return {
      body: {
        date: '2026-11-15',
        activeMinutesToday: 0,
        reviewDueCount: 0,
        continueLesson: null,
      },
    };
  }
  return method === 'GET' && path === '' ? { body: null } : null;
};

describe('review hub', () => {
  it('links the four review sections and marks the current one', async () => {
    renderApp('/review/mistakes', (method, path) => {
      if (path.startsWith('/mistakes')) return { body: list([]) };
      return base(method, path) ?? notFound;
    });
    const nav = await screen.findByRole('navigation', { name: '복습 화면' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      '오늘의 복습',
      '오답 노트',
      '약점 집중',
      '숙련도 변화',
    ]);
    expect(within(nav).getByRole('link', { name: '오답 노트' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: '오늘의 복습' })).not.toHaveAttribute(
      'aria-current',
    );
  });
});

describe('오답 노트', () => {
  it('shows the empty state for a learner without mistakes', async () => {
    renderApp('/review/mistakes', (method, path) => {
      if (path.startsWith('/mistakes')) return { body: list([], { facets: list([]).facets }) };
      return base(method, path) ?? notFound;
    });
    expect(await screen.findByRole('heading', { name: '아직 틀린 문제가 없어요' })).toBeVisible();
    expect(screen.getByRole('link', { name: '연습하러 가기' })).toHaveAttribute('href', '/courses');
  });

  it('lists notes with marks, dates, the confident flag and misconceptions', async () => {
    renderApp('/review/mistakes', (method, path) => {
      if (path.startsWith('/mistakes')) return { body: list([note(), resolvedNote]) };
      return base(method, path) ?? notFound;
    });
    const notes = within(await screen.findByRole('list', { name: '오답 목록' })).getAllByRole(
      'listitem',
    );
    expect(notes).toHaveLength(2);
    const [open, resolved] = notes as [HTMLElement, HTMLElement];
    expect(within(open).getByRole('heading')).toHaveTextContent(
      '아직 못 맞힌 오답: 객관식 · L2 · console.log로 출력하기',
    );
    expect(within(open).getByText('확실했어요')).toBeVisible();
    expect(within(open).getByText(/11\/12 오답/)).toBeVisible();
    expect(within(open).getByText('console.log("1" + 2)의 결과는?')).toBeVisible();
    expect(within(open).getByText('오개념: 문자열 + 숫자를 덧셈으로 생각함')).toBeVisible();
    expect(within(resolved).getByRole('heading')).toHaveTextContent(/^다시 맞힌 오답/);
    expect(within(resolved).getByText(/11\/13 다시 맞힘/)).toBeVisible();
    expect(screen.getByText('오답 2개 · 아직 못 맞힌 것 1개 · 다시 맞힌 것 1개')).toBeVisible();
  });

  it('keeps the "아직 못 맞힌 것만" filter in the address and the request', async () => {
    const user = userEvent.setup();
    const { calls, router } = renderApp('/review/mistakes', (method, path) => {
      if (path.startsWith('/mistakes')) return { body: list([note(), resolvedNote]) };
      return base(method, path) ?? notFound;
    });
    await user.click(await screen.findByRole('checkbox', { name: '아직 못 맞힌 것만' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ open: true });
    });
    await waitFor(() => {
      expect(
        calls.some((c) => c.path.startsWith('/mistakes?') && c.path.includes('status=open')),
      ).toBe(true);
    });
  });

  it('offers a filter reset when the filters match nothing', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/review/mistakes?open=1', (method, path) => {
      if (path.startsWith('/mistakes')) {
        return { body: list([], { counts: { all: 2, open: 0, resolved: 2 } }) };
      }
      return base(method, path) ?? notFound;
    });
    expect(await screen.findByRole('heading', { name: '조건에 맞는 오답이 없어요' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '필터 지우기' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
  });

  it('starts a "다시 풀기" set for the note and opens it', async () => {
    const user = userEvent.setup();
    const retrySet = practiceSet({
      kind: 'extra',
      lessonId: null,
      passRule: null,
      items: [item(0, MCQ, 'mcq_single', { reason: 'mistake_retry' })],
    });
    const { calls, router } = renderApp('/review/mistakes', (method, path) => {
      if (path.startsWith('/mistakes')) return { body: list([note()]) };
      if (method === 'POST' && path === '/practice-sets') return { body: retrySet };
      if (path === `/practice-sets/${SET_ID}`) return { body: retrySet };
      if (path.startsWith(`/exercises/${encodeURIComponent(MCQ)}`)) return { body: mcqView };
      return base(method, path) ?? notFound;
    });
    await user.click(await screen.findByRole('button', { name: '다시 풀기' }));
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/practice-sets',
      body: { kind: 'extra', exerciseIds: [MCQ] },
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/review/session/${SET_ID}`);
    });
    expect(await screen.findByRole('heading', { level: 1, name: '다시 풀기' })).toBeVisible();
  });

  it('offers similar exercises for assessment-only notes', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp('/review/mistakes', (method, path) => {
      if (path.startsWith('/mistakes')) {
        return {
          body: list([
            note({
              lastWrongContext: 'assessment',
              retry: { available: false, blockedBy: 'assessment_only' },
            }),
          ]),
        };
      }
      if (method === 'POST') {
        return {
          status: 409,
          body: {
            error: { code: 'PRACTICE_NOTHING_WEAK', message: '약점 없음', retryable: false },
          },
        };
      }
      return base(method, path) ?? notFound;
    });
    expect(await screen.findByText('단원 평가')).toBeVisible();
    expect(screen.queryByRole('button', { name: '다시 풀기' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '비슷한 문제 풀기' }));
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/practice-sets',
      body: { kind: 'weakness', conceptIds: ['js.basics.console-log'] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('약점 없음');
  });

  it('shows an error with a retry when the list fails', async () => {
    renderApp('/review/mistakes', (method, path) => {
      if (path.startsWith('/mistakes')) {
        return {
          status: 500,
          body: { error: { code: 'INTERNAL', message: '서버 오류', retryable: true } },
        };
      }
      return base(method, path) ?? notFound;
    });
    expect(await screen.findByRole('heading', { name: '불러오지 못했어요' })).toBeVisible();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeVisible();
  });
});

const detail = (over: Partial<MistakeDetail> = {}): MistakeDetail => ({
  note: note({ wrongCount: 2 }),
  code: null,
  codeLanguage: 'javascript',
  attempts: [
    {
      id: 'a2',
      submittedAt: Date.UTC(2026, 10, 12, 3),
      outcome: 'incorrect',
      confidence: 'sure',
      context: 'lesson',
      answer: { kind: 'choice', choiceId: 'a', text: '3' },
      misconceptions: [{ id: 'mc', title: '문자열 + 숫자를 덧셈으로 생각함' }],
      feedback: ['정답이 아니에요.'],
      hintLevelMax: 1,
      solutionViewed: false,
    },
    {
      id: 'a1',
      submittedAt: Date.UTC(2026, 10, 10, 3),
      outcome: 'incorrect',
      confidence: 'guess',
      context: 'review',
      answer: { kind: 'choice', choiceId: 'c', text: '오류가 난다' },
      misconceptions: [],
      feedback: [],
      hintLevelMax: 0,
      solutionViewed: false,
    },
  ],
  explanation: '문자열과 숫자를 `+`로 더하면 이어 붙여요.',
  solution: null,
  solutionSource: null,
  ...over,
});

describe('오답 노트 상세', () => {
  it('shows my answers, feedback and the explanation but keeps an unseen answer locked', async () => {
    const user = userEvent.setup();
    renderApp(`/review/mistakes/${encodeURIComponent(MCQ)}`, (method, path) => {
      if (path === `/mistakes/${encodeURIComponent(MCQ)}`) return { body: detail() };
      return base(method, path) ?? notFound;
    });
    expect(await screen.findByRole('heading', { level: 2, name: /객관식 · L2/ })).toBeVisible();
    expect(screen.getByText('아직 못 맞힘')).toBeVisible();
    expect(screen.getByRole('heading', { name: /내 답 \(11\/12\)/ })).toBeVisible();
    expect(screen.getByText('3')).toBeVisible();
    expect(screen.getByText('정답이 아니에요.')).toBeVisible();
    expect(
      screen.getByText('고른 답이 가리키는 오개념: 문자열 + 숫자를 덧셈으로 생각함'),
    ).toBeVisible();
    expect(screen.getByText(/정답은 다시 풀면서 확인해요/)).toBeVisible();
    // Older wrong answers are folded.
    await user.click(screen.getByText('이전에 틀린 답 1개'));
    expect(screen.getByText('오류가 난다')).toBeVisible();
    expect(screen.getByRole('link', { name: '오답 노트 목록' })).toHaveAttribute(
      'href',
      '/review/mistakes',
    );
  });

  it('shows the reference answer the learner has seen, with where it came from', async () => {
    renderApp(`/review/mistakes/${encodeURIComponent(MCQ)}`, (method, path) => {
      if (path === `/mistakes/${encodeURIComponent(MCQ)}`) {
        return {
          body: detail({
            solution: { kind: 'choice', choiceId: 'b', text: '"12"' },
            solutionSource: 'assessment',
          }),
        };
      }
      return base(method, path) ?? notFound;
    });
    expect(await screen.findByText('"12"')).toBeVisible();
    expect(screen.getByText('단원 평가 결과에서 확인한 정답이에요.')).toBeVisible();
  });

  it('shows not found for an exercise without notes', async () => {
    renderApp('/review/mistakes/nope', (method, path) => base(method, path) ?? notFound);
    expect(await screen.findByRole('heading', { name: '오답 노트에 없는 문제예요' })).toBeVisible();
  });
});

const weak: WeakConcepts = {
  concepts: [
    {
      concept: { id: 'js.basics.coercion', title: '형 변환' },
      weakness: 0.8,
      effective: 32,
      stage: 'introduced',
      consecutiveFailures: 3,
      factors: { gap: 0.5, importanceFactor: 1, misconceptionFactor: 1, failureFactor: 1 },
      misconceptions: [{ id: 'mc', title: '문자열 + 숫자를 덧셈으로 생각함', status: 'confirmed' }],
      prerequisites: [
        {
          concept: { id: 'js.basics.types', title: '자료형' },
          stage: 'introduced',
          effective: 40,
          weak: true,
        },
      ],
    },
    {
      concept: { id: 'js.basics.compare', title: '비교 연산자' },
      weakness: 0.4,
      effective: 55,
      stage: 'practicing',
      consecutiveFailures: 0,
      factors: { gap: 0.5, importanceFactor: 1, misconceptionFactor: 1, failureFactor: 1 },
      misconceptions: [],
      prerequisites: [],
    },
  ],
  suggested: ['js.basics.coercion'],
};

describe('약점 집중', () => {
  it('explains each weak concept and starts a set for the picked ones', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp('/review/weak', (method, path) => {
      if (path === '/weak-concepts') return { body: weak };
      if (method === 'POST') {
        return {
          status: 409,
          body: {
            error: { code: 'PRACTICE_NO_EXERCISES', message: '문제 없음', retryable: false },
          },
        };
      }
      return base(method, path) ?? notFound;
    });
    expect(await screen.findByText(/선수 개념 ‘자료형’부터 확인해요/)).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /형 변환/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /비교 연산자/ })).not.toBeChecked();
    const [firstWhy] = screen.getAllByText('왜 약점인가요?');
    if (!firstWhy) throw new Error('no why');
    await user.click(firstWhy);
    expect(screen.getByText('최근 3번 연속으로 틀렸어요.')).toBeVisible();
    expect(
      screen.getByText('오개념 ‘문자열 + 숫자를 덧셈으로 생각함’이 확인됐어요.'),
    ).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: /비교 연산자/ }));
    await user.click(screen.getByRole('button', { name: '약점 집중 시작 (2개 개념)' }));
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/practice-sets',
      body: { kind: 'weakness', conceptIds: ['js.basics.coercion', 'js.basics.compare'] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('문제 없음');
  });

  it('shows the empty state without weak concepts', async () => {
    renderApp('/review/weak', (method, path) => {
      if (path === '/weak-concepts') return { body: { concepts: [], suggested: [] } };
      return base(method, path) ?? notFound;
    });
    expect(await screen.findByRole('heading', { name: '아직 약점이 없어요' })).toBeVisible();
  });
});

const weeks = (counts: [number, number][]): MasteryChanges['weeks'] =>
  counts.map(([promotions, demotions], i) => ({
    weekStart: `2026-${i < 6 ? '10' : '11'}-${String(i < 6 ? 5 + i * 4 : (i - 6) * 7 + 2).padStart(2, '0')}`,
    promotions,
    demotions,
    concepts: promotions + demotions,
  }));

describe('숙련도 변화', () => {
  it('shows weekly bars with a table view and the latest changes', async () => {
    const user = userEvent.setup();
    renderApp('/review/progress', (method, path) => {
      if (path === '/mastery-changes') {
        return {
          body: {
            date: '2026-11-15',
            weeks: weeks([
              [0, 0],
              [0, 0],
              [1, 0],
              [0, 0],
              [2, 1],
              [0, 0],
              [3, 0],
              [2, 1],
            ]),
            recent: [
              {
                id: 'e1',
                at: 2,
                date: '2026-11-14',
                concept: { id: 'js.basics.coercion', title: '형 변환' },
                stageBefore: 'introduced',
                stageAfter: 'practicing',
                direction: 'up',
                scoreBefore: 40,
                scoreAfter: 52,
              },
              {
                id: 'e2',
                at: 1,
                date: '2026-11-13',
                concept: { id: 'js.basics.compare', title: '비교 연산자' },
                stageBefore: 'practicing',
                stageAfter: 'introduced',
                direction: 'down',
                scoreBefore: 50,
                scoreAfter: 44,
              },
            ],
            totals: { promotions: 8, demotions: 2 },
          } satisfies MasteryChanges,
        };
      }
      return base(method, path) ?? notFound;
    });
    expect(await screen.findByText('최근 8주 · 상승 8 · 하락 2')).toBeVisible();
    expect(screen.getByText('이번 주: 상승 2, 하락 1')).toBeInTheDocument();
    const recent = screen.getByRole('region', { name: '최근 바뀐 개념' });
    expect(within(recent).getByRole('link', { name: '형 변환' })).toHaveAttribute(
      'href',
      '/concepts/js.basics.coercion',
    );
    expect(within(recent).getByLabelText('상승')).toBeInTheDocument();
    expect(within(recent).getByLabelText('하락')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '표로 보기' }));
    const table = screen.getByRole('table');
    expect(within(table).getByRole('rowheader', { name: '이번 주' })).toBeVisible();
    expect(within(table).getAllByRole('row')).toHaveLength(9);
  });

  it('shows the empty state before any stage change', async () => {
    renderApp('/review/progress', (method, path) => {
      if (path === '/mastery-changes') {
        return {
          body: {
            date: '2026-11-15',
            weeks: weeks(Array.from({ length: 8 }, () => [0, 0] as [number, number])),
            recent: [],
            totals: { promotions: 0, demotions: 0 },
          },
        };
      }
      return base(method, path) ?? notFound;
    });
    expect(
      await screen.findByRole('heading', { name: '아직 숙련 단계가 바뀐 개념이 없어요' }),
    ).toBeVisible();
  });
});

describe('excerpt', () => {
  it('turns the first prompt line into short plain text', () => {
    expect(excerpt('## 제목\n본문')).toBe('제목');
    expect(excerpt('```js\ncode\n```\n')).toBe('code');
    expect(excerpt('[링크](https://x) 와 `코드`')).toBe('링크 와 코드');
    expect(excerpt('가'.repeat(100), 10)).toBe(`${'가'.repeat(9)}…`);
  });
});
