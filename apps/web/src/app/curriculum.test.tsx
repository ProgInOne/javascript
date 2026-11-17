import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render-app.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const course = {
  id: 'js-basics',
  title: 'JavaScript 기초',
  summary: 'JS를 배워요',
  language: 'javascript',
  level: 'basic',
  estimatedMinutes: 90,
  lessonCount: 2,
};
const lessonSummary = (id: string, title: string) => ({
  id,
  title,
  summary: 's',
  kind: 'lesson',
  importance: 'core',
  estimatedMinutes: 45,
  exerciseCount: 12,
});
const lesson = {
  id: 'js-basics.start.first-program',
  title: '첫 프로그램',
  summary: 's',
  kind: 'lesson',
  importance: 'core',
  course: { id: 'js-basics', title: 'JavaScript 기초', language: 'javascript' },
  module: { id: 'js-basics.start', title: '시작하기' },
  objectives: ['출력할 수 있다'],
  estimatedMinutes: 45,
  readMinutes: 12,
  sections: [
    { id: 'objectives', kind: 'objectives', title: null },
    { id: 'intro', kind: 'intro', title: null },
  ],
  body: [
    {
      type: 'component',
      name: 'Section',
      props: { kind: 'objectives', id: 'objectives' },
      children: [{ type: 'paragraph', children: [{ type: 'text', value: '목표 본문' }] }],
    },
    { type: 'component', name: 'Section', props: { kind: 'intro', id: 'intro' }, children: [] },
  ],
  concepts: [
    {
      id: 'js.basics.statement',
      title: '문장',
      summary: 's',
      importance: 'core',
      role: 'introduces',
    },
  ],
  previous: null,
  next: { id: 'js-basics.start.reading-errors', title: '오류 읽기' },
  contentHash: 'h',
};

function api(_method: string, path: string) {
  if (path === '/settings') return { body: { theme: 'system' } };
  if (path === '/courses') {
    return {
      body: {
        packVersion: 'v',
        tracks: [{ id: 'web', title: '웹 기초', summary: '웹', courses: [course] }],
      },
    };
  }
  if (path === '/courses/js-basics') {
    return {
      body: {
        ...course,
        objectives: ['프로그램을 쓴다'],
        modules: [
          {
            id: 'js-basics.start',
            title: '시작하기',
            summary: 's',
            lessons: [
              lessonSummary(lesson.id, '첫 프로그램'),
              lessonSummary('js-basics.start.reading-errors', '오류 읽기'),
            ],
          },
        ],
      },
    };
  }
  if (path === `/lessons/${encodeURIComponent(lesson.id)}`) return { body: lesson };
  return {
    status: 404,
    body: { error: { code: 'NOT_FOUND', message: '단원을 찾을 수 없습니다.', retryable: false } },
  };
}

