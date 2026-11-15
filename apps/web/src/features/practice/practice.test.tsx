import {
  SETTINGS_DEFAULTS,
  type PracticeSetView,
  type RunPlan,
  type Settings,
} from '@proginone/shared';
import type * as RunnerModule from '../runner/runner.ts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render-app.tsx';
import {
  attemptResponse,
  FIX,
  fixView,
  HINTS,
  lesson,
  LESSON_ID,
  MCQ,
  mcqView,
  practiceSet,
  runResult,
  SET_ID,
} from '../../test/practice-fixtures.ts';

// The sandbox needs a real browser (covered by Playwright); here the runner is a fake host.
const runs: RunPlan[] = [];
vi.mock('../runner/runner.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof RunnerModule>();
  const host = {
    run: (plan: RunPlan) => {
      runs.push(plan);
      return Promise.resolve(runResult(['7000']));
    },
    abort: () => undefined,
    ready: () => Promise.resolve(),
    dispose: () => undefined,
    stats: { shellsCreated: 1, usingFallback: false },
  };
  return { ...actual, consoleRunner: () => host, previewRunner: () => host };
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
beforeEach(() => {
  runs.length = 0;
});

const plan = (purpose: string) => ({
  v: 1,
  mode: 'js-console',
  purpose,
  files: [{ path: 'main.js', language: 'js', content: 'x' }],
  entry: 'main.js',
  timers: 'real',
  checks: { v: 1, expose: [], steps: [] },
});

/** A fake practice API with a mutable set. */
function practiceApi(initial: PracticeSetView = practiceSet(), settings: Partial<Settings> = {}) {
  let set = initial;
  let hints = 0;
  const outcomes: Record<string, ('correct' | 'incorrect')[]> = {
    [MCQ]: ['incorrect', 'correct'],
    [FIX]: ['correct'],
  };
  const handler = (method: string, path: string, body: unknown) => {
    if (path === '/settings') return { body: { ...SETTINGS_DEFAULTS, ...settings } };
    if (path === `/lessons/${encodeURIComponent(LESSON_ID)}`) return { body: lesson };
    if (method === 'POST' && path === '/practice-sets') return { body: set };
    if (path === `/practice-sets/${SET_ID}`) return { body: set };
    if (path.startsWith(`/exercises/${encodeURIComponent(MCQ)}?`)) return { body: mcqView };
    if (path.startsWith(`/exercises/${encodeURIComponent(FIX)}?`)) return { body: fixView };
    if (path.endsWith('/run-plan')) {
      return { body: plan((body as { purpose: string }).purpose) };
    }
    if (path.endsWith('/hints')) {
      hints++;
      return {
        body: { level: hints, text: HINTS[hints - 1], hintCount: 3, remaining: 3 - hints },
      };
    }
    if (method === 'POST' && path === '/attempts') {
      const req = body as { practiceSetItemId: string; exerciseId: string };
      const outcome = outcomes[req.exerciseId]?.shift() ?? 'correct';
      const prev = set.items.find((i) => i.id === req.practiceSetItemId);
      const res = attemptResponse(set, req.practiceSetItemId, outcome, {
        attempts: (prev?.attempts ?? 0) + 1,
      });
      set = {
        ...set,
        status: res.set.status,
        items: set.items.map((i) =>
          i.id === req.practiceSetItemId
            ? { ...i, status: 'answered', attempts: res.item.attempts, lastOutcome: outcome }
            : i,
        ),
        result: res.set.result,
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

describe('practice mode', () => {
  it('starts the lesson set from reading mode and grades a choice with ⌘Enter', async () => {
    const user = userEvent.setup();
    const { router, calls } = renderApp(`/learn/${LESSON_ID}`, practiceApi());
    await user.click(await screen.findByRole('link', { name: '실습' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: '첫 프로그램 연습' }),
    ).toBeVisible();
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ mode: 'practice', set: SET_ID, i: 1 });
    });
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/practice-sets',
      body: { kind: 'lesson', lessonId: LESSON_ID },
    });
    const progress = screen.getByRole('navigation', { name: '연습 진행' });
    expect(
      within(progress).getByRole('button', { name: '문제 1: 아직 풀지 않음' }),
    ).toHaveAttribute('aria-current', 'step');

    // Submitting needs an answer first.
    expect(screen.getByText('답을 먼저 골라 주세요.')).toBeVisible();
    await user.click(await screen.findByRole('radio', { name: /값을 저장한다/ }));
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(await screen.findByRole('heading', { name: '정답이 아니에요.' })).toBeVisible();
    const attempt = calls.find((c) => c.path === '/attempts');
    expect(attempt?.body).toMatchObject({
      exerciseId: MCQ,
      answer: { optionId: 'b' },
      confidence: 'sure',
    });
    expect(screen.getByText(/확신했는데 아니었네요/)).toBeVisible();
    expect(screen.getByText('출력을 반환으로 착각함')).toBeVisible();
    expect(screen.getByText('개념 변화')).toBeVisible();
    expect(within(progress).getByRole('button', { name: '문제 1: 정답 아님' })).toBeVisible();

    // Retry keeps the previous answer (WCAG 3.3.7) and asks for confidence again.
    await user.click(screen.getByRole('button', { name: '다시 풀기' }));
    expect(screen.getByRole('radio', { name: /값을 저장한다/ })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /글자를 보여 준다/ }));
    await user.click(screen.getByRole('button', { name: '애매해요' }));
    expect(await screen.findByRole('heading', { name: '정답이에요.' })).toBeVisible();
    expect(calls.filter((c) => c.path === '/attempts').at(-1)?.body).toMatchObject({
      confidence: 'unsure',
    });
    expect(within(progress).getByRole('button', { name: '문제 1: 다시 풀어 정답' })).toBeVisible();
  });

  it('opens hints one step at a time, also with ⌘.', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      `/learn/${LESSON_ID}?mode=practice&set=${SET_ID}&i=1`,
      practiceApi(),
    );
    await user.click(await screen.findByRole('button', { name: /힌트 1\/3 보기/ }));
    expect(await screen.findByText('첫 번째 힌트')).toBeVisible();
    await user.keyboard('{Control>}.{/Control}');
    expect(await screen.findByText('두 번째 힌트')).toBeVisible();
    expect(calls.filter((c) => c.path.endsWith('/hints')).map((c) => c.body)).toEqual([
      { practiceSetItemId: practiceSet().items[0]?.id },
      { practiceSetItemId: practiceSet().items[0]?.id },
    ]);
    expect(screen.getByRole('button', { name: '정답 보기' })).toBeDisabled();
  });

  it('submits with one button and no confidence when 확신도 is off (설정 > 학습 방식)', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      `/learn/${LESSON_ID}?mode=practice&set=${SET_ID}&i=1`,
      practiceApi(practiceSet(), { 'practice.askConfidence': false }),
    );
    await user.click(await screen.findByRole('radio', { name: /값을 저장한다/ }));
    expect(screen.queryByRole('button', { name: /확실해요/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^제출/ }));
    expect(await screen.findByRole('heading', { name: '정답이 아니에요.' })).toBeVisible();
    expect(calls.find((c) => c.path === '/attempts')?.body).toMatchObject({ confidence: null });
  });

  it("locks hints until the first submission under 'after-attempt' (D-047)", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      `/learn/${LESSON_ID}?mode=practice&set=${SET_ID}&i=1`,
      practiceApi(practiceSet(), { 'hints.policy': 'after-attempt' }),
    );
    const hint = await screen.findByRole('button', { name: /힌트 1\/3 보기/ });
    expect(hint).toHaveAttribute('aria-disabled', 'true');
    expect(hint).toHaveAccessibleDescription('한 번 답을 제출해 본 뒤에 열려요');
    await user.click(hint);
    await user.keyboard('{Control>}.{/Control}');
    expect(calls.some((c) => c.path.endsWith('/hints'))).toBe(false);

    await user.click(screen.getByRole('radio', { name: /값을 저장한다/ }));
    await user.click(screen.getByRole('button', { name: '확실해요' }));
    expect(await screen.findByRole('heading', { name: '정답이 아니에요.' })).toBeVisible();
    const open = screen.getByRole('button', { name: /힌트 1\/3 보기/ });
    expect(open).not.toHaveAttribute('aria-disabled');
    await user.click(open);
    expect(await screen.findByText('첫 번째 힌트')).toBeVisible();
  });

  it('marks the tutor button after a confident wrong answer until the tutor opens (선제 제안)', async () => {
    const user = userEvent.setup();
    renderApp(`/learn/${LESSON_ID}?mode=practice&set=${SET_ID}&i=1`, practiceApi());
    const tutor = await screen.findByRole('button', { name: /^튜터($|:)/ });
    expect(tutor).not.toHaveAccessibleName(/도움이 필요하면 물어보세요/);
    await user.click(await screen.findByRole('radio', { name: /값을 저장한다/ }));
    await user.click(screen.getByRole('button', { name: '확실해요' }));
    expect(await screen.findByRole('heading', { name: '정답이 아니에요.' })).toBeVisible();
    const marked = screen.getByRole('button', { name: /^튜터($|:)/ });
    expect(marked).toHaveAccessibleName(/도움이 필요하면 물어보세요/);
    expect(marked).toHaveAttribute('data-nudge', 'true');
    // The drawer never opens by itself; opening it clears the mark.
    expect(screen.queryByRole('complementary', { name: 'AI 튜터' })).not.toBeInTheDocument();
    await user.click(marked);
    expect(await screen.findByRole('complementary', { name: 'AI 튜터' })).toBeVisible();
    expect(screen.getByRole('button', { name: /^튜터($|:)/ })).not.toHaveAttribute('data-nudge');
  });

  it('does not mark the tutor button when proactive suggestions are off or the guess was unsure', async () => {
    const user = userEvent.setup();
    renderApp(
      `/learn/${LESSON_ID}?mode=practice&set=${SET_ID}&i=1`,
      practiceApi(practiceSet(), { 'tutor.proactiveSuggestions': false }),
    );
    await user.click(await screen.findByRole('radio', { name: /값을 저장한다/ }));
    await user.click(screen.getByRole('button', { name: '확실해요' }));
    expect(await screen.findByRole('heading', { name: '정답이 아니에요.' })).toBeVisible();
    expect(screen.getByRole('button', { name: /^튜터($|:)/ })).not.toHaveAttribute('data-nudge');
  });

  it('runs code in the sandbox for grading and ends with the completion summary', async () => {
    const user = userEvent.setup();
    const first = practiceSet().items[0];
    const answered = practiceSet({
      items: practiceSet().items.map((i, n) =>
        n === 0 ? { ...i, status: 'answered', attempts: 1, lastOutcome: 'correct' } : i,
      ),
      progress: { total: 2, answered: 1, skipped: 0, pending: 1 },
    });
    const { calls, router } = renderApp(
      `/learn/${LESSON_ID}?mode=practice&set=${SET_ID}&i=2`,
      practiceApi(answered),
    );
    expect(first).toBeDefined();
    expect(await screen.findByRole('heading', { name: /문제 2/ })).toBeVisible();
    expect(screen.getByText('계산식이 글자로 나와요.')).toBeVisible();

    // ⌘' runs without grading.
    await user.keyboard("{Control>}'{/Control}");
    await waitFor(() => {
      expect(runs.map((r) => r.purpose)).toEqual(['interactive']);
    });

    await user.click(screen.getByRole('button', { name: /확실해요/ }));
    expect(await screen.findByRole('heading', { name: '정답이에요.' })).toBeVisible();
    expect(runs.map((r) => r.purpose)).toEqual(['interactive', 'grading']);
    const attempt = calls.find((c) => c.path === '/attempts');
    expect(attempt?.body).toMatchObject({
      exerciseId: FIX,
      answer: { files: [{ path: 'main.js', content: 'console.log("3500 * 2");\n' }] },
      runResult: { status: 'completed' },
    });

    await user.click(screen.getByRole('button', { name: '결과 보기' }));
    expect(
      await screen.findByRole('heading', { name: /첫 프로그램 단원을 마쳤어요/ }),
    ).toBeVisible();
    expect(screen.getByText('연습 2문제 · 정답 2')).toBeVisible();
    expect(screen.getByText(/정답 비율 100%/)).toBeVisible();
    expect(router.state.location.search).toEqual({ mode: 'practice', set: SET_ID });
    expect(screen.getByRole('link', { name: /다음 단원: 오류 읽기/ })).toHaveAttribute(
      'href',
      '/learn/js-basics.start.reading-errors',
    );
  });

  it('explains when a lesson has no exercises yet', async () => {
    renderApp(`/learn/${LESSON_ID}?mode=practice`, (method, path) => {
      if (path === '/settings') return { body: { theme: 'system' } };
      if (path === `/lessons/${encodeURIComponent(LESSON_ID)}`) return { body: lesson };
      return {
        status: 409,
        body: {
          error: { code: 'PRACTICE_NO_EXERCISES', message: '없음', retryable: false },
        },
      };
    });
    expect(
      await screen.findByRole('heading', { name: '이 단원에는 아직 연습 문제가 없어요' }),
    ).toBeVisible();
  });
});
