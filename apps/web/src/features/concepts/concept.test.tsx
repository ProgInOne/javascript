import type { ConceptDetail } from '@proginone/shared';
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
import { renderApp } from '../../test/render-app.tsx';
import { evidenceText, misconceptionStatusText, scoreDelta, shortfallText } from './explain.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const evidence = (
  id: string,
  over: Partial<ConceptDetail['evidence'][number]> = {},
): ConceptDetail['evidence'][number] => ({
  id,
  createdAt: Date.UTC(2026, 10, 13, 3),
  kind: 'attempt',
  attemptId: `a-${id}`,
  scoreBefore: 40,
  scoreAfter: 48,
  stageBefore: 'introduced',
  stageAfter: 'practicing',
  exercise: { id: 'ex', type: 'predict_output', difficulty: 2 },
  observation: { outcome: 'correct', o: 1 },
  weight: 0.8,
  factors: {
    try: { value: 1, why: 'attempt 1' },
    hint: { value: 1, why: 'no hint' },
    confidence: { value: 1, why: 'sure' },
  },
  reason: null,
  ...over,
});

const detail: ConceptDetail = {
  concept: {
    id: 'js.basics.const',
    title: 'const 선언',
    summary: '다시 대입할 수 없는 변수를 선언합니다.',
    importance: 'core',
    course: { id: 'js-basics', title: 'JavaScript 기초' },
    mdnUrl: 'https://developer.mozilla.org/ko/docs/Web/JavaScript/Reference/Statements/const',
  },
  mastery: {
    stage: 'practicing',
    score: 58,
    effective: 54,
    decay: 0.93,
    retrievability: 0.78,
    needsReview: true,
    evidenceWeightSum: 2.4,
    consecutiveFailures: 0,
    lastAttemptAt: 1,
    stageChangedAt: 1,
  },
  nextStage: {
    stage: 'proficient',
    met: false,
    missing: [
      { gate: 'distinct_types', required: 3, actual: 2 },
      { gate: 'level3_correct', required: 1, actual: 0 },
    ],
  },
  memory: {
    dueAt: 1,
    dueDate: TODAY,
    dueToday: true,
    lastReviewAt: 1,
    state: 'review',
    reps: 3,
    lapses: 1,
    suspended: false,
  },
  evidence: [
    evidence('1'),
    evidence('2', {
      scoreBefore: 48,
      scoreAfter: 45,
      observation: { outcome: 'incorrect', o: 0 },
      exercise: { id: 'ex2', type: 'find_bug_line', difficulty: 3 },
      factors: {
        try: { value: 0.6, why: 'attempt 2' },
        hint: { value: 0.7, why: 'hint 1' },
        confidence: { value: 1, why: 'guess' },
      },
    }),
    evidence('3', {
      kind: 'stage_gate',
      attemptId: null,
      exercise: null,
      observation: null,
      factors: null,
      weight: null,
      reason: 'promoted',
      scoreBefore: 48,
      scoreAfter: 48,
    }),
  ],
  evidenceTotal: 12,
  reviews: [{ reviewedAt: Date.UTC(2026, 10, 14, 3), rating: 'good' }],
  prerequisites: [
    {
      concept: { id: 'js.basics.let', title: 'let 선언' },
      strength: 'required',
      stage: 'proficient',
      effective: 80,
    },
  ],
  misconceptions: [
    {
      id: 'js.mc.const',
      title: 'const도 다시 대입할 수 있다',
      status: 'confirmed',
      source: 'distractor',
      firstSeenAt: 1,
      lastSeenAt: 1,
      confirmCount: 1,
      resolution: { done: 1, required: 2 },
    },
  ],
  lessons: [
    { id: 'js-basics.values.variables', title: '변수 선언', role: 'introduces' },
    { id: 'js-basics.values.scope', title: '스코프', role: 'reviews' },
  ],
};

const letDetail: ConceptDetail = {
  ...detail,
  concept: { ...detail.concept, id: 'js.basics.let', title: 'let 선언' },
  prerequisites: [],
  misconceptions: [],
  evidence: [],
  evidenceTotal: 0,
  memory: null,
};

function server() {
  return (method: string, path: string) => {
    if (path === '/learner') return { body: onboarded };
    if (path === '/daily-plan') return { body: firstDayPlan() };
    if (path === '/goals') return { body: goalStatus(10) };
    if (path === '/review-queue') return { body: emptyQueue };
    if (path === '/weak-concepts') return { body: noWeakConcepts };
    if (path === '/mastery') {
      return {
        body: masteryOverview({
          start: [
            tile('js.basics.statement', '문장과 실행 순서', { stage: 'proficient', effective: 70 }),
          ],
          values: [
            tile('js.basics.let', 'let 선언', { stage: 'proficient', effective: 80 }),
            tile('js.basics.const', 'const 선언', {
              stage: 'practicing',
              effective: 54,
              reviewDue: true,
            }),
          ],
        }),
      };
    }
    if (path === '/concepts/js.basics.const') return { body: detail };
    if (path === '/concepts/js.basics.const?evidenceLimit=200') {
      return { body: { ...detail, evidence: [...detail.evidence, evidence('4')] } };
    }
    if (path === '/concepts/js.basics.let') return { body: letDetail };
    if (method === 'POST' && path === '/practice-sets') {
      return {
        status: 409,
        body: {
          error: {
            code: 'PRACTICE_NOTHING_DUE',
            message: '연습할 문제가 없어요.',
            retryable: false,
          },
        },
      };
    }
    if (path.startsWith('/concepts/')) {
      return {
        status: 404,
        body: {
          error: { code: 'NOT_FOUND', message: '개념을 찾을 수 없습니다.', retryable: false },
        },
      };
    }
    return { body: { theme: 'system' } };
  };
}

