import { CodeBlock, InlineText } from '@proginone/exercise-kit-ui';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState, type ReactNode } from 'react';

export interface MarkdownProps {
  text: string;
  /**
   * `content` (default): the small subset authored in exercise prompts and explanations.
   * `ai`: AI output (tutor replies, AI hints) also gets headings, quotes, emphasis, safe links
   * and copyable code blocks (docs/design/ai-system.md#마크다운-렌더링-안전성).
   */
  variant?: 'content' | 'ai';
}

/**
 * Renders Markdown as React elements only: raw HTML is never interpreted (it stays visible text),
 * so authored content and untrusted AI output cannot inject markup. Unfinished input (an open code
 * fence while a reply streams) renders safely as it is.
 */
export function Markdown({ text, variant = 'content' }: MarkdownProps) {
  const ai = variant === 'ai';
  return <div className={ai ? 'practice-md ai-md' : 'practice-md'}>{blocks(text, ai)}</div>;
}

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'ul' | 'ol'; items: ListItem[] }
  | { kind: 'heading'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; align: Align[]; head: string[]; rows: string[][] }
  | { kind: 'hr' };

type Align = 'left' | 'center' | 'right' | null;

/** A list item, with at most one nested list (one level, as authored prompts use it). */
interface ListItem {
  text: string;
  sub: { kind: 'ul' | 'ol'; items: string[] } | null;
}

const BULLET = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_DELIMITER = /^\s*:?-+:?\s*$/;

/**
 * Splits a GFM pipe-table row into cells: the outer pipes are optional, `\|` is a literal pipe
 * (also inside code spans, as in GFM) and every other `|` separates cells.
 */
