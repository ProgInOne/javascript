import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
import {
  Annotation,
  Compartment,
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  GutterMarker,
  drawSelection,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers as lineNumbersExtension,
  type DecorationSet,
  type KeyBinding,
} from '@codemirror/view';
import { useEffect, useId, useImperativeHandle, useRef, type Ref } from 'react';
import { FormatError, formatCode, type EditorLanguage } from './format.ts';
import { editorHighlight, editorTheme } from './theme.ts';

/** Imperative handle for toolbar buttons and console "go to line" links. */
export interface CodeEditorHandle {
  focus(): void;
  /** Moves the cursor to a 1-based line, scrolls it into view and focuses the editor. */
  goToLine(line: number): void;
  /** Formats the document with Prettier. Rejects with `FormatError` for unparsable code. */
  format(): Promise<void>;
}

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: EditorLanguage;
  /** Accessible name of the editing area, e.g. "main.js 편집기". */
  label: string;
  readOnly?: boolean;
  /**
   * Autocomplete and auto-closing brackets. Off by default (settings default): beginners learn
   * more from typing code out, and suggestions can hide what they wrote.
   */
  autocomplete?: boolean;
  lineNumbers?: boolean;
  /** 1-based lines to mark as errors (red background + gutter mark + text below the editor). */
  errorLines?: readonly number[];
  /** Called when `⇧⌥F` formatting fails (syntax error). */
  onFormatError?: (error: FormatError) => void;
  /** Extra ID(s) for `aria-describedby` on the editing area. */
  describedBy?: string;
  ref?: Ref<CodeEditorHandle>;
}

/** Marks a programmatic document replacement so it is not echoed through `onChange`. */
const External = Annotation.define<boolean>();

const setErrorLines = StateEffect.define<readonly number[]>();

const errorLineDecoration = Decoration.line({ class: 'cm-pi-error-line' });

class ErrorMarker extends GutterMarker {
  override toDOM(): Node {
    const span = document.createElement('span');
    span.textContent = '✕';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}
const errorMarker = new ErrorMarker();

const errorLinesField = StateField.define<readonly number[]>({
  create: () => [],
  update(lines, tr) {
    for (const effect of tr.effects) if (effect.is(setErrorLines)) return effect.value;
    return lines;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (lines) => (view: EditorView): DecorationSet => {
      const doc = view.state.doc;
      const ranges = [...new Set(lines)]
        .filter((n) => n >= 1 && n <= doc.lines)
        .sort((a, b) => a - b)
        .map((n) => errorLineDecoration.range(doc.line(n).from));
      return Decoration.set(ranges);
    }),
  ],
});

const errorGutter = gutter({
  class: 'cm-pi-error-gutter',
  markers: (view) => {
    const doc = view.state.doc;
    const lines = [...new Set(view.state.field(errorLinesField))]
      .filter((n) => n >= 1 && n <= doc.lines)
      .sort((a, b) => a - b);
    return RangeSet.of(lines.map((n) => errorMarker.range(doc.line(n).from)));
  },
  initialSpacer: () => errorMarker,
});

function languageExtension(language: EditorLanguage): Extension {
  switch (language) {
    case 'js':
      return javascript();
    case 'html':
      return html({ autoCloseTags: false });
    case 'css':
      return css();
  }
}

// `Mod-Enter` stays free for "제출 (확실해요)": unbound keys bubble to the page's shortcut handler.
const RESERVED_KEYS = new Set(['Mod-Enter']);
const baseKeymap: readonly KeyBinding[] = defaultKeymap.filter(
  (binding) => binding.key === undefined || !RESERVED_KEYS.has(binding.key),
);

/** `⇧⌥F` / `Shift+Alt+F` (format), by physical key so keyboard layouts and macOS Alt work. */
export function isFormatShortcut(
  event: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>,
): boolean {
  return (
    event.code === 'KeyF' && event.shiftKey && event.altKey && !event.ctrlKey && !event.metaKey
  );
}

