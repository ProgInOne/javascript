import { EditorView } from '@codemirror/view';
import type {
  CodeAnswer,
  FixBugPublicSpec,
  ImplementFunctionPublicSpec,
  WebTaskPublicSpec,
} from '@proginone/exercise-kit';
import type { RunResult } from '@proginone/shared';
import { act, screen, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { initialAnswer, type AnswerByType, type RenderableExercise } from '../exercise.ts';
import { PreviewFrame } from '../preview/PreviewFrame.tsx';
import { axeViolations, renderUi } from '../test/helpers.tsx';
import { FixBug, ImplementFunction, WebTask } from './CodeRenderers.tsx';
import { errorLinesByFile } from './CodeWorkspace.tsx';
import { ExerciseRenderer } from './ExerciseRenderer.tsx';

const implSpec: ImplementFunctionPublicSpec = {
  entry: 'sumEven',
  starter: { files: [{ path: 'main.js', content: 'function sumEven(nums) {\n}\n' }] },
  checks: [
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
      id: 'neg',
      kind: 'call',
      visible: false,
      required: true,
      weight: 1,
      description: '음수 짝수도 더해야 합니다.',
    },
  ],
};

const run: RunResult = {
  v: 1,
  type: 'result',
  runId: 'r',
  status: 'error',
  durationMs: 5,
  console: [{ seq: 0, level: 'log', args: [{ t: 'string', v: 'hi' }], at: 0 }],
  consoleTruncated: false,
  droppedConsoleEntries: 0,
  errors: [
    {
      phase: 'runtime',
      name: 'ReferenceError',
      message: 'totl is not defined',
      position: { file: 'main.js', line: 2 },
    },
  ],
  observations: [],
  pendingAtEnd: { timers: 0, intervals: 0 },
};

function Impl({ onRun, withRun }: { onRun?: () => void; withRun?: boolean }) {
  const [value, setValue] = useState<CodeAnswer>(
    initialAnswer({ typeId: 'implement_function', spec: implSpec }),
  );
  return (
    <>
      <h2 id="p">sumEven을 작성하세요</h2>
      <ImplementFunction
        spec={implSpec}
        value={value}
        onChange={setValue}
        labelledBy="p"
        {...(onRun === undefined ? {} : { onRun })}
        {...(withRun ? { run } : {})}
      />
      <output data-testid="value">{value.files[0]?.content}</output>
    </>
  );
}

describe('ImplementFunction', () => {
  it('shows the starter code, the tests and a run button', async () => {
    const onRun = vi.fn();
    const { user, container } = renderUi(<Impl onRun={onRun} />);
    expect(screen.getByRole('group', { name: 'sumEven을 작성하세요' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'main.js 편집기' }).textContent).toContain(
      'function sumEven(nums) {',
    );
    const tests = screen.getByRole('tabpanel');
    expect(within(tests).getByText('sumEven([1, 2, 3, 4]) → 6')).toBeTruthy();
    expect(within(tests).getByText('음수 짝수도 더해야 합니다.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /실행/ }));
    expect(onRun).toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows run output in the console tab and marks error lines', async () => {
    const { user, container } = renderUi(<Impl withRun />);
    expect(screen.getByText(/오류 줄: 2/)).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: '콘솔' }));
    expect(screen.getByText('ReferenceError: totl is not defined')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'main.js 2번째 줄로 이동' }));
    expect(container.querySelector('.cm-focused, .cm-content:focus')).toBeTruthy();
  });

  it('resets to the starter code after confirmation', async () => {
    const { user, container } = renderUi(<Impl />);
    const content = container.querySelector<HTMLElement>('.cm-content');
    expect(content).toBeTruthy();
    // Simulate an edit through the editor API (typing needs a real browser).
    const view = content ? EditorView.findFromDOM(content) : null;
    act(() => {
      view?.dispatch({ changes: { from: 0, insert: '// mine\n' } });
    });
    expect(screen.getByTestId('value').textContent).toContain('// mine');

    await user.click(screen.getByRole('button', { name: '초기화' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '초기화' }));
    expect(screen.getByTestId('value').textContent).toBe('function sumEven(nums) {\n}\n');
  });
});

