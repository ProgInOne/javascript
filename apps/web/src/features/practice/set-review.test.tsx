import {
  SETTINGS_DEFAULTS,
  type PracticeReviewItem,
  type PracticeSetReview,
} from '@proginone/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test/render-app.tsx';
import {
  FIX,
  item,
  lesson,
  LESSON_ID,
  MCQ,
  practiceSet,
  SET_ID,
} from '../../test/practice-fixtures.ts';

// "푼 문제 돌아보기" (D-098) under a finished set's summary.

const SKIPPED = `${LESSON_ID}.tf-semicolon`;
const items = [
  item(0, MCQ, 'mcq_single', { status: 'answered', attempts: 2, lastOutcome: 'correct' }),
  item(1, FIX, 'fix_bug', { status: 'answered', attempts: 1, lastOutcome: 'incorrect' }),
  item(2, SKIPPED, 'true_false', { status: 'skipped' }),
];
const done = practiceSet({
  status: 'completed',
  items,
  progress: { total: 3, answered: 2, skipped: 1, pending: 0 },
  nextItemId: null,
  result: { total: 3, answered: 2, skipped: 1, correct: 1, pass: null },
  completedAt: 2,
});

const reviewItem = (
  i: number,
  exerciseId: string,
  type: string,
  over: Partial<PracticeReviewItem>,
): PracticeReviewItem => ({
  itemId: items[i]?.id ?? '',
  position: i,
  exerciseId,
  type,
  difficulty: 2,
  prompt: `${exerciseId} 문제`,
  code: null,
  codeLanguage: null,
  concept: { id: 'js.basics.log', title: 'console.log로 출력하기' },
  status: 'answered',
  attempts: 1,
  last: null,
  explanation: null,
  solution: null,
  archived: false,
  retry: { available: true, blockedBy: null },
  ...over,
});

const review: PracticeSetReview = {
  setId: SET_ID,
  items: [
    reviewItem(0, MCQ, 'mcq_single', {
      attempts: 2,
      last: {
        outcome: 'correct',
        confidence: 'sure',
        answer: { kind: 'choice', choiceId: 'b', text: '화면에 출력한다' },
        feedback: ['맞아요.'],
        misconceptions: [],
        solutionViewed: false,
      },
      explanation: '객관식 해설',
    }),
    reviewItem(1, FIX, 'fix_bug', {
      last: {
        outcome: 'incorrect',
        confidence: 'unsure',
        answer: { kind: 'files', files: [{ path: 'main.js', content: 'let total = 1' }] },
        feedback: ['합계가 3이어야 해요.'],
        misconceptions: [{ id: 'js.mc.x', title: '대입을 비교로 생각함' }],
        solutionViewed: false,
      },
      explanation: '버그 해설',
    }),
    reviewItem(2, SKIPPED, 'true_false', { status: 'skipped', attempts: 0 }),
  ],
};

function api(reviewResponse: () => { status?: number; body: unknown }) {
  return (method: string, path: string) => {
    if (path === '/settings') return { body: SETTINGS_DEFAULTS };
    if (path === `/lessons/${encodeURIComponent(LESSON_ID)}`) return { body: lesson };
    if (path === `/practice-sets/${SET_ID}`) return { body: done };
    if (path === `/practice-sets/${SET_ID}/review`) return reviewResponse();
    return {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: '없음', retryable: false } },
    };
  };
}

const open = () =>
  renderApp(
    `/learn/${LESSON_ID}?mode=practice&set=${SET_ID}`,
    api(() => ({ body: review })),
  );

describe('SetReview (D-098)', () => {
  it('lists the solved problems with the last answer; missed ones start open', async () => {
    open();
    const list = await screen.findByRole('list', { name: '푼 문제 돌아보기' });
    // Direct children only: the feedback inside an item is a list too.
    const rows = [...list.children] as HTMLElement[];
    expect(rows).toHaveLength(3);
    const [first, second, third] = rows;
    if (!first || !second || !third) throw new Error('missing rows');

    // Correct: collapsed, with how it went.
    expect(first.querySelector('details')).not.toHaveAttribute('open');
    expect(within(first).getByText(/2번째에 정답/)).toBeInTheDocument();

    // Wrong: open with my answer, feedback, misconception, explanation and a locked answer.
    expect(second.querySelector('details')).toHaveAttribute('open');
    expect(within(second).getByText('오답')).toBeVisible();
    expect(within(second).getByText('let total = 1', { exact: false })).toBeVisible();
    expect(within(second).getByRole('list', { name: '채점 피드백' })).toHaveTextContent(
      '합계가 3이어야 해요.',
    );
    expect(within(second).getByText(/대입을 비교로 생각함/)).toBeVisible();
    expect(within(second).getByText('버그 해설')).toBeVisible();
    expect(within(second).getByText(/힌트를 끝까지 열면 정답을 볼 수 있어요/)).toBeVisible();
    expect(within(second).getByRole('button', { name: '다시 풀기' })).toBeVisible();

    // Skipped before any attempt: no answer and no explanation.
    expect(within(third).getByText('건너뜀')).toBeInTheDocument();
    expect(
      within(third).getByText('답하지 않고 건너뛴 문제예요.', { exact: false }),
    ).toBeInTheDocument();
    expect(within(third).queryByText('해설')).toBeNull();

    // The next steps stay after the list.
    expect(screen.getByRole('button', { name: '한 번 더 연습' })).toBeVisible();
  });

  it('offers to try again when the review cannot be loaded', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderApp(
      `/learn/${LESSON_ID}?mode=practice&set=${SET_ID}`,
      api(() =>
        fail
          ? {
              status: 500,
              body: { error: { code: 'INTERNAL', message: '오류', retryable: false } },
            }
          : { body: review },
      ),
    );
    expect(await screen.findByText('푼 문제를 불러오지 못했어요.')).toBeVisible();
    fail = false;
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('list', { name: '푼 문제 돌아보기' })).toBeVisible();
  });
});
