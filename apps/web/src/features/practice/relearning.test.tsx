import type { AttemptResponse, PracticeSetView, Remediation } from '@proginone/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attemptResponse,
  HINTS,
  item,
  MCQ,
  mcqView,
  practiceSet,
  SET_ID,
} from '../../test/practice-fixtures.ts';
import { renderApp } from '../../test/render-app.tsx';
import { adaptationNote, misconceptionChangeText } from './Relearning.tsx';

// 재학습 유도 in a practice set (ui-ux.md 학습 인터랙션 설계, learning-engine.md 재학습 규칙).

afterEach(() => {
  vi.unstubAllGlobals();
});

const REMEDIAL_ID = '01JD3Z8Q6V2K9M4T7R1X5W0RM1';

const remediation = (over: Partial<Remediation> = {}): Remediation => ({
  id: 'r1',
  concept: { id: 'js.basics.console-log', title: 'console.log로 출력하기' },
  trigger: 'set_consecutive_failures',
  kind: 'prerequisite_check',
  prerequisite: {
    conceptId: 'js.basics.statement',
    title: '문장과 실행 순서',
    stage: 'introduced',
    effective: 32,
  },
  check: { items: 2, minDifficulty: 1, maxDifficulty: 2, passCorrect: 2 },
  workedExampleStages: [],
  targetDifficulty: null,
  autoHintLevel: 0,
  tutorBadge: false,
  lesson: { id: 'js-basics.start.first-program', title: '첫 프로그램' },
  prerequisitesChecked: [
    {
      conceptId: 'js.basics.statement',
      title: '문장과 실행 순서',
      stage: 'introduced',
      effective: 32,
      depth: 1,
      weak: true,
    },
  ],
  itemIds: [REMEDIAL_ID],
  ...over,
});

function reviewSet(extra: PracticeSetView['items'] = []): PracticeSetView {
  return practiceSet({
    kind: 'review',
    lessonId: null,
    passRule: null,
    items: [
      item(0, MCQ, 'mcq_single', { reason: 'review_due' }),
      item(1, MCQ, 'mcq_single', { reason: 'review_due' }),
      ...extra,
    ],
  });
}

/** A fake API: the first answer is wrong with a relearning suggestion appended to the set. */
function relearningApi(suggestion: Remediation = remediation()) {
  let set = reviewSet();
  let hints = 0;
  const handler = (method: string, path: string) => {
    if (path === '/settings') return { body: { theme: 'system' } };
    if (path === `/practice-sets/${SET_ID}`) return { body: set };
    if (path.startsWith(`/exercises/${encodeURIComponent(MCQ)}?`)) return { body: mcqView };
    if (path.endsWith('/hints')) {
      hints++;
      return { body: { level: hints, text: HINTS[hints - 1], hintCount: 3, remaining: 3 - hints } };
    }
    if (method === 'POST' && path === '/attempts') {
      const first = set.items[0];
      if (!first) throw new Error('no item');
      const added = item(2, MCQ, 'mcq_single', {
        id: REMEDIAL_ID,
        reason:
          suggestion.kind === 'easier_with_hint'
            ? 'remedial_easier'
            : suggestion.kind === 'worked_example'
              ? 'remedial_worked_example'
              : 'remedial_prereq',
      });
      const res: AttemptResponse = {
        ...attemptResponse(set, first.id, 'incorrect', { completed: false }),
        remediation: suggestion,
        adaptations: [
          {
            kind: 'append',
            itemId: REMEDIAL_ID,
            position: 2,
            exerciseId: MCQ,
            reason: added.reason,
            targetConcept: suggestion.prerequisite
              ? { id: suggestion.prerequisite.conceptId, title: suggestion.prerequisite.title }
              : null,
          },
        ],
        misconceptionChanges: [
          {
            misconceptionId: 'js.mc.log-is-return',
            title: '출력을 반환으로 착각함',
            conceptId: 'js.basics.console-log',
            statusBefore: 'suspected',
            statusAfter: 'confirmed',
            transitions: ['confirmed'],
            resolution: { done: 0, required: 2 },
          },
        ],
      };
      set = reviewSet([added]);
      return { status: 201, body: res };
    }
    if (method === 'POST' && path.endsWith('/skip')) {
      const skippedId = path.split('/')[4] ?? '';
      set = {
        ...set,
        items: set.items.map((i) => (i.id === skippedId ? { ...i, status: 'skipped' } : i)),
        nextItemId: set.items.find((i) => i.id !== skippedId && i.status === 'pending')?.id ?? null,
      };
      return {
        body: {
          item: { id: skippedId, status: 'skipped', attempts: 0 },
          set: {
            id: SET_ID,
            status: 'active',
            progress: { total: 2, answered: 0, skipped: 1, pending: 1 },
            nextItemId: set.nextItemId,
            result: null,
          },
          adaptations: [],
          masteryChanges: [],
        },
      };
    }
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x', retryable: false } } };
  };
  return handler;
}

async function answerWrong(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText('값을 저장한다'));
  await user.click(screen.getByRole('button', { name: /확실해요/ }));
  await screen.findByRole('heading', { name: '정답이 아니에요.' });
}

