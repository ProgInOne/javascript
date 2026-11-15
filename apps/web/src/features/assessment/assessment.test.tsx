import type {
  AssessmentAttemptResponse,
  AssessmentResult,
  LessonDetail,
  PracticeSetView,
} from '@proginone/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render-app.tsx';
import { item, lesson, mcqView, practiceSet, SET_ID } from '../../test/practice-fixtures.ts';

// Unit assessment screens (learning-engine.md#단원-평가-세트): rules, locks, one submission per
// item, results only on the end screen, weakness set for missed concepts.

const REVIEW_ID = 'js-basics.start.start-review';
const Q1 = `${REVIEW_ID}.mcq-a`;
const Q2 = `${REVIEW_ID}.mcq-b`;

const review: LessonDetail = {
  ...lesson,
  id: REVIEW_ID,
  title: '시작하기 단원 평가',
  kind: 'assessment',
  next: null,
  assessment: { itemCount: 2, passRatio: 0.8, conceptCount: 1, estimatedMinutes: 10 },
};

const concept = { id: 'js.basics.console-log', title: 'console.log로 출력하기' };

function assessmentSet(over: Partial<PracticeSetView> = {}): PracticeSetView {
  const items = [
    item(0, Q1, 'mcq_single', { reason: 'assessment' }),
    item(1, Q2, 'mcq_single', { reason: 'assessment' }),
  ];
  return practiceSet({ kind: 'assessment', lessonId: REVIEW_ID, passRule: null, items, ...over });
}

const result: AssessmentResult = {
  correct: 1,
  total: 2,
  ratio: 0.5,
  passRatio: 0.8,
  passed: false,
  items: [Q1, Q2].map((exerciseId, i) => ({
    itemId: `01JD3Z8Q6V2K9M4T7R1X5W0AT${i}`,
    position: i,
    exerciseId,
    type: 'mcq_single',
    difficulty: 2,
    prompt: `문제 본문 ${i + 1}`,
    concept,
    status: 'answered' as const,
    outcome: i === 0 ? ('correct' as const) : ('incorrect' as const),
    correct: i === 0,
    misconceptions: i === 0 ? [] : [{ id: 'js.mc.x', title: '출력을 반환으로 착각함' }],
    explanation: `해설 ${i + 1}: 콘솔에 보여 줘요.`,
    solution: { kind: 'choice' as const, choiceId: 'a', text: '콘솔에 글자를 보여 준다' },
  })),
  concepts: [{ concept, total: 2, correct: 1 }],
  missedConcepts: [concept],
  weaknessConceptIds: [concept.id],
};

