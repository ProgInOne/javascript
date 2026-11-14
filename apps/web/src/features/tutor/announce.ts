// Screen reader announcements of a streaming reply: complete paragraphs only, never per token
// (ui-ux.md 접근성 기준 "튜터 스트리밍 응답은 토큰 단위로 낭독하지 않고").

/**
 * End of the last complete paragraph in `text` (just after a blank line that is not inside a
 * code fence), or 0 when no paragraph is complete yet.
 */
export function completeParagraphsEnd(text: string): number {
  let end = 0;
  let inFence = false;
  const re = /^```.*$|\n[ \t]*\n/gm;
  for (const m of text.matchAll(re)) {
    if (m[0].startsWith('```')) inFence = !inFence;
    else if (!inFence) end = m.index + m[0].length;
  }
  return end;
}

/** Markdown → plain sentences to read out. Code blocks are summarized, not spelled out. */
export function speakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, ' (코드 예시) ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])/g, '$1')
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