describe('재학습 유도', () => {
  it('suggests checking a prerequisite and goes to the appended item', async () => {
    const user = userEvent.setup();
    const { router, calls } = renderApp(`/review/session/${SET_ID}?i=1`, relearningApi());
    await answerWrong(user);

    const card = await screen.findByRole('region', { name: '잠깐 쉬어가요' });
    expect(card).toHaveTextContent(
      '‘console.log로 출력하기’ 문제를 연속으로 2번 틀렸어요. 막힐 수 있는 부분이에요.',
    );
    expect(card).toHaveTextContent('먼저 ‘문장과 실행 순서’을(를) 2문제로 짧게 확인해볼까요?');
    await user.click(within(card).getByText('왜 이걸 권하나요?'));
    expect(within(card).getByText(/문장과 실행 순서 · 입문 · 숙련도 32/)).toBeInTheDocument();
    // Misconception progress under the feedback.
    expect(
      screen.getByText(
        '‘출력을 반환으로 착각함’ 오개념이 확인됐어요. 관련 문제를 두 번 맞히면 해소돼요.',
      ),
    ).toBeInTheDocument();
    // The appended item shows in the progress markers.
    const progress = screen.getByRole('navigation', { name: '연습 진행' });
    expect(
      await within(progress).findByRole('button', {
        name: '문제 3: 아직 풀지 않음 (선수 개념 확인)',
      }),
    ).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: '선수 개념 확인하기 (약 2분)' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ i: 3 });
    });
    expect(await screen.findByText('선수 개념 확인')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '잠깐 쉬어가요' })).not.toBeInTheDocument();
    expect(calls.filter((c) => c.path === `/practice-sets/${SET_ID}`).length).toBeGreaterThan(1);
  });

  it('respects "계속 풀기"', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(`/review/session/${SET_ID}?i=1`, relearningApi());
    await answerWrong(user);
    const card = await screen.findByRole('region', { name: '잠깐 쉬어가요' });
    await user.click(within(card).getByRole('button', { name: '계속 풀기' }));
    expect(screen.queryByRole('region', { name: '잠깐 쉬어가요' })).not.toBeInTheDocument();
    expect(router.state.location.search).toEqual({ i: 1 });
  });

  it('offers the lesson and the tutor badge after the worked examples', async () => {
    const user = userEvent.setup();
    renderApp(
      `/review/session/${SET_ID}?i=1`,
      relearningApi(
        remediation({
          kind: 'reread_lesson',
          trigger: 'recent_consecutive_failures',
          prerequisite: null,
          check: null,
          tutorBadge: true,
          itemIds: [],
        }),
      ),
    );
    await answerWrong(user);
    const card = await screen.findByRole('region', { name: '잠깐 쉬어가요' });
    expect(card).toHaveTextContent(
      '최근 ‘console.log로 출력하기’ 문제를 여러 번 연속으로 틀렸어요',
    );
    expect(within(card).getByRole('link', { name: '레슨 다시 읽기' })).toHaveAttribute(
      'href',
      '/learn/js-basics.start.first-program',
    );
    expect(within(card).getByText('AI 튜터')).toBeInTheDocument();
    // The tutor is never opened by itself (D-010).
    expect(screen.queryByRole('complementary', { name: 'AI 튜터' })).not.toBeInTheDocument();
  });

  it('opens hint 1 by itself on an easier relearning item', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      `/review/session/${SET_ID}?i=1`,
      relearningApi(
        remediation({
          kind: 'easier_with_hint',
          prerequisite: null,
          check: null,
          autoHintLevel: 1,
          targetDifficulty: 1,
        }),
      ),
    );
    await answerWrong(user);
    const card = await screen.findByRole('region', { name: '잠깐 쉬어가요' });
    await user.click(within(card).getByRole('button', { name: '쉬운 문제 풀기' }));
    expect(await screen.findByText('쉬운 문제 · 힌트 1단계')).toBeInTheDocument();
    expect(await screen.findByText(HINTS[0] ?? '')).toBeInTheDocument();
    expect(calls.filter((c) => c.path.endsWith('/hints'))).toHaveLength(1);
  });

  it('records a skip and moves to the next pending item', async () => {
    const user = userEvent.setup();
    const { calls, router } = renderApp(`/review/session/${SET_ID}?i=1`, relearningApi());
    await screen.findByText('값을 저장한다');
    await user.click(screen.getByRole('button', { name: '건너뛰기' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ i: 2 });
    });
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/skip'))).toBe(true);
    expect(await screen.findByRole('button', { name: '문제 1: 건너뜀' })).toBeInTheDocument();
  });
});

describe('재학습 문구', () => {
  it('describes misconception progress and set changes', () => {
    const change = {
      misconceptionId: 'm',
      title: 'X',
      conceptId: 'c',
      statusBefore: 'confirmed' as const,
      statusAfter: 'confirmed' as const,
      transitions: ['resolution_progress'],
      resolution: { done: 1, required: 2 },
    };
    expect(misconceptionChangeText(change)).toBe('‘X’ 해소 중(1/2)');
    expect(
      misconceptionChangeText({ ...change, statusAfter: 'resolved', transitions: ['resolved'] }),
    ).toBe('‘X’ 오개념을 해소했어요.');
    expect(
      misconceptionChangeText({
        ...change,
        statusBefore: null,
        statusAfter: 'suspected',
        transitions: ['observed'],
      }),
    ).toBe('‘X’ 오개념일 수 있어요(의심).');
    const append = {
      kind: 'append' as const,
      itemId: 'i',
      position: 3,
      exerciseId: 'e',
      targetConcept: null,
    };
    expect(adaptationNote([{ ...append, reason: 'solution_followup' }])).toBe(
      '정답을 봤으니 비슷한 문제로 다시 나와요.',
    );
    expect(adaptationNote([{ ...append, kind: 'replace', reason: 'difficulty_step_up' }])).toBe(
      '잘 풀고 있어서 남은 문제를 한 단계 어렵게 바꿨어요.',
    );
    expect(adaptationNote([{ ...append, reason: 'remedial_prereq' }])).toBeNull();
  });
});
