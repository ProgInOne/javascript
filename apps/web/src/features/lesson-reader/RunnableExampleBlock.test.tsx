import type { RunResult } from '@proginone/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as RunnerModule from '../runner/runner.ts';

const run = vi.fn<() => Promise<RunResult>>();
vi.mock('../runner/runner.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof RunnerModule>();
  return { ...actual, consoleRunner: () => ({ run }) };
});

const { RunnableExampleBlock } = await import('./RunnableExampleBlock.tsx');

const result = (over: Partial<RunResult> = {}): RunResult => ({
  v: 1,
  type: 'result',
  runId: 'r1',
  status: 'completed',
  durationMs: 5,
  console: [{ seq: 0, level: 'log', args: [{ t: 'string', v: '안녕하세요' }], at: 1 }],
  consoleTruncated: false,
  droppedConsoleEntries: 0,
  errors: [],
  observations: [],
  pendingAtEnd: { timers: 0, intervals: 0 },
  ...over,
});

afterEach(() => {
  run.mockReset();
});

describe('RunnableExampleBlock', () => {
  it('asks for a prediction before running, then shows it next to the output', async () => {
    run.mockResolvedValue(result());
    render(
      <RunnableExampleBlock id="hello" lang="js" code={'console.log("안녕하세요");'} predict />,
    );
    const runButton = screen.getByRole('button', { name: '실행' });
    expect(runButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText('예상한 출력'), '안녕');
    await userEvent.click(runButton);

    expect(await screen.findByRole('list', { name: '콘솔 출력' })).toHaveTextContent('안녕하세요');
    expect(screen.getByText('내 예측:')).toHaveTextContent('안녕');
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'js-console', purpose: 'interactive' }),
    );
  });

  it('lets the learner skip the prediction', async () => {
    run.mockResolvedValue(result());
    render(<RunnableExampleBlock id="hello" lang="js" code="1" predict />);
    await userEvent.click(screen.getByRole('button', { name: '예측 건너뛰기' }));
    expect(screen.getByRole('button', { name: '실행' })).toBeEnabled();
  });

  it('shows errors with their line and timeouts in plain words', async () => {
    run.mockResolvedValue(
      result({
        status: 'timeout',
        console: [],
        errors: [
          {
            phase: 'runtime',
            name: 'ReferenceError',
            message: 'x is not defined',
            position: { file: 'main.js', line: 2 },
          },
        ],
      }),
    );
    render(<RunnableExampleBlock id="e" lang="js" code="x" predict={false} />);
    await userEvent.click(screen.getByRole('button', { name: '실행' }));
    expect(
      await screen.findByText('ReferenceError: x is not defined (2번째 줄)'),
    ).toBeInTheDocument();
    expect(screen.getByText(/시간 안에 끝나지 않았어요/)).toBeInTheDocument();
  });

  it('shows CSS-only snippets without a run button', () => {
    render(<RunnableExampleBlock id="c" lang="css" code="p { color: red; }" predict={false} />);
    expect(screen.queryByRole('button', { name: '실행' })).not.toBeInTheDocument();
  });
});