describe('FixBug', () => {
  it('shows the symptom and the rewrite note above the buggy code', () => {
    const spec: FixBugPublicSpec = {
      buggy: { files: [{ path: 'main.js', content: 'function average() {}' }] },
      entry: 'average',
      checks: [],
      bugDescription: '평균이 항상 0으로 나옵니다.',
      maxEditDistance: 10,
    };
    renderUi(<FixBug spec={spec} value={{ files: spec.buggy.files }} onChange={() => undefined} />);
    expect(screen.getByText('평균이 항상 0으로 나옵니다.')).toBeTruthy();
    expect(screen.getByText('코드를 새로 쓰지 말고 버그가 있는 부분만 고쳐 보세요.')).toBeTruthy();
  });
});

describe('WebTask and PreviewFrame', () => {
  const spec: WebTaskPublicSpec = {
    focus: 'dom',
    viewports: [1280],
    starter: { files: [{ path: 'index.html', content: '<button>추가</button>' }] },
    checks: [
      {
        id: 'a',
        kind: 'dom',
        visible: false,
        required: true,
        weight: 1,
        description: '입력창이 있어요',
      },
      {
        id: 'b',
        kind: 'event',
        visible: false,
        required: true,
        weight: 1,
        description: '항목이 추가돼요',
      },
    ],
    milestones: [
      { id: 'm1', title: '입력창 만들기', checks: ['a'] },
      { id: 'm2', title: '항목 추가', checks: ['b'] },
    ],
  };

  it('puts the preview next to the editor and opens the console first for DOM tasks', async () => {
    const onRefresh = vi.fn();
    const { user, container } = renderUi(
      <WebTask
        spec={spec}
        value={{ files: spec.starter.files }}
        onChange={() => undefined}
        preview={{ status: 'idle', onRefresh }}
      />,
    );
    const preview = screen.getByRole('region', { name: '미리보기' });
    expect(within(preview).getByText('실행하면 결과 화면이 여기에 나와요.')).toBeTruthy();
    await user.click(within(preview).getByRole('button', { name: '새로 고침' }));
    expect(onRefresh).toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: '콘솔' }).getAttribute('aria-selected')).toBe('true');

    await user.click(screen.getByRole('tab', { name: '요구사항' }));
    expect(screen.getByText('1단계 · 입력창 만들기')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('gives the runner a mount point and never renders an iframe itself', () => {
    const mount = createRef<HTMLDivElement>();
    const { container } = renderUi(<PreviewFrame mountRef={mount} status="loading" />);
    expect(mount.current).toBeInstanceOf(HTMLDivElement);
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('region', { name: '미리보기' }).getAttribute('aria-busy')).toBe('true');
  });

  it('shows the error state', () => {
    renderUi(<PreviewFrame status="error" errorMessage="실행 환경 오류 — 다시 실행해 주세요" />);
    expect(screen.getByRole('alert').textContent).toBe('실행 환경 오류 — 다시 실행해 주세요');
  });
});

describe('ExerciseRenderer', () => {
  it('dispatches on the exercise type', () => {
    const exercises: RenderableExercise[] = [
      {
        typeId: 'mcq_single',
        spec: {
          options: [
            { id: 'a', text: '1' },
            { id: 'b', text: '2' },
            { id: 'c', text: '3' },
          ],
          codeOptions: false,
        },
      },
      { typeId: 'implement_function', spec: implSpec },
    ];
    for (const exercise of exercises) {
      const value: AnswerByType[RenderableExercise['typeId']] = initialAnswer(exercise);
      const { unmount } = renderUi(
        <ExerciseRenderer exercise={exercise} value={value} onChange={() => undefined} />,
      );
      if (exercise.typeId === 'mcq_single') expect(screen.getAllByRole('radio')).toHaveLength(3);
      else expect(screen.getByRole('textbox', { name: 'main.js 편집기' })).toBeTruthy();
      unmount();
    }
  });

  it('collects error lines per file', () => {
    expect(errorLinesByFile(run)).toEqual({ 'main.js': [2] });
    expect(errorLinesByFile(null)).toEqual({});
  });
});