describe('개념 상세 문구', () => {
  it('explains gates, evidence and misconception progress in the learner’s words', () => {
    expect(shortfallText({ gate: 'distinct_types', required: 3, actual: 2 })).toBe(
      '다른 유형 1개 더',
    );
    expect(shortfallText({ gate: 'effective', required: 70, actual: 54.4 })).toBe(
      '숙련도 70점 이상(지금 54점)',
    );
    expect(evidenceText(evidence('1'))).toEqual({
      title: 'L2 실행 결과 예측',
      details: '정답 · 첫 시도 · 힌트 없음 · 확실',
      outcome: 'correct',
    });
    expect(scoreDelta(evidence('1'))).toBe('+8');
    expect(scoreDelta(evidence('x', { scoreBefore: 48, scoreAfter: 45 }))).toBe('−3');
    expect(
      misconceptionStatusText({ status: 'confirmed', resolution: { done: 1, required: 2 } }),
    ).toBe('확정 · 해소 중(1/2)');
    expect(
      misconceptionStatusText({ status: 'resolved', resolution: { done: 2, required: 2 } }),
    ).toBe('해소');
  });
});

describe('개념 상세', () => {
  it('opens from a concept map tile as a sheet with the evidence behind the score', async () => {
    const user = userEvent.setup();
    renderApp('/', server());
    const map = await screen.findByRole('region', { name: /개념 지도/ });
    const tileButton = await within(map).findByRole('button', { name: /const 선언/ });
    await user.click(tileButton);

    const sheet = await screen.findByRole('dialog', { name: '개념: const 선언' });
    expect(tileButton).toHaveAttribute('aria-expanded', 'true');
    expect(await within(sheet).findByText('연습 중')).toBeInTheDocument();
    expect(within(sheet).getByText('· 숙련도 54')).toBeInTheDocument();
    expect(within(sheet).getByText('오늘 복습 예정')).toBeInTheDocument();
    expect(within(sheet).getByRole('heading', { name: '숙련까지' })).toBeInTheDocument();
    expect(within(sheet).getByText('다른 유형 1개 더')).toBeInTheDocument();
    expect(within(sheet).getByText('L3 이상 정답 1개')).toBeInTheDocument();
    expect(within(sheet).getByText('오늘 복습할 차례예요')).toBeInTheDocument();

    expect(within(sheet).getByText('정답 · 첫 시도 · 힌트 없음 · 확실')).toBeInTheDocument();
    expect(
      within(sheet).getByText('오답 · 2번째 시도 · 힌트 1단계 · 찍었어요'),
    ).toBeInTheDocument();
    expect(within(sheet).getByText('단계가 올랐어요')).toBeInTheDocument();
    expect(within(sheet).getByText('최근 복습: 11/14 알맞음')).toBeInTheDocument();
    expect(within(sheet).getByText('(확정 · 해소 중(1/2))')).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: '변수 선언' })).toHaveAttribute(
      'href',
      '/learn/js-basics.values.variables',
    );
    expect(within(sheet).getByRole('link', { name: /전체 화면으로 보기/ })).toHaveAttribute(
      'href',
      '/concepts/js.basics.const',
    );

    // All evidence on request.
    await user.click(within(sheet).getByRole('button', { name: '전체 보기 (12개)' }));
    await waitFor(() => {
      expect(within(sheet).getAllByText('정답 · 첫 시도 · 힌트 없음 · 확실')).toHaveLength(2);
    });

    // A prerequisite opens in the same sheet.
    await user.click(within(sheet).getByRole('button', { name: /let 선언/ }));
    const letSheet = await screen.findByRole('dialog', { name: '개념: let 선언' });
    expect(await within(letSheet).findByText(/아직 근거가 없어요/)).toBeInTheDocument();
    expect(
      within(letSheet).getByText('첫 복습일은 이 개념의 연습을 마치면 정해져요.'),
    ).toBeInTheDocument();

    // Esc closes and returns focus to the tile.
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(tileButton).toHaveFocus();
    });
  });

  it('shows the full page for a direct URL', async () => {
    renderApp('/concepts/js.basics.const', server());
    expect(
      await screen.findByRole('heading', { level: 1, name: 'const 선언' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: '숙련도가 이렇게 계산됐어요' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /let 선언/ })).toHaveAttribute(
      'href',
      '/concepts/js.basics.let',
    );
    expect(screen.getByRole('link', { name: /MDN 문서/ })).toHaveAttribute('target', '_blank');
  });

  it('starts a practice set for this concept only and shows why it could not', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp('/concepts/js.basics.const', server());
    await user.click(await screen.findByRole('button', { name: '이 개념만 연습' }));
    expect(await screen.findByText('연습할 문제가 없어요.')).toBeInTheDocument();
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/practice-sets',
      body: { kind: 'weakness', conceptIds: ['js.basics.const'] },
    });
  });

  it('shows not found for an unknown concept', async () => {
    renderApp('/concepts/nope', server());
    expect(
      await screen.findByRole('heading', { level: 1, name: '개념을 찾을 수 없어요' }),
    ).toBeInTheDocument();
  });
});
