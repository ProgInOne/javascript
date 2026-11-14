import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render-app.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
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

  it('shows a not-found page for an unknown lesson', async () => {
    renderApp('/learn/nope.nope.nope', api);
    expect(
      await screen.findByRole('heading', { level: 1, name: '단원을 찾을 수 없어요' }),
    ).toBeInTheDocument();
  });
});
