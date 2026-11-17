import type { CheckResult, GradeResult, PublicCheck } from '@proginone/exercise-kit';
import type { RunResult } from '@proginone/shared';
import { screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations, renderUi } from '../test/helpers.tsx';
import { CheckList } from './CheckList.tsx';
import { ConfidencePicker } from './ConfidencePicker.tsx';
import { ConsoleView, explainRunError, runStatusText } from './ConsoleView.tsx';
import { checkSummary } from './describe-check.ts';
import { FeedbackBanner } from './FeedbackBanner.tsx';
import { HintLadder } from './HintLadder.tsx';
import { matchExerciseShortcut, useExerciseShortcuts } from './shortcuts.ts';

describe('ConfidencePicker', () => {
  it('submits the chosen confidence', async () => {
    const onSubmit = vi.fn();
    const { user, container } = renderUi(<ConfidencePicker onSubmit={onSubmit} />);
    const group = screen.getByRole('group', { name: '답을 골랐다면, 얼마나 확신하나요?' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['확실해요CtrlEnter', '애매해요', '찍었어요']);
    expect(screen.getByRole('button', { name: /확실해요/ }).getAttribute('aria-keyshortcuts')).toBe(
      'Control+Enter',
    );
    await user.click(screen.getByRole('button', { name: '애매해요' }));
    expect(onSubmit).toHaveBeenCalledWith('unsure');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('keeps blocked buttons focusable, explains why, and ignores presses', async () => {
    const onSubmit = vi.fn();
    const { user } = renderUi(
      <ConfidencePicker onSubmit={onSubmit} disabledReason="답을 먼저 골라 주세요." />,
    );
    const sure = screen.getByRole('button', { name: /확실해요/ });
    expect(sure.getAttribute('aria-disabled')).toBe('true');
    expect(sure).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: '찍었어요' }).getAttribute('aria-describedby')).toBe(
      screen.getByText('답을 먼저 골라 주세요.').id,
    );
    await user.click(sure);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a single submit button when confidence is off', async () => {
    const onSubmit = vi.fn();
    const { user } = renderUi(<ConfidencePicker onSubmit={onSubmit} askConfidence={false} />);
    expect(screen.queryByRole('group')).toBeNull();
    await user.click(screen.getByRole('button', { name: /제출/ }));
    expect(onSubmit).toHaveBeenCalledWith(null);
  });

  it('shows a spinner on the pressed button while submitting', async () => {
    function Harness() {
      const [submitting, setSubmitting] = useState(false);
      return (
        <ConfidencePicker
          submitting={submitting}
          onSubmit={() => {
            setSubmitting(true);
          }}
        />
      );
    }
    const { user } = renderUi(<Harness />);
    await user.click(screen.getByRole('button', { name: '찍었어요' }));
    expect(screen.getByRole('button', { name: '찍었어요' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button', { name: /확실해요/ }).getAttribute('aria-busy')).toBeNull();
  });
});

describe('exercise shortcuts', () => {
  it('maps ⌘ on Apple platforms and Ctrl elsewhere', () => {
    const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
      key: k,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...mods,
    });
    expect(matchExerciseShortcut(key('Enter', { metaKey: true }), true)).toBe('onSubmit');
    expect(matchExerciseShortcut(key('Enter', { ctrlKey: true }), true)).toBeNull();
    expect(matchExerciseShortcut(key("'", { ctrlKey: true }), false)).toBe('onRun');
    expect(matchExerciseShortcut(key('.', { ctrlKey: true }), false)).toBe('onNextHint');
    expect(matchExerciseShortcut(key('.', { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(matchExerciseShortcut(key('Enter'), false)).toBeNull();
  });

  it('calls the latest handlers from anywhere on the page', async () => {
    const onSubmit = vi.fn();
    const onNextHint = vi.fn();
    function Harness() {
      useExerciseShortcuts({ onSubmit, onNextHint });
      return <input aria-label="답" />;
    }
    const { user } = renderUi(<Harness />);
    await user.click(screen.getByRole('textbox', { name: '답' }));
    await user.keyboard('{Control>}{Enter}{/Control}');
    await user.keyboard('{Control>}.{/Control}');
    await user.keyboard("{Control>}'{/Control}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onNextHint).toHaveBeenCalledTimes(1);
  });
});

describe('HintLadder', () => {
  const hints = ['방향 힌트', '`n % 2 === 0`을 보세요', '거의 답'];

  function Harness({ onRevealAnswer }: { onRevealAnswer?: () => void }) {
    const [revealed, setRevealed] = useState(0);
    const [answer, setAnswer] = useState(false);
    return (
      <HintLadder
        hints={hints}
        revealed={revealed}
        onReveal={setRevealed}
        answerRevealed={answer}
        answer={<p>정답 코드</p>}
        onRevealAnswer={() => {
          onRevealAnswer?.();
          setAnswer(true);
        }}
      />
    );
  }

  it('shows the after-hints slot only once a hint is open', () => {
    const props = { hints, onReveal: () => undefined, afterHints: <button>AI 설명</button> };
    const { rerender } = renderUi(<HintLadder {...props} revealed={0} />);
    expect(screen.queryByRole('button', { name: 'AI 설명' })).toBeNull();
    rerender(<HintLadder {...props} revealed={1} />);
    expect(screen.getByRole('button', { name: 'AI 설명' })).toBeTruthy();
  });

  it('opens hints one step at a time and keeps them stacked', async () => {
    const { user, container } = renderUi(<Harness />);
    expect(screen.getByRole('region', { name: '힌트' })).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();

    await user.click(screen.getByRole('button', { name: /힌트 1\/3 보기/ }));
    await user.click(screen.getByRole('button', { name: /힌트 2\/3 보기/ }));
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('1단계 방향');
    expect(items[1]?.querySelector('code')?.textContent).toBe('n % 2 === 0');
    expect(screen.getByText('힌트를 볼수록 이 문제의 숙련도 반영이 조금 줄어요.')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('unlocks "정답 보기" after the last hint and confirms before revealing', async () => {
    const onRevealAnswer = vi.fn();
    const { user } = renderUi(<Harness onRevealAnswer={onRevealAnswer} />);
    const reveal = screen.getByRole('button', { name: '정답 보기' });
    expect(reveal).toHaveProperty('disabled', true);
    expect(screen.getByText('힌트를 모두 본 뒤에 볼 수 있어요.')).toBeTruthy();

    for (const n of [1, 2, 3])
      await user.click(screen.getByRole('button', { name: new RegExp(`힌트 ${n}/3 보기`) }));
    expect(screen.queryByRole('button', { name: /힌트 \d\/3 보기/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: '정답 보기' }));
    const dialog = screen.getByRole('dialog', { name: '정답을 볼까요?' });
    await user.click(within(dialog).getByRole('button', { name: '조금 더 해볼게요' }));
    expect(onRevealAnswer).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '정답 보기' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '정답 보기' }));
    expect(onRevealAnswer).toHaveBeenCalledTimes(1);
    expect(screen.getByText('정답 코드')).toBeTruthy();
  });

  it('locks hints and the answer in assessments', async () => {
    const onReveal = vi.fn();
    const { user } = renderUi(
      <HintLadder hints={hints} revealed={0} onReveal={onReveal} onRevealAnswer={vi.fn()} locked />,
    );
    const next = screen.getByRole('button', { name: /힌트 1\/3 보기/ });
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(next.getAttribute('aria-describedby')).toBe(screen.getByText('평가가 끝나면 열려요').id);
    await user.click(next);
    expect(onReveal).not.toHaveBeenCalled();
  });
});

function grade(partial: Partial<GradeResult>): GradeResult {
  return {
    correct: false,
    outcome: 'incorrect',
    score: 0,
    feedback: [],
    misconceptionIds: [],
    engineApplicable: true,
    graderVersion: 'x@1',
    ...partial,
  };
}

describe('FeedbackBanner', () => {
  it('renders an empty live region before the first result', () => {
    renderUi(<FeedbackBanner result={null} />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('tailors the message to the confidence', () => {
    const { rerender } = renderUi(
      <FeedbackBanner result={grade({ outcome: 'correct', correct: true, score: 1 })} />,
    );
    expect(screen.getByRole('heading').textContent).toBe('정답이에요.');

    rerender(
      <FeedbackBanner
        result={grade({ outcome: 'correct', correct: true, score: 1 })}
        confidence="guess"
        explanation={<p>해설 본문</p>}
      />,
    );
    expect(screen.getByText('맞혔지만 찍었다고 했죠. 해설을 꼭 확인해보세요.')).toBeTruthy();
    expect(screen.getByText('해설 본문').closest('details')?.open).toBe(true);
    // The explanation sits in its own labelled box under the toggle (D-080).
    const box = screen.getByRole('group', { name: '해설' });
    expect(box.textContent).toContain('해설 본문');
    expect(box.className).toContain('pi-ex-feedback__explanation-body');
  });

  it('opens the misconception note when the learner was sure but wrong', async () => {
    const { container } = renderUi(
      <FeedbackBanner
        result={grade({
          misconceptionIds: ['js.mc.log-is-return'],
          feedback: [
            { level: 'error', code: 'MCQ_WRONG_OPTION', message: '출력과 반환을 혼동했어요.' },
          ],
        })}
        confidence="sure"
        misconceptions={[
          {
            id: 'js.mc.log-is-return',
            name: '출력과 반환값 혼동',
            description: 'console.log는 값을 돌려주지 않아요.',
            action: <a href="#lesson">관련 레슨 보기</a>,
          },
        ]}
        actions={<button type="button">다시 풀기</button>}
      />,
    );
    const status = screen.getByRole('status');
    expect(within(status).getByRole('heading').textContent).toBe('정답이 아니에요.');
    expect(
      within(status).getByText('확신했는데 아니었네요. 이런 순간이 가장 잘 기억에 남아요.'),
    ).toBeTruthy();
    expect(within(status).getByText('출력과 반환을 혼동했어요.')).toBeTruthy();
    expect(
      within(status).getByText('console.log는 값을 돌려주지 않아요.').closest('details')?.open,
    ).toBe(true);
    expect(within(status).getByRole('link', { name: '관련 레슨 보기' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('summarizes partial check results and failed requirements', () => {
    const checkResults: CheckResult[] = [
      { id: 'a', kind: 'call', passed: true, required: true, weight: 1, visible: true },
      {
        id: 'b',
        kind: 'call',
        passed: false,
        required: true,
        weight: 1,
        visible: false,
        description: '음수 짝수도 더해야 합니다.',
        reason: 'MISMATCH',
      },
    ];
    renderUi(
      <FeedbackBanner
        result={grade({
          outcome: 'partial',
          score: 0.5,
          checkResults,
          failedRequirements: ['음수 처리'],
          feedback: [{ level: 'error', code: 'CHECK_FAILED', message: 'x', target: 'b' }],
        })}
      />,
    );
    expect(screen.getByRole('heading').textContent).toBe('부분 정답이에요.');
    expect(
      screen.getByText('테스트 2개 중 1개를 통과했어요. 실패한 테스트를 확인해 보세요.'),
    ).toBeTruthy();
    expect(screen.getByText('다시 확인할 요구사항: 음수 처리')).toBeTruthy();
    expect(screen.getByText(/음수 짝수도 더해야 합니다/).textContent).toContain(
      '결과가 기대와 달라요.',
    );
    // Check-targeted items are shown by the check list, not repeated here.
    expect(screen.queryByText('x')).toBeNull();
  });
});

describe('CheckList', () => {
  const checks: PublicCheck[] = [
    {
      id: 'basic',
      kind: 'call',
      visible: true,
      required: true,
      weight: 1,
      args: [[1, 2, 3, 4]],
      expect: { equals: 6 },
    },
    {
      id: 'negatives',
      kind: 'call',
      visible: false,
      required: true,
      weight: 1,
      description: '음수 짝수도 더해야 합니다.',
    },
    { id: 'style', kind: 'static', visible: false, required: false, weight: 1 },
  ];

  it('lists visible inputs and hidden descriptions before a run', async () => {
    const { container } = renderUi(<CheckList checks={checks} entry="sumEven" />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      '실행 전: 함수 호출 테스트sumEven([1, 2, 3, 4]) → 6',
      '실행 전: 음수 짝수도 더해야 합니다.숨김',
      '실행 전: 코드 규칙숨김추가 도전',
    ]);
    expect(screen.getByRole('status').textContent).toBe('3개');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('puts failures first and shows expected/actual only for visible checks', async () => {
    const results: CheckResult[] = [
      {
        id: 'basic',
        kind: 'call',
        passed: false,
        required: true,
        weight: 1,
        visible: true,
        reason: 'MISMATCH',
        detail: { expected: '6', actual: '4' },
      },
      { id: 'negatives', kind: 'call', passed: true, required: true, weight: 1, visible: false },
      { id: 'style', kind: 'static', passed: false, required: false, weight: 1, visible: false },
    ];
    const { user } = renderUi(<CheckList checks={checks} results={results} entry="sumEven" />);
    expect(screen.getByRole('status').textContent).toBe('3개 중 1개 통과');
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-status'))).toEqual(['failed', 'failed', 'passed']);
    expect(rows[0]?.textContent).toContain('실패: ');
    expect(rows[0]?.textContent).toContain('결과가 기대와 달라요.');
    await user.click(screen.getByText('기대값과 실제값 보기'));
    const first = rows[0];
    if (!first) throw new Error('missing row');
    expect(within(first).getByText('4')).toBeTruthy();
    expect(screen.getAllByText('기대값과 실제값 보기')).toHaveLength(1);
  });

  it('summarizes console and throw expectations', () => {
    expect(
      checkSummary({
        id: 'c',
        kind: 'console',
        visible: true,
        required: true,
        weight: 1,
        expect: { lines: ['3', 'hi'] },
      }),
    ).toBe('3\nhi');
    expect(
      checkSummary(
        {
          id: 't',
          kind: 'call',
          visible: true,
          required: true,
          weight: 1,
          args: ['x'],
          expect: { throws: { name: 'TypeError' } },
        },
        'parse',
      ),
    ).toBe('parse("x") → TypeError 발생');
    const hidden = checks[1];
    if (!hidden) throw new Error('missing check');
    expect(checkSummary(hidden)).toBeNull();
  });
});

function runResult(partial: Partial<RunResult>): RunResult {
  return {
    v: 1,
    type: 'result',
    runId: 'r1',
    status: 'completed',
    durationMs: 12,
    console: [],
    consoleTruncated: false,
    droppedConsoleEntries: 0,
    errors: [],
    observations: [],
    pendingAtEnd: { timers: 0, intervals: 0 },
    ...partial,
  };
}

describe('ConsoleView', () => {
  it('shows an empty state before the first run', () => {
    renderUi(<ConsoleView result={null} />);
    expect(screen.getByText(/실행 결과가 여기에 나와요/)).toBeTruthy();
  });

  it('formats entries, status and truncation', async () => {
    const onClear = vi.fn();
    const { user, container } = renderUi(
      <ConsoleView
        onClear={onClear}
        result={runResult({
          console: [
            {
              seq: 0,
              level: 'log',
              args: [
                { t: 'string', v: 'hi' },
                { t: 'number', v: 3 },
              ],
              at: 1,
            },
            {
              seq: 1,
              level: 'warn',
              args: [{ t: 'array', items: [{ t: 'string', v: 'a' }], length: 1 }],
              at: 2,
            },
          ],
          consoleTruncated: true,
          droppedConsoleEntries: 1200,
        })}
      />,
    );
    const output = screen.getByRole('list', { name: '출력' });
    expect(
      within(output)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['hi 3', '경고: ["a"]']);
    expect(screen.getByText('완료 · 12ms')).toBeTruthy();
    expect(screen.getByText(/1,200개 생략/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('완료 · 12ms. 출력 2개');
    await user.click(screen.getByRole('button', { name: '지우기' }));
    expect(onClear).toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('explains errors and links positions to the editor', async () => {
    const onNavigate = vi.fn();
    const { user } = renderUi(
      <ConsoleView
        onNavigate={onNavigate}
        result={runResult({
          status: 'error',
          errors: [
            {
              phase: 'runtime',
              name: 'ReferenceError',
              message: 'x is not defined',
              position: { file: 'main.js', line: 3 },
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('오류로 멈췄어요 · 12ms')).toBeTruthy();
    expect(screen.getByText('ReferenceError: x is not defined')).toBeTruthy();
    expect(
      screen.getByText(
        '`x`라는 이름을 찾을 수 없어요. 선언하기 전에 썼거나 철자가 다를 수 있어요.',
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'main.js 3번째 줄로 이동' }));
    expect(onNavigate).toHaveBeenCalledWith({ file: 'main.js', line: 3 });
  });

  it('maps every run status to its message', () => {
    expect(runStatusText(runResult({ status: 'timeout' }), 3000)).toBe('중단됨 — 시간 제한 3초');
    expect(runStatusText(runResult({ status: 'crashed' }))).toBe(
      '실행 환경 오류 — 다시 실행해 주세요',
    );
    expect(runStatusText(runResult({ status: 'aborted' }))).toBe('실행을 중지했어요');
    expect(
      runStatusText(
        runResult({
          status: 'loop_limit',
          errors: [
            {
              phase: 'loop_limit',
              name: 'LoopLimit',
              message: 'x',
              position: { file: 'main.js', line: 4 },
            },
          ],
        }),
      ),
    ).toBe('반복이 너무 오래 실행되어 멈췄어요 (4번째 줄)');
  });

  it('shows the stop button while running', async () => {
    const onStop = vi.fn();
    const { user } = renderUi(<ConsoleView result={null} running onStop={onStop} />);
    expect(screen.getAllByText('실행 중').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '중지' }));
    expect(onStop).toHaveBeenCalled();
  });

  it('explains syntax and type errors in learner language', () => {
    expect(explainRunError({ phase: 'syntax', name: 'SyntaxError', message: 'x' })).toMatch(
      /문법 오류/,
    );
    expect(
      explainRunError({ phase: 'runtime', name: 'TypeError', message: 'f is not a function' }),
    ).toMatch(/함수가 아닌 값/);
    expect(explainRunError({ phase: 'runtime', name: 'Error', message: 'boom' })).toBeNull();
  });

  it('gives the same explanation for V8, SpiderMonkey and JSC wordings (D-074)', () => {
    const explain = (name: string, ...messages: string[]) =>
      messages.map((message) => explainRunError({ phase: 'runtime', name, message }));
    expect(
      explain(
        'ReferenceError',
        'nickname is not defined',
        "Can't find variable: nickname",
        'assignment to undeclared variable nickname',
      ),
    ).toEqual(Array(3).fill(expect.stringContaining('`nickname`라는 이름을 찾을 수 없어요')));
    expect(
      explain(
        'ReferenceError',
        "Cannot access 'total' before initialization",
        "can't access lexical declaration 'total' before initialization",
        'Cannot access uninitialized variable.',
      ),
    ).toEqual(Array(3).fill(expect.stringContaining('선언하기 전에')));
    expect(
      explain(
        'TypeError',
        "Cannot read properties of undefined (reading 'name')",
        'user is undefined',
        `can't access property "name", user is null`,
        "undefined is not an object (evaluating 'user.name')",
      ),
    ).toEqual(Array(4).fill(expect.stringContaining('`undefined`나 `null`에서')));
    expect(
      explain(
        'TypeError',
        'Assignment to constant variable.',
        "invalid assignment to const 'price'",
        'Attempted to assign to readonly property.',
      ),
    ).toEqual(Array(3).fill(expect.stringContaining('`const`로 선언한')));
    expect([
      ...explain('RangeError', 'Maximum call stack size exceeded'),
      ...explain('InternalError', 'too much recursion'),
    ]).toEqual(Array(2).fill(expect.stringContaining('자기 자신을 끝없이')));
  });
});