function assessmentApi() {
  let set = assessmentSet();
  const handler = (method: string, path: string, body: unknown) => {
    if (path === '/settings') return { body: { theme: 'system' } };
    if (path === `/lessons/${encodeURIComponent(REVIEW_ID)}`) return { body: review };
    if (method === 'POST' && path === '/practice-sets') {
      const req = body as { kind: string };
      if (req.kind === 'weakness') {
        return { body: practiceSet({ id: '01JD3Z8Q6V2K9M4T7R1X5W0WKS', kind: 'weakness' }) };
      }
      return { body: set };
    }
    if (path === `/practice-sets/${SET_ID}`) return { body: set };
    if (path.startsWith('/practice-sets/01JD3Z8Q6V2K9M4T7R1X5W0WKS')) {
      return { body: practiceSet({ id: '01JD3Z8Q6V2K9M4T7R1X5W0WKS', kind: 'weakness' }) };
    }
    if (path.startsWith('/exercises/')) {
      const id = decodeURIComponent(path.slice('/exercises/'.length).split('?')[0] ?? '');
      return { body: { ...mcqView, id, openedHints: [] } };
    }
    if (method === 'POST' && path === '/attempts') {
      const req = body as { practiceSetItemId: string };
      const items = set.items.map((i) =>
        i.id === req.practiceSetItemId ? { ...i, status: 'answered' as const, attempts: 1 } : i,
      );
      const done = items.every((i) => i.status !== 'pending');
      set = {
        ...set,
        items: done
          ? items.map((i, n) => ({ ...i, lastOutcome: n === 0 ? 'correct' : 'incorrect' }))
          : items,
        status: done ? 'completed' : 'active',
        nextItemId: items.find((i) => i.status === 'pending')?.id ?? null,
        progress: {
          total: 2,
          answered: items.filter((i) => i.status === 'answered').length,
          skipped: 0,
          pending: items.filter((i) => i.status === 'pending').length,
        },
        result: done
          ? { total: 2, answered: 2, skipped: 0, correct: 1, pass: null, assessment: result }
          : null,
      };
      const res: AssessmentAttemptResponse = {
        withheld: true,
        attempt: {
          id: '01JD3Z8Q6V2K9M4T7R1X5W0ATT',
          engineApplied: true,
          attemptNo: 1,
          attemptInItem: 1,
        },
        item: { id: req.practiceSetItemId, status: 'answered', attempts: 1 },
        set: {
          id: SET_ID,
          status: set.status,
          progress: set.progress,
          nextItemId: set.nextItemId,
          result: set.result,
        },
      };
      return { status: 201, body: res };
    }
    return {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: '없음', retryable: false } },
    };
  };
  return handler;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('unit assessment', () => {
  it('announces the rules, locks help, withholds results and reveals them at the end', async () => {
    const user = userEvent.setup();
    const { router, calls } = renderApp(`/learn/${REVIEW_ID}?mode=practice`, assessmentApi());

    // Start screen.
    expect(
      await screen.findByRole('heading', { level: 1, name: /시작하기 단원 평가/ }),
    ).toBeVisible();
    expect(screen.getByText('2문항')).toBeVisible();
    expect(screen.getByText('정답 80% 이상')).toBeVisible();
    const rules = screen.getByRole('list', { name: '평가 규칙' });
    expect(within(rules).getByText(/힌트, AI 튜터, 정답 보기를 쓸 수 없어요/)).toBeVisible();
    expect(within(rules).getByText(/정답과 해설은 평가가 끝나면/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: '평가 시작' }));
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/practice-sets',
      body: { kind: 'assessment', lessonId: REVIEW_ID },
    });
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ mode: 'practice', set: SET_ID, i: 1 });
    });

    // In progress: hints and the tutor are locked, the concept is not named.
    const hint = await screen.findByRole('button', { name: /힌트 1\/3 보기/ });
    expect(hint).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getAllByText('평가가 끝나면 열려요').length).toBeGreaterThan(0);
    await user.click(hint);
    expect(calls.some((c) => c.path.endsWith('/hints'))).toBe(false);
    const tutor = screen.getByRole('button', { name: /튜터/ });
    expect(tutor).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText(/개념: /)).toBeNull();
    expect(screen.getByRole('navigation', { name: '평가 진행' })).toBeVisible();

    // Submit once: no outcome, no explanation.
    await user.click(screen.getByRole('radio', { name: /값을 저장한다/ }));
    await user.click(screen.getByRole('button', { name: '확실해요' }));
    expect(await screen.findByText(/제출했어요\. 정답과 해설은 평가가 끝나면/)).toBeVisible();
    expect(screen.queryByText(/정답이에요|정답이 아니에요/)).toBeNull();
    expect(screen.queryByText(/해설 1/)).toBeNull();
    expect(screen.queryByRole('button', { name: '다시 풀기' })).toBeNull();
    expect(screen.getByRole('button', { name: '문제 1: 제출함' })).toBeVisible();

    // Revisiting the submitted item offers nothing to resubmit.
    await user.click(screen.getByRole('button', { name: '다음 문제' }));
    await user.click(await screen.findByRole('button', { name: '이전 문제' }));
    expect(await screen.findByText(/이미 제출한 문항이에요/)).toBeVisible();
    expect(screen.queryByRole('button', { name: '확실해요' })).toBeNull();

    // Last item: the end screen with every answer and explanation.
    await user.click(screen.getByRole('button', { name: '문제 2: 아직 풀지 않음' }));
    await user.click(await screen.findByRole('radio', { name: /글자를 보여 준다/ }));
    await user.click(screen.getByRole('button', { name: '확실해요' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: '단원 평가를 마쳤어요' }),
    ).toBeVisible();
    expect(screen.getByText('2문항 중 1문항 정답')).toBeVisible();
    expect(screen.getByText('통과 기준 미달')).toBeVisible();
    expect(screen.getByText('해설 2: 콘솔에 보여 줘요.')).toBeVisible();
    expect(screen.getByText('출력을 반환으로 착각함', { exact: false })).toBeVisible();
    expect(screen.getByRole('button', { name: /튜터/ })).not.toHaveAttribute('aria-disabled');

    // Missed concepts → weakness set.
    await user.click(screen.getByRole('button', { name: '약점 집중 시작' }));
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/practice-sets',
      body: { kind: 'weakness', conceptIds: [concept.id] },
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/review/session/01JD3Z8Q6V2K9M4T7R1X5W0WKS');
    });
  });

  it('shows the assessment entry in reading mode', async () => {
    renderApp(`/learn/${REVIEW_ID}`, assessmentApi());
    expect(await screen.findByRole('link', { name: '평가' })).toBeVisible();
  });
});
