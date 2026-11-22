import { SETTINGS_DEFAULTS, type RunPlan, type Settings } from '@proginone/shared';
import type * as RunnerModule from '../runner/runner.ts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render-app.tsx';
import { FIX, fixView, HINTS, lesson, LESSON_ID, runResult } from '../../test/practice-fixtures.ts';

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
  localStorage.clear();
});
beforeEach(() => {
  runs.length = 0;
});

/** The fixture lesson with a "직접 써 보기" task after its intro (D-091). */
const withTry = {
  ...lesson,
  body: [...lesson.body, { type: 'component', name: 'TryIt', props: { ref: FIX } }],
};

const plan = (purpose: string) => ({
  v: 1,
  mode: 'js-console',
  purpose,
  files: [{ path: 'main.js', language: 'js', content: 'x' }],
  entry: 'main.js',
  timers: 'real',
  checks: { v: 1, expose: [], steps: [] },
});

function tryApi(settings: Partial<Settings> = {}, outcomes: boolean[] = [false, true]) {
  let hints = 0;
  return (method: string, path: string, body: unknown) => {
    if (path === '/settings') return { body: { ...SETTINGS_DEFAULTS, ...settings } };
    if (path === `/lessons/${encodeURIComponent(LESSON_ID)}`) return { body: withTry };
    if (path.startsWith(`/lessons/${encodeURIComponent(LESSON_ID)}/`)) return { body: {} };
    if (
      path.startsWith(`/exercises/${encodeURIComponent(FIX)}?`) ||
      path === `/exercises/${encodeURIComponent(FIX)}`
    )
      return { body: fixView };
    if (path.includes('/code-drafts/')) return { body: { draft: null } };
    if (path.endsWith('/run-plan')) return { body: plan((body as { purpose: string }).purpose) };
    if (path.endsWith('/hints')) {
      hints++;
      return {
        body: { level: hints, text: HINTS[hints - 1], hintCount: 3, remaining: 3 - hints },
      };
    }
    if (method === 'POST' && path.endsWith('/try-attempts')) {
      const correct = outcomes.shift() ?? true;
      return {
        body: {
          attempt: { outcome: correct ? 'correct' : 'incorrect', score: correct ? 1 : 0, correct },
          grade: {
            feedback: [],
            checkResults: [
              {
                id: 'out',
                kind: 'console',
                passed: correct,
                required: true,
                weight: 1,
                visible: true,
                description: '출력이 7000이어야 해요.',
              },
            ],
            misconceptions: [],
            explanation: '곱셈식을 따옴표 밖에 써야 해요.',
          },
        },
      };
    }
    return {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: '없음', retryable: false } },
    };
  };
}

describe('직접 써 보기 (TryIt, D-091)', () => {
  it('runs the code and checks it as often as needed without a practice set', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(`/learn/${LESSON_ID}`, tryApi());
    const block = (await screen.findByText('직접 써 보기')).closest('section');
    if (!block) throw new Error('no TryIt block');
    const box = within(block);

    await user.click(await box.findByRole('button', { name: '확인' }));
    await waitFor(() => {
      expect(calls.filter((c) => c.path.endsWith('/try-attempts'))).toHaveLength(1);
    });
    const planCalls = calls.filter((c) => c.path.endsWith('/run-plan'));
    expect(planCalls.map((c) => (c.body as { purpose: string }).purpose)).toEqual(['grading']);
    expect(runs.map((r) => r.purpose)).toEqual(['grading']);
    expect(await box.findByText('해설 보기')).toBeInTheDocument();

    // Checked again: right this time. Nothing touches practice sets or attempts.
    await user.click(box.getByRole('button', { name: '확인' }));
    expect(await box.findByText(/잘했어요/)).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/attempts' || c.path === '/practice-sets')).toBe(false);
  });

  it("keeps the hints closed until the first check under 'after-attempt'", async () => {
    const user = userEvent.setup();
    renderApp(`/learn/${LESSON_ID}`, tryApi({ 'hints.policy': 'after-attempt' }));
    const block = (await screen.findByText('직접 써 보기')).closest('section');
    if (!block) throw new Error('no TryIt block');
    const box = within(block);
    expect(await box.findByText('한 번 확인해 본 뒤에 열려요')).toBeInTheDocument();
    await user.click(box.getByRole('button', { name: '확인' }));
    await waitFor(() => {
      expect(box.queryByText('한 번 확인해 본 뒤에 열려요')).not.toBeInTheDocument();
    });
  });
});