function tableCells(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

/** A delimiter row (`|---|:--:|`) gives the alignment per column, or null if it is not one. */
function tableAlign(line: string): Align[] | null {
  if (!line.includes('-')) return null;
  const cells = tableCells(line);
  if (!cells.every((cell) => TABLE_DELIMITER.test(cell))) return null;
  return cells.map((cell) =>
    cell.startsWith(':')
      ? cell.endsWith(':')
        ? 'center'
        : 'left'
      : cell.endsWith(':')
        ? 'right'
        : null,
  );
}

function parse(text: string, ai: boolean): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const at = (n: number) => lines[n] ?? '';
  // A table starts at a row containing a pipe followed by a delimiter row with as many cells (so
  // a table still streaming in renders as a paragraph until its delimiter row is complete).
  const tableAt = (n: number): Align[] | null => {
    if (!at(n).includes('|') || n + 1 >= lines.length) return null;
    const align = tableAlign(at(n + 1));
    return align?.length === tableCells(at(n)).length ? align : null;
  };
  const startsBlock = (n: number) => {
    const line = at(n);
    return (
      /^\s*```/.test(line) ||
      BULLET.test(line) ||
      ORDERED.test(line) ||
      tableAt(n) !== null ||
      (ai && (HEADING.test(line) || QUOTE.test(line) || RULE.test(line)))
    );
  };
  let i = 0;
  while (i < lines.length) {
    const line = at(i);
    // Any line starting with ``` opens a fence (info strings like "```js title" included), so a
    // paragraph can never stop on a line no block consumes.
    const fence = /^\s*```\s*([\w-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(at(i))) body.push(at(i++));
      i++; // closing fence (absent while a reply is still streaming)
      out.push({ kind: 'code', lang: fence[1] ?? '', lines: body });
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (ai && RULE.test(line)) {
      out.push({ kind: 'hr' });
      i++;
      continue;
    }
    const heading = ai ? HEADING.exec(line) : null;
    if (heading) {
      out.push({ kind: 'heading', text: heading[1] ?? '' });
      i++;
      continue;
    }
    if (ai && QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(at(i))) quoted.push(QUOTE.exec(at(i++))?.[1] ?? '');
      out.push({ kind: 'quote', text: quoted.join('\n') });
      continue;
    }
    const align = tableAt(i);
    if (align) {
      const width = align.length;
      // Ragged rows: missing cells are empty, extra cells are dropped (as in GFM).
      const fit = (cells: string[]) => Array.from({ length: width }, (_, c) => cells[c] ?? '');
      const head = fit(tableCells(line));
      const rows: string[][] = [];
      i += 2;
      // The table ends at a blank line, a line without a pipe or the start of another block.
      while (i < lines.length && at(i).includes('|') && !startsBlock(i)) {
        rows.push(fit(tableCells(at(i++))));
      }
      out.push({ kind: 'table', align, head, rows });
      continue;
    }
    const listKind = BULLET.test(line) ? 'ul' : ORDERED.test(line) ? 'ol' : null;
    if (listKind) {
      const re = listKind === 'ul' ? BULLET : ORDERED;
      const items: ListItem[] = [];
      const indent = (l: string) => /^\s*/.exec(l)?.[0].length ?? 0;
      const base = indent(line);
      while (i < lines.length) {
        const cur = at(i);
        const last = items.at(-1);
        // A marker indented past the list's own is a nested list of the item above.
        const nestedKind =
          last && indent(cur) >= base + 2
            ? BULLET.test(cur)
              ? 'ul'
              : ORDERED.test(cur)
                ? 'ol'
                : null
            : null;
        const m = nestedKind ? null : re.exec(cur);
        if (last && nestedKind) {
          const text = (nestedKind === 'ul' ? BULLET : ORDERED).exec(cur)?.[1] ?? '';
          if (last.sub?.kind === nestedKind) last.sub.items.push(text);
          else if (last.sub === null) last.sub = { kind: nestedKind, items: [text] };
          else last.sub.items.push(text);
        } else if (m) items.push({ text: m[1] ?? '', sub: null });
        else if (/^\s{2,}\S/.test(cur) && last) {
          if (last.sub) {
            const n = last.sub.items.length - 1;
            last.sub.items[n] = `${last.sub.items[n] ?? ''} ${cur.trim()}`;
          } else last.text = `${last.text} ${cur.trim()}`;
        } else break;
        i++;
      }
      out.push({ kind: listKind, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && at(i).trim() !== '' && !startsBlock(i)) {
      para.push(at(i).trim());
      i++;
    }
    if (para.length === 0) para.push(at(i++).trim()); // never loop on an unconsumed line
    out.push({ kind: 'p', lines: para });
  }
  return out;
}

const CODE_LANGS = new Set(['js', 'javascript', 'html', 'css']);

function blocks(text: string, ai: boolean): ReactNode[] {
  const span = ai ? aiInline : inline;
  return parse(text, ai).map((block, index) => {
    switch (block.kind) {
      case 'code': {
        const known = CODE_LANGS.has(block.lang);
        const lang = block.lang === 'javascript' ? 'js' : block.lang;
        const code = block.lines.join('\n');
        // Authored content marks program output as ```text; any other unlabelled block is code.
        const label = known ? lang : !ai && lang === 'text' ? '출력' : lang || '코드';
        const view = <CodeBlock key={index} code={code} lineNumbers={known} language={label} />;
        return ai ? (
          <CopyableCode key={index} code={code}>
            {view}
          </CopyableCode>
        ) : (
          view
        );
      }
      case 'ul':
      case 'ol': {
        const List = block.kind;
        return (
          <List key={index}>
            {block.items.map((item, i) => (
              <li key={i}>
                {span(item.text)}
                {item.sub &&
                  (item.sub.kind === 'ul' ? (
                    <ul>
                      {item.sub.items.map((t, j) => (
                        <li key={j}>{span(t)}</li>
                      ))}
                    </ul>
                  ) : (
                    <ol>
                      {item.sub.items.map((t, j) => (
                        <li key={j}>{span(t)}</li>
                      ))}
                    </ol>
                  ))}
              </li>
            ))}
          </List>
        );
      }
      case 'heading':
        // Not a real heading: AI output must not change the page outline.
        return (
          <p key={index} className="ai-md__heading">
            <strong>{span(block.text)}</strong>
          </p>
        );
      case 'quote':
        return <blockquote key={index}>{blocks(block.text, ai)}</blockquote>;
      case 'table':
        // Wide tables scroll inside their own box, never the page (same look as lesson tables).
        return (
          <div key={index} className="lesson-table-wrap practice-md__table">
            <table>
              <thead>
                <tr>
                  {block.head.map((cell, c) => (
                    <th key={c} scope="col" data-align={block.align[c] ?? undefined}>
                      {span(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} data-align={block.align[c] ?? undefined}>
                        {span(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'hr':
        return <hr key={index} />;
      case 'p':
        return <p key={index}>{span(block.lines.join(' '))}</p>;
    }
  });
}

/** `**bold**` around code spans (rendered by InlineText). */
function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\*\*(.+?)\*\*/g)) {
    if (m.index > last) parts.push(<InlineText key={last} text={text.slice(last, m.index)} />);
    parts.push(
      <strong key={`b${m.index}`}>
        <InlineText text={m[1] ?? ''} />
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<InlineText key={last} text={text.slice(last)} />);
  return parts;
}

// Code spans first so `*` or `[` inside code stays literal; then images, links, bold, italic.
const AI_INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(([^)\s]*)(?:\s+"[^"]*")?\)|\*\*(.+?)\*\*|__(.+?)__|\*(?![\s*])(.+?)(?<![\s*])\*|(?<![\p{L}\p{N}_])_(?![\s_])(.+?)(?<![\s_])_(?![\p{L}\p{N}_])/gu;

/** Only http(s) links are clickable; `javascript:`, `data:` and the rest stay plain text. */
export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function aiInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(AI_INLINE)) {
    const at = m.index;
    if (at > last) parts.push(text.slice(last, at));
    const [whole, , code, alt, , linkText, href, bold1, bold2, em1, em2] = m;
    if (code !== undefined) {
      parts.push(
        <code key={at} className="pi-ex-inline-code">
          {code.replace(/^ (.*) $/s, '$1')}
        </code>,
      );
    } else if (alt !== undefined) {
      // Images are never loaded (tracking pixels, local requests): the alt text only.
      parts.push(<span key={at}>[이미지{alt ? `: ${alt}` : ''}]</span>);
    } else if (linkText !== undefined) {
      const safe = safeHref(href ?? '');
      parts.push(
        safe ? (
          <a key={at} href={safe} target="_blank" rel="noopener noreferrer" className="ai-md__link">
            {aiInline(linkText)}
            <ExternalLink size={12} aria-hidden="true" />
            <span className="sr-only"> (새 탭)</span>
          </a>
        ) : (
          <span key={at}>{whole}</span>
        ),
      );
    } else if (bold1 !== undefined || bold2 !== undefined) {
      parts.push(<strong key={at}>{aiInline(bold1 ?? bold2 ?? '')}</strong>);
    } else {
      parts.push(<em key={at}>{aiInline(em1 ?? em2 ?? '')}</em>);
    }
    last = at + whole.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** A code block of AI output with a copy button. Never runs the code. */
function CopyableCode({ code, children }: { code: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ai-md__code">
      {children}
      <button
        type="button"
        className="ai-md__copy"
        onClick={() => {
          void Promise.resolve()
            .then(() => navigator.clipboard.writeText(code))
            .then(() => {
              setCopied(true);
              setTimeout(() => {
                setCopied(false);
              }, 2_000);
            })
            .catch(() => undefined);
        }}
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        <span aria-live="polite">{copied ? '복사했어요' : '복사'}</span>
      </button>
    </div>
  );
}