describe('curriculum screens', () => {
  it('shows an empty state when the content pack has no courses (FR-UI-03)', async () => {
    renderApp('/courses', (method, path) =>
      path === '/courses' ? { body: { packVersion: 'v', tracks: [] } } : api(method, path),
    );
    expect(
      await screen.findByRole('heading', { level: 2, name: '아직 과정이 없어요' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: '과정' })).toBeInTheDocument();
  });

  it('goes from the course list to the course and opens a lesson', async () => {
    const { router } = renderApp('/courses', api);
    await userEvent.click(await screen.findByRole('link', { name: /JavaScript 기초/ }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'JavaScript 기초' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/1개 모듈 · 2개 단원 · 약 1시간 30분 · 문제 24개/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: '학습 시작' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: '첫 프로그램' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/learn/${lesson.id}`);
  });

  it('marks lessons with weak prerequisites with a named, tooltipped link (D-073)', async () => {
    const { router } = renderApp('/courses/js-basics', (method, path) =>
      path === '/courses/js-basics/prerequisite-warnings'
        ? {
            body: {
              courseId: 'js-basics',
              lessons: [
                {
                  lessonId: lesson.id,
                  concepts: [
                    {
                      id: 'js.basics.comment',
                      title: '주석',
                      lesson: { id: 'js-basics.start.reading-errors', title: '오류 읽기' },
                    },
                  ],
                },
              ],
            },
          }
        : api(method, path),
    );
    const mark = await screen.findByRole('link', {
      name: '선수 개념 안내: 먼저 ‘주석’부터 확인하면 더 쉬워요. ‘오류 읽기’ 단원 보기',
    });
    // One mark: the other lesson has no weak prerequisite. The row link stays separate.
    expect(screen.getAllByRole('link', { name: /선수 개념 안내/ })).toHaveLength(1);
    expect(screen.getByRole('link', { name: /첫 프로그램/ })).not.toContainElement(mark);
    mark.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      '먼저 ‘주석’부터 확인하면 더 쉬워요',
    );
    await userEvent.click(mark);
    expect(router.state.location.pathname).toBe('/learn/js-basics.start.reading-errors');
  });

  it('shows the lesson with a focused header, table of contents, and next link', async () => {
    renderApp(`/learn/${lesson.id}`, api);
    expect(await screen.findByText('목표 본문')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '주 메뉴' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'JavaScript 기초 과정으로 돌아가기' }),
    ).toBeInTheDocument();
    const toc = screen.getByRole('navigation', { name: '목차' });
    expect(
      within(toc)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['학습 목표', '왜 필요할까요']);
    expect(screen.getByRole('link', { name: /다음: 오류 읽기/ })).toBeInTheDocument();
  });

  it('folds the lesson side column and remembers it (FR-UI-01)', async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp(`/learn/${lesson.id}`, api);
    await user.click(await screen.findByRole('button', { name: '단원 정보 접기' }));
    expect(screen.queryByRole('navigation', { name: '목차' })).not.toBeInTheDocument();
    expect(localStorage.getItem('proginone:panel:lesson-aside-collapsed')).toBe('true');
    unmount();

    renderApp(`/learn/${lesson.id}`, api);
    const unfold = await screen.findByRole('button', { name: '단원 정보 펼치기' });
    expect(unfold).toHaveAttribute('aria-expanded', 'false');
    await user.click(unfold);
    expect(screen.getByRole('navigation', { name: '목차' })).toBeInTheDocument();
  });

  it('shows empty states for a course or a module without lessons (FR-UI-03)', async () => {
    renderApp('/courses/js-basics', (method, path) =>
      path === '/courses/js-basics'
        ? {
            body: {
              ...course,
              lessonCount: 0,
              objectives: [],
              modules: [{ id: 'js-basics.start', title: '시작하기', summary: 's', lessons: [] }],
            },
          }
        : api(method, path),
    );
    expect(
      await screen.findByRole('heading', { name: '이 과정에는 아직 단원이 없어요' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: '과정 목록 보기' })).toHaveAttribute(
      'href',
      '/courses',
    );
    expect(screen.getByText('이 모듈에는 아직 단원이 없어요.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '학습 시작' })).not.toBeInTheDocument();
  });

  it('shows a not-found page for an unknown lesson', async () => {
    renderApp('/learn/nope.nope.nope', api);
    expect(
      await screen.findByRole('heading', { level: 1, name: '단원을 찾을 수 없어요' }),
    ).toBeInTheDocument();
  });
});

describe('course progress (D-083)', () => {
  const READING = 'js-basics.start.reading-errors';
  const summary = {
    courseId: 'js-basics',
    lessons: { total: 2, completed: 1 },
    state: 'in_progress',
    next: { id: READING, title: '오류 읽기', status: 'reading' },
  };
  const detail = {
    ...summary,
    modules: [{ moduleId: 'js-basics.start', lessons: { total: 2, completed: 1 } }],
    lessonStatuses: [
      { lessonId: lesson.id, status: 'completed', readProgress: 1 },
      { lessonId: READING, status: 'reading', readProgress: 0.45 },
    ],
  };
  const withProgress =
    (list: object, course: object, extra?: (path: string) => { body: unknown } | undefined) =>
    (method: string, path: string) =>
      extra?.(path) ??
      (path === '/course-progress'
        ? { body: list }
        : path === '/courses/js-basics/progress'
          ? { body: course }
          : api(method, path));

  it('shows the progress, state and next lesson on the course card', async () => {
    const { router } = renderApp('/courses', withProgress({ courses: [summary] }, detail));
    const bar = await screen.findByRole('progressbar', { name: 'JavaScript 기초 진행률' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('2단원 중 1단원 완료')).toBeVisible();
    expect(screen.getByText('진행 중')).toBeVisible();
    // Two separate links: the card (title) and "이어서 학습" (never nested).
    const card = screen.getByRole('link', { name: 'JavaScript 기초' });
    const resume = screen.getByRole('link', { name: '이어서 학습: 오류 읽기' });
    expect(card).not.toContainElement(resume);
    await userEvent.click(resume);
    expect(router.state.location.pathname).toBe(`/learn/${READING}`);
  });

  it('shows no progress on the card when the progress request fails', async () => {
    renderApp('/courses', api);
    expect(await screen.findByRole('link', { name: 'JavaScript 기초' })).toBeVisible();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/이어서 학습/)).not.toBeInTheDocument();
  });

  it('marks modules and lessons, the lesson to do now, and continues there', async () => {
    const { router } = renderApp(
      '/courses/js-basics',
      withProgress({ courses: [summary] }, detail, (path) =>
        path === '/courses/js-basics/prerequisite-warnings'
          ? {
              body: {
                courseId: 'js-basics',
                lessons: [
                  {
                    lessonId: READING,
                    concepts: [{ id: 'js.basics.comment', title: '주석', lesson: null }],
                  },
                ],
              },
            }
          : undefined,
      ),
    );
    expect(await screen.findByText('1/2단원 완료')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: '과정 진행률' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    expect(screen.getByText('2단원 중 1단원 완료')).toBeVisible();
    // Status in words in each row's name, not color alone; the current row is marked.
    const done = screen.getByRole('link', { name: /첫 프로그램.*완료/ });
    expect(done).not.toHaveAttribute('aria-current');
    const now = screen.getByRole('link', { name: /오류 읽기.*지금 할 단원 · 읽는 중 45%/ });
    expect(now).toHaveAttribute('aria-current', 'step');
    // The `!` stays beside the row link (D-073).
    const mark = await screen.findByRole('link', { name: /^선수 개념 안내: 먼저 ‘주석’/ });
    expect(now).not.toContainElement(mark);
    await userEvent.click(screen.getByRole('link', { name: '이어서 학습: 오류 읽기' }));
    expect(router.state.location.pathname).toBe(`/learn/${READING}`);
  });

  it('offers a review once every lesson is completed', async () => {
    const completed = {
      ...detail,
      lessons: { total: 2, completed: 2 },
      state: 'completed',
      next: null,
      modules: [{ moduleId: 'js-basics.start', lessons: { total: 2, completed: 2 } }],
      lessonStatuses: detail.lessonStatuses.map((l) => ({ ...l, status: 'completed' })),
    };
    renderApp('/courses/js-basics', withProgress({ courses: [] }, completed));
    expect(await screen.findByRole('link', { name: '복습하기' })).toHaveAttribute(
      'href',
      '/review',
    );
    expect(screen.queryByRole('link', { name: '학습 시작' })).not.toBeInTheDocument();
    expect(screen.getAllByText('완료').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/지금 할 단원/)).not.toBeInTheDocument();
  });
});
