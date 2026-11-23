import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import {
  CodeEditor as CommonCodeEditor,
  EditorPane as CommonEditorPane,
  type CodeEditorProps as CommonCodeEditorProps,
  type EditorLanguageSupport,
  type EditorPaneProps as CommonEditorPaneProps,
} from '@proginone/exercise-ui';
import { formatCode, type EditorLanguage } from './format.ts';

// This repository's editor languages for the common code editor (@proginone/exercise-ui, D-096):
// CodeMirror's JS/HTML/CSS modes, two-space indentation and Prettier.

const support = (
  id: EditorLanguage,
  pattern: RegExp,
  extension: EditorLanguageSupport['extension'],
): EditorLanguageSupport => ({
  id,
  matchesPath: (path) => pattern.test(path),
  extension,
  format: (code) => formatCode(code, id),
});

export const EDITOR_LANGUAGES: Readonly<Record<EditorLanguage, EditorLanguageSupport>> = {
  js: support('js', /\.m?js$/i, () => javascript()),
  html: support('html', /\.html?$/i, () => html({ autoCloseTags: false })),
  css: support('css', /\.css$/i, () => css()),
};

const ALL_LANGUAGES = Object.values(EDITOR_LANGUAGES);

export type CodeEditorProps = Omit<CommonCodeEditorProps, 'language'> & {
  language: EditorLanguage;
};

/** The common code editor in one of this repository's languages. */
export function CodeEditor({ language, ...props }: CodeEditorProps) {
  return <CommonCodeEditor {...props} language={EDITOR_LANGUAGES[language]} />;
}

export type EditorPaneProps = Omit<CommonEditorPaneProps, 'languages'>;

/** The common editor pane with this repository's languages. */
export function EditorPane(props: EditorPaneProps) {
  return <CommonEditorPane {...props} languages={ALL_LANGUAGES} />;
}
