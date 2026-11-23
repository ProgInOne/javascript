import { EditorView } from '@codemirror/view';
import type { CodeFile } from '@proginone/exercise-kit';
import { act, screen, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations, renderUi } from '../test/helpers.tsx';
import { FormatError, type CodeEditorHandle } from '@proginone/exercise-ui';
import { formatCode, languageOfPath } from './format.ts';
import { CodeEditor, EditorPane } from './languages.tsx';

// CodeMirror's layout code needs DOM geometry jsdom lacks; heavier editing behaviour is covered in
// a real browser. These tests pin this repository's languages on the common editor
// (@proginone/exercise-ui): JS/HTML/CSS modes and Prettier.
function viewOf(container: HTMLElement): EditorView {
  const content = container.querySelector<HTMLElement>('.cm-content');
  if (!content) throw new Error('editor not mounted');
  const view = EditorView.findFromDOM(content);
  if (!view) throw new Error('no EditorView');
  return view;
}

describe('formatCode', () => {
  it('formats JS, CSS and HTML with the learner style', async () => {
    expect(await formatCode('const  x=[1,2]', 'js')).toBe('const x = [1, 2];\n');
    expect(await formatCode('a{color:red}', 'css')).toBe('a {\n  color: red;\n}\n');
    expect(await formatCode('<p>hi</p><style>p{color:red}</style>', 'html')).toContain(
      'p {\n    color: red;\n  }',
    );
  });

  it('reports the line of a syntax error', async () => {
    const error = await formatCode('const x = ;\n', 'js').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FormatError);
    expect((error as FormatError).line).toBe(1);
    expect((error as FormatError).message).toContain('1번째 줄');
  });

  it('maps file paths to editor languages', () => {
    expect(languageOfPath('main.js')).toBe('js');
    expect(languageOfPath('index.html')).toBe('html');
    expect(languageOfPath('style.css')).toBe('css');
    expect(languageOfPath('data.json')).toBeNull();
  });
});

describe('CodeEditor', () => {
  it('shows the value in a labelled, described editing area', async () => {
    const { container } = renderUi(
      <CodeEditor
        value={'const a = 1;'}
        onChange={() => undefined}
        language="js"
        label="main.js 편집기"
      />,
    );
    const textbox = screen.getByRole('textbox', { name: 'main.js 편집기' });
    expect(textbox.textContent).toBe('const a = 1;');
    expect(textbox.getAttribute('aria-describedby')).toBe(
      screen.getByText(/Esc 다음 Tab으로 에디터를 빠져나가요/).id,
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('reports learner edits but not parent-driven value changes', () => {
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState('let x;');
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setValue('// reset');
            }}
          >
            reset
          </button>
          <CodeEditor
            value={value}
            onChange={(v) => {
              onChange(v);
              setValue(v);
            }}
            language="js"
            label="편집기"
          />
        </>
      );
    }
    const { container } = renderUi(<Harness />);
    const view = viewOf(container);
    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: ' x = 2;' } });
    });
    expect(onChange).toHaveBeenLastCalledWith('let x; x = 2;');

    onChange.mockClear();
    act(() => {
      screen.getByRole('button', { name: 'reset' }).click();
    });
    expect(view.state.doc.toString()).toBe('// reset');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks error lines and lists them as text', () => {
    const { container } = renderUi(
      <CodeEditor
        value={'a\nb\nc'}
        onChange={() => undefined}
        language="js"
        label="편집기"
        errorLines={[2]}
      />,
    );
    expect(container.querySelectorAll('.cm-pi-error-line')).toHaveLength(1);
    expect(screen.getByText(/오류 줄: 2/)).toBeTruthy();
  });

  it('is read-only on request and keeps autocomplete off by default', () => {
    const { container } = renderUi(
      <CodeEditor value="x" onChange={() => undefined} language="css" label="편집기" readOnly />,
    );
    const view = viewOf(container);
    expect(view.state.readOnly).toBe(true);
    expect(screen.getByRole('textbox', { name: '편집기' }).getAttribute('contenteditable')).toBe(
      'false',
    );
    expect(container.querySelector('.cm-tooltip-autocomplete')).toBeNull();
  });

  it('formats through its handle and moves to a line', async () => {
    const ref = createRef<CodeEditorHandle>();
    const onChange = vi.fn();
    const { container } = renderUi(
      <CodeEditor
        ref={ref}
        value={'const  x=1'}
        onChange={onChange}
        language="js"
        label="편집기"
      />,
    );
    await act(async () => {
      await ref.current?.format();
    });
    expect(onChange).toHaveBeenLastCalledWith('const x = 1;\n');
    act(() => {
      ref.current?.goToLine(2);
    });
    const view = viewOf(container);
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(2);
  });
});

describe('EditorPane', () => {
  const files: CodeFile[] = [
    { path: 'index.html', content: '<p>hi</p>' },
    { path: 'style.css', content: 'p{}' },
  ];

  function Harness({ onReset }: { onReset: () => void }) {
    const [value, setValue] = useState(files);
    return (
      <EditorPane files={value} onChange={setValue} onReset={onReset} saveStatus="저장됨 · 방금" />
    );
  }

  it('switches files and confirms before resetting', async () => {
    const onReset = vi.fn();
    const { user, container } = renderUi(<Harness onReset={onReset} />);
    expect(screen.getByRole('textbox', { name: 'index.html 편집기' })).toBeTruthy();
    expect(screen.getByText('저장됨 · 방금')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'style.css' }));
    expect(screen.getByRole('button', { name: 'style.css' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('textbox', { name: 'style.css 편집기' }).textContent).toBe('p{}');

    await user.click(screen.getByRole('button', { name: '초기화' }));
    const dialog = screen.getByRole('dialog', { name: '처음 코드로 되돌릴까요?' });
    await user.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(onReset).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '초기화' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '초기화' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('explains a format failure', async () => {
    const { user } = renderUi(
      <EditorPane
        files={[{ path: 'main.js', content: 'const x = ;' }]}
        onChange={() => undefined}
      />,
    );
    await user.click(screen.getByRole('button', { name: '포맷' }));
    expect(
      await screen.findByText(
        '코드를 읽을 수 없어 정리하지 못했어요(문법 오류). 1번째 줄 근처를 확인해 보세요.',
      ),
    ).toBeTruthy();
  });
});
