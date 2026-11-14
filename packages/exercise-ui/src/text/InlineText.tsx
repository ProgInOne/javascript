import type { ReactNode } from 'react';

const CODE_SPAN = /(`+)([\s\S]*?[^`])\1(?!`)/g;

/**
 * Renders authored short text (option text, hints, check descriptions) with Markdown code spans
 * (`` `x` ``) as `<code>`. Everything else stays plain text: raw HTML is never interpreted, so
 * content (including AI-generated hints) cannot inject markup.
 */
export function InlineText({ text }: { text: string }): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(CODE_SPAN)) {
    const start = match.index;
    if (start > last) parts.push(text.slice(last, start));
    const code = (match[2] ?? '').replace(/^ (.*) $/s, '$1');
    parts.push(
      <code key={start} className="pi-ex-inline-code">
        {code}
      </code>,
    );
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
