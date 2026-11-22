import type { RunResult } from '@proginone/run-contract';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as RunnerModule from '../runner/runner.ts';

const run = vi.fn<() => Promise<RunResult>>();
let previewNotice: ((message: string) => void) | undefined;
let previewTitle: ((title: string) => void) | undefined;
vi.mock('../runner/runner.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof RunnerModule>();
  return {
    ...actual,
    consoleRunner: () => ({ run }),
    previewRunner: (_container: HTMLElement, callbacks: RunnerModule.PreviewCallbacks = {}) => {
      previewNotice = callbacks.onNotice;
      previewTitle = callbacks.onTitle;
      return { run, dispose: () => undefined };
    },
  };
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

  it('runs with Ctrl+Enter (⌘Enter on macOS) from inside the example once it can run', async () => {
    run.mockResolvedValue(result());
    render(<RunnableExampleBlock id="hello" lang="js" code="1" predict />);
    expect(screen.getByRole('button', { name: '실행' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Enter',
    );
    const field = screen.getByRole('textbox', { name: '예상한 출력' });
    await userEvent.click(field);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(run).not.toHaveBeenCalled();
    await userEvent.type(field, '1');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByRole('list', { name: '콘솔 출력' })).toHaveTextContent('안녕하세요');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('lets the learner skip the prediction', async () => {
    run.mockResolvedValue(result());
    render(<RunnableExampleBlock id="hello" lang="js" code="1" predict />);
    await userEvent.click(screen.getByRole('button', { name: '예측 건너뛰기' }));
    expect(screen.getByRole('button', { name: '실행' })).toBeEnabled();
  });

  it('has no skip link when predict-first is required (설정 > 학습 방식)', async () => {
    render(<RunnableExampleBlock id="req" lang="js" code="1" predict allowSkip={false} />);
    expect(screen.queryByRole('button', { name: '예측 건너뛰기' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '실행' })).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: '예상한 출력' }), '1');
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

  it('tells the learner when the HTML preview did not follow a link or submit a form', async () => {
    const { noticeMessage } = await vi.importActual<typeof RunnerModule>('../runner/runner.ts');
    run.mockResolvedValue(result({ console: [] }));
    render(
      <RunnableExampleBlock id="h" lang="html" code="<a href='x.html'>x</a>" predict={false} />,
    );
    await userEvent.click(screen.getByRole('button', { name: '실행' }));
    await screen.findByRole('status');
    act(() => {
      previewNotice?.(noticeMessage('navigation-blocked'));
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      '미리보기에서는 링크 이동과 폼 제출이 실제로 일어나지 않아요.',
    );
  });

  it('shows the preview document title in a tab bar above the HTML preview (D-082)', async () => {
    run.mockResolvedValue(result({ console: [] }));
    render(<RunnableExampleBlock id="t" lang="html" code="<title>x</title>" predict={false} />);
    const tab = screen.getByRole('group', { name: '미리보기 탭 제목' });
    expect(tab).toHaveTextContent('제목 없음');
    await userEvent.click(screen.getByRole('button', { name: '실행' }));
    act(() => {
      previewTitle?.('<b>내 첫 페이지</b>');
    });
    // Learner text is shown as text, never parsed as HTML.
    expect(tab).toHaveTextContent('<b>내 첫 페이지</b>');
    expect(tab.querySelector('b')).toBeNull();
  });

  it('shows CSS-only snippets without a run button', () => {
    render(<RunnableExampleBlock id="c" lang="css" code="p { color: red; }" predict={false} />);
    expect(screen.queryByRole('button', { name: '실행' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '코드 수정' })).not.toBeInTheDocument();
  });
});

describe('RunnableExampleBlock editing and drafts (D-063)', () => {
  const LESSON = 'js-basics.start.first-program';
  const draft = (content: string, updatedAt: number) => ({
    kind: 'example' as const,
    id: 'hello',
    files: [{ path: 'main.js', content }],
    updatedAt,
    practiceSetItemId: null,
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('opens an editor on "코드 수정" only for editable examples', async () => {
    const { rerender } = render(
      <RunnableExampleBlock id="hello" lang="js" code="1;" predict={false} />,
    );
    expect(screen.queryByRole('button', { name: '코드 수정' })).not.toBeInTheDocument();
    rerender(<RunnableExampleBlock id="hello" lang="js" code="1;" predict={false} editable />);
    await userEvent.click(screen.getByRole('button', { name: '코드 수정' }));
    expect(screen.getByRole('textbox', { name: /예제 코드 편집/ })).toHaveTextContent('1;');
    expect(screen.getByText('원래 코드')).toBeInTheDocument();
  });

  it('restores the newer draft, runs it, and deletes it with "원래 코드로"', async () => {
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit = {}) => {
        calls.push({ method: init.method ?? 'GET', url });
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    );
    localStorage.setItem(
      `proginone:draft:example:${LESSON}#hello`,
      JSON.stringify({ v: 2, ...draft('console.log("browser");', 9) }),
    );
    run.mockResolvedValue(result());
    render(
      <RunnableExampleBlock
        id="hello"
        lang="js"
        code={'console.log("원래");'}
        predict={false}
        editable
        lessonId={LESSON}
        serverDraft={draft('console.log("server");', 5)}
      />,
    );
    const editor = screen.getByRole('textbox', { name: /예제 코드 편집/ });
    expect(editor).toHaveTextContent('console.log("browser");');
    expect(screen.getByText('수정한 코드')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '실행' }));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [expect.objectContaining({ content: 'console.log("browser");' })],
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: '원래 코드로' }));
    expect(screen.queryByRole('textbox', { name: /예제 코드 편집/ })).not.toBeInTheDocument();
    expect(screen.getByText('console.log("원래");')).toBeInTheDocument();
    expect(localStorage.getItem(`proginone:draft:example:${LESSON}#hello`)).toBeNull();
    expect(calls).toContainEqual({
      method: 'DELETE',
      url: `/api/v1/lessons/${LESSON}/example-drafts/hello`,
    });
  });

  it('uses a server draft that arrives after the first render', () => {
    const props = {
      id: 'hello',
      lang: 'js',
      code: '1;',
      predict: false,
      editable: true,
      lessonId: LESSON,
    };
    const { rerender } = render(<RunnableExampleBlock {...props} serverDraft={undefined} />);
    expect(screen.queryByRole('textbox', { name: /예제 코드 편집/ })).not.toBeInTheDocument();
    rerender(<RunnableExampleBlock {...props} serverDraft={draft('2;', 1)} />);
    expect(screen.getByRole('textbox', { name: /예제 코드 편집/ })).toHaveTextContent('2;');
  });
});
