import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/**
 * Editor theme on the design tokens (`--code-*`, `--syn-*`, ui-ux.md#에디터와-코드-색). Colors are
 * CSS variables, so the light default and the dark workbench (`.workbench` remap, D-024) both work
 * without rebuilding the editor.
 */
export const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--code-surface)',
    color: 'var(--code-fg)',
    font: 'var(--text-code)',
    // Ligatures off in the editor too (ui-ux.md 타이포그래피): `=>` stays two characters.
    fontVariantLigatures: 'none',
    fontFeatureSettings: '"liga" 0, "calt" 0',
    height: '100%',
  },
  '&.cm-focused': {
    outline: '2px solid var(--color-focus-ring)',
    outlineOffset: '-2px',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
  },
  '.cm-content': {
    caretColor: 'var(--code-fg)',
    padding: 'var(--space-3) 0',
    fontVariantLigatures: 'none',
    fontFeatureSettings: '"liga" 0, "calt" 0',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--code-fg)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
    { backgroundColor: 'var(--code-selection)' },
  // Native selection inside the content (screen readers, copy) follows the same color.
  '.cm-content ::selection': { backgroundColor: 'var(--code-selection)' },
  '.cm-activeLine': { backgroundColor: 'var(--code-line-active)' },
  // The active line paints above the selection layer, so while text is selected it steps aside:
  // otherwise the line where a drag ends hides its part of the selection.
  '&.cm-pi-has-selection .cm-activeLine, &.cm-pi-has-selection .cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--code-gutter-bg)',
    color: 'var(--code-gutter-fg)',
    border: 'none',
    borderRight: '1px solid var(--code-border)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--code-line-active)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 var(--space-3) 0 var(--space-2)' },
  '.cm-matchingBracket': {
    backgroundColor: 'transparent',
    outline: '1px solid var(--color-border-input)',
  },
  '.cm-pi-error-line': { backgroundColor: 'var(--code-line-error)' },
  '.cm-pi-error-gutter .cm-gutterElement': {
    color: 'var(--color-feedback-incorrect-fg)',
    fontWeight: '700',
    padding: '0 var(--space-1)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--color-bg-surface-raised)',
    border: '1px solid var(--color-border-default)',
    color: 'var(--color-text-primary)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--color-bg-selected)',
    color: 'var(--color-text-primary)',
  },
});

/** Marks the editor while any selection range is non-empty (see the `.cm-pi-has-selection` rule). */
export const selectionMarker = EditorView.editorAttributes.compute(['selection'], (state) =>
  state.selection.ranges.some((range) => !range.empty) ? { class: 'cm-pi-has-selection' } : {},
);

/** Syntax colors: jade keywords, blue functions, amber numbers, violet strings, neutral comments. */
export const editorHighlight = syntaxHighlighting(
  HighlightStyle.define([
    {
      tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword],
      color: 'var(--syn-keyword)',
    },
    { tag: [t.definitionKeyword, t.modifier, t.self, t.null, t.bool], color: 'var(--syn-keyword)' },
    {
      tag: [t.function(t.variableName), t.function(t.propertyName), t.tagName],
      color: 'var(--syn-fn)',
    },
    { tag: [t.number, t.integer, t.float, t.atom, t.unit], color: 'var(--syn-number)' },
    {
      tag: [t.string, t.special(t.string), t.regexp, t.attributeValue],
      color: 'var(--syn-string)',
    },
    {
      tag: [t.comment, t.lineComment, t.blockComment],
      color: 'var(--syn-comment)',
      fontStyle: 'italic',
    },
    { tag: [t.punctuation, t.bracket, t.separator, t.angleBracket], color: 'var(--syn-punct)' },
    { tag: [t.propertyName, t.attributeName, t.className], color: 'var(--syn-prop)' },
    { tag: t.invalid, color: 'var(--color-feedback-incorrect-fg)' },
  ]),
);
