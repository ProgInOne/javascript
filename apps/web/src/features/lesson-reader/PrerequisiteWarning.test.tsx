import type { LessonPrerequisites } from '@proginone/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test/render-app.tsx';
import { lesson, LESSON_ID } from '../../test/practice-fixtures.ts';

// FR-CUR-05 (non-blocking warning when a lesson opens) and FR-CUR-02 (prerequisite mastery).

const withPrerequisites = {
  ...lesson,
  sections: [{ id: 'prerequisites', kind: 'prerequisites', title: null }, ...lesson.sections],
  body: [
    { type: 'component', name: 'Section', props: { kind: 'prerequisites', id: 'prerequisites' } },
    ...lesson.body,
  ],
};

const prerequisites: LessonPrerequisites = {
  lessonId: LESSON_ID,
  prerequisites: [
    {
      concept: { id: 'js.types.number', title: '숫자', summary: '숫자 값' },
      strength: 'required',
      stage: 'introduced',
      effective: 32.4,
      weak: true,
      practiced: true,
      lesson: { id: 'js-basics.values.numbers', title: '숫자와 연산' },
    },
    {
      concept: { id: 'js.types.string', title: '문자열', summary: '글자 값' },
      strength: 'required',
      stage: 'not_started',
      effective: 0,
      weak: true,
      practiced: false,
      lesson: { id: 'js-basics.values.strings', title: '문자열' },
    },
    {
      concept: { id: 'js.basics.statement', title: '문장', summary: '실행 단위' },
      strength: 'reviewed',
      stage: 'proficient',
      effective: 81,
      weak: false,
      practiced: true,
      lesson: null,
    },
  ],
  warnings: ['js.types.number', 'js.types.string'],
};

const notFound = {
  status: 404,
  body: { error: { code: 'NOT_FOUND', message: '없음', retryable: false } },
};

function api(data: LessonPrerequisites | null) {
  return (method: string, path: string) => {
    if (path === '/settings') return { body: { theme: 'system' } };
    if (path === `/lessons/${encodeURIComponent(LESSON_ID)}`) return { body: withPrerequisites };
    if (path === `/lessons/${encodeURIComponent(LESSON_ID)}/prerequisites`) {
      return data
        ? { body: data }
        : { status: 500, body: { error: { code: 'INTERNAL', message: '오류', retryable: true } } };
    }
    if (method === 'POST' && path === '/practice-sets') {
      return {
        status: 409,
        body: {
          error: {
            code: 'PRACTICE_NOTHING_WEAK',
            message: '연습할 문제가 없어요',
            retryable: false,
          },
        },
      };
    }
    return notFound;
  };
}

describe('lesson prerequisites', () => {
  it('warns about weak required prerequisites with links back, without blocking the lesson', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(`/learn/${LESSON_ID}`, api(prerequisites));

    const warning = await screen.findByRole('region', {
      name: '먼저 ‘숫자’, ‘문자열’부터 확인하면 더 쉬워요',
    });
    expect(warning).toHaveTextContent('그대로 읽어도 괜찮아요');
    // The lesson is still there.
    expect(screen.getByRole('heading', { level: 1, name: '첫 프로그램' })).toBeVisible();
    expect(screen.getByText('본문')).toBeVisible();

    const w = within(warning);
    expect(w.getByRole('link', { name: '숫자 개념 보기' })).toHaveAttribute(
      'href',
      '/concepts/js.types.number',
    );
    expect(w.getByRole('link', { name: '‘숫자와 연산’ 단원 보기' })).toHaveAttribute(
      'href',
      '/learn/js-basics.values.numbers',
    );
    expect(w.getByText(/입문 · 숙련도 32/)).toBeVisible();
    // Weakness practice needs records: offered for 숫자, not for the unstarted 문자열.
    expect(w.getAllByRole('button', { name: /약점 연습/ })).toHaveLength(1);
    // The reviewed concept never warns.
    expect(w.queryByText('문장')).toBeNull();

    await user.click(w.getByRole('button', { name: '숫자 약점 연습' }));
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/practice-sets',
      body: { kind: 'weakness', conceptIds: ['js.types.number'] },
    });
    expect(await w.findByRole('alert')).toHaveTextContent('연습할 문제가 없어요');
  });

  it('shows each prerequisite with the learner’s mastery in the 선수 개념 section', async () => {
    renderApp(`/learn/${LESSON_ID}`, api(prerequisites));
    const list = await screen.findByRole('list', { name: '선수 개념과 내 숙련도' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      '숫자 입문 · 숙련도 32 · 먼저 확인하면 좋아요숫자 값',
      '문자열 미학습 · 먼저 확인하면 좋아요글자 값',
      '문장 숙련 · 숙련도 81실행 단위',
    ]);
    expect(within(list).getByRole('link', { name: '문장' })).toHaveAttribute(
      'href',
      '/concepts/js.basics.statement',
    );
  });

  it('shows no warning when nothing is weak, and the lesson alone when the request fails', async () => {
    const ready = { ...prerequisites, warnings: [] };
    const first = renderApp(`/learn/${LESSON_ID}`, api(ready));
    expect(await screen.findByRole('list', { name: '선수 개념과 내 숙련도' })).toBeVisible();
    expect(screen.queryByRole('region', { name: /부터 확인하면 더 쉬워요/ })).toBeNull();
    first.unmount();

    const { calls } = renderApp(`/learn/${LESSON_ID}`, api(null));
    expect(await screen.findByRole('heading', { level: 1, name: '첫 프로그램' })).toBeVisible();
    await waitFor(() => {
      expect(calls.some((c) => c.path.endsWith('/prerequisites'))).toBe(true);
    });
    expect(screen.queryByRole('region', { name: /부터 확인하면 더 쉬워요/ })).toBeNull();
    expect(
      screen.getByText('이 단원은 따로 알아야 할 선수 개념 없이 시작할 수 있어요.'),
    ).toBeVisible();
  });
});