/**
 * CodeMirror 6 editor (EditorPane's core). Controlled: `value` in, `onChange` out.
 * Keyboard: `Tab` indents; `Esc` then `Tab` leaves the editor (CodeMirror's tab-focus mode, WCAG
 * 2.1.2); `⇧⌥F` formats. The hint is shown under the editor.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  label,
  readOnly = false,
  autocomplete = false,
  lineNumbers = true,
  errorLines = [],
  onFormatError,
  describedBy,
  ref,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const helpId = useId();
  const latest = useRef({ onChange, onFormatError });
  useEffect(() => {
    latest.current = { onChange, onFormatError };
  });

  const compartments = useRef({
    language: new Compartment(),
    readOnly: new Compartment(),
    assist: new Compartment(),
    gutter: new Compartment(),
    aria: new Compartment(),
  });

  const ariaAttrs = (): Extension =>
    EditorView.contentAttributes.of({
      'aria-label': label,
      'aria-describedby': describedBy ? `${helpId} ${describedBy}` : helpId,
    });
  const assist = (): Extension =>
    autocomplete
      ? [
          autocompletion(),
          closeBrackets(),
          keymap.of([...closeBracketsKeymap, ...completionKeymap]),
        ]
      : [];
  const gutters = (): Extension =>
    lineNumbers ? [lineNumbersExtension(), highlightActiveLineGutter()] : [];
  const readOnlyExt = (): Extension => [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
  ];

  const runFormat = async (view: EditorView): Promise<void> => {
    const before = view.state.doc.toString();
    const lang = language;
    const formatted = await formatCode(before, lang);
    // Skip if the learner kept typing while Prettier loaded/ran.
    if (view.state.doc.toString() !== before || formatted === before) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted } });
  };
  const formatRef = useRef(runFormat);
  useEffect(() => {
    formatRef.current = runFormat;
  });

  // Create the view once; later prop changes reconfigure compartments.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const c = compartments.current;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          c.gutter.of(gutters()),
          errorLinesField,
          errorGutter,
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          EditorState.tabSize.of(2),
          indentUnit.of('  '),
          editorTheme,
          editorHighlight,
          c.language.of(languageExtension(language)),
          c.readOnly.of(readOnlyExt()),
          c.assist.of(assist()),
          c.aria.of(ariaAttrs()),
          // `⇧⌥F` matched by physical key: on macOS Alt combinations type characters (Ï), which
          // CodeMirror's keymap deliberately does not treat as shortcuts.
          EditorView.domEventHandlers({
            keydown: (event, v) => {
              if (!isFormatShortcut(event)) return false;
              event.preventDefault();
              formatRef.current(v).catch((error: unknown) => {
                if (error instanceof FormatError) latest.current.onFormatError?.(error);
              });
              return true;
            },
          }),
          keymap.of([...baseKeymap, ...historyKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((tr) => tr.annotation(External))) return;
            latest.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The view is created once per mount; the effects below sync props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Controlled value: replace the document when the parent changes it (reset, file switch).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: External.of(true),
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const c = compartments.current;
    view.dispatch({
      effects: [
        c.language.reconfigure(languageExtension(language)),
        c.readOnly.reconfigure(readOnlyExt()),
        c.assist.reconfigure(assist()),
        c.gutter.reconfigure(gutters()),
        c.aria.reconfigure(ariaAttrs()),
      ],
    });
    // Rebuilt from the listed props only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly, autocomplete, lineNumbers, label, describedBy]);

  const errorKey = errorLines.join(',');
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: setErrorLines.of(errorKey ? errorKey.split(',').map(Number) : []),
    });
  }, [errorKey]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        viewRef.current?.focus();
      },
      goToLine: (line: number) => {
        const view = viewRef.current;
        if (!view) return;
        const doc = view.state.doc;
        const target = doc.line(Math.min(Math.max(1, line), doc.lines));
        view.dispatch({
          selection: { anchor: target.from },
          effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
        });
        view.focus();
      },
      format: async () => {
        const view = viewRef.current;
        if (view) await formatRef.current(view);
      },
    }),
    [],
  );

  const shownErrors = [...new Set(errorLines)].sort((a, b) => a - b);

  return (
    <div className="pi-ex-editor" data-readonly={readOnly || undefined}>
      <div ref={hostRef} className="pi-ex-editor__host" />
      <p id={helpId} className="pi-ex-editor__help">
        {shownErrors.length > 0 && (
          <span className="pi-ex-editor__errors">오류 줄: {shownErrors.join(', ')} · </span>
        )}
        Esc 다음 Tab으로 에디터를 빠져나가요 · ⇧⌥F 코드 정리
      </p>
    </div>
  );
}
