import type { TutorSelection } from '@proginone/shared';

/** Marks lesson text or exercise areas where "선택해서 질문하기" applies. */
export const SELECTABLE_ATTR = 'data-tutor-selectable';
/** Inside the drawer selections are never offered (it would ask about the tutor's own answer). */
export const DRAWER_ATTR = 'data-tutor-drawer';

const MAX_SELECTION_CHARS = 4_000;

function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

/**
 * The current page selection as a tutor context chip, when it lies in a selectable area: code
 * (inside `pre`, `code` or the editor) or lesson text, with the lesson section it belongs to.
 */
export function readTutorSelection(
  selection: Selection | null = typeof window === 'undefined' ? null : window.getSelection(),
): TutorSelection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const el = elementOf(range.commonAncestorContainer);
  if (!el?.closest(`[${SELECTABLE_ATTR}]`) || el.closest(`[${DRAWER_ATTR}]`)) return null;
  const text = selection.toString().trim();
  if (text === '') return null;
  const start = elementOf(range.startContainer);
  const isCode = Boolean(
    el.closest('pre, code, .cm-content') ?? start?.closest('pre, code, .cm-content'),
  );
  const sectionId = el.closest('section[id]')?.id;
  return {
    kind: isCode ? 'code' : 'lesson_text',
    text: text.slice(0, MAX_SELECTION_CHARS),
    ...(sectionId ? { sectionId: sectionId.slice(0, 200) } : {}),
  };
}

/** "선택한 코드 3줄" / "선택한 텍스트 42자" for the context chip. */
export function selectionLabel(selection: TutorSelection): string {
  if (selection.kind === 'code') {
    const lines = selection.text.split('\n').length;
    return `선택한 코드 ${lines}줄`;
  }
  return `선택한 텍스트 ${selection.text.length}자`;
}
