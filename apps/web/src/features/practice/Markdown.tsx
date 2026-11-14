import { CodeBlock, InlineText } from '@proginone/exercise-ui';
import type { ReactNode } from 'react';

/**
 * Renders the small Markdown subset authored in exercise prompts and explanations: paragraphs,
 * fenced code blocks, `-`/`1.` lists, `**bold**` and code spans. It builds React elements only;
 * raw HTML is never interpreted, so content cannot inject markup.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="practice-md">{blocks(text)}</div>;
}

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'ul' | 'ol'; items: string[] };

function parse(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? '')) body.push(lines[i++] ?? '');
      i++; // closing fence
      out.push({ kind: 'code', lang: fence[1] ?? '', lines: body });
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/;
    const ordered = /^\s*\d+[.)]\s+(.*)$/;
    const listKind = bullet.test(line) ? 'ul' : ordered.test(line) ? 'ol' : null;
    if (listKind) {
      const re = listKind === 'ul' ? bullet : ordered;
      const items: string[] = [];
      while (i < lines.length) {
        const m = re.exec(lines[i] ?? '');
        if (m) items.push(m[1] ?? '');
        else if (/^\s{2,}\S/.test(lines[i] ?? '') && items.length > 0)
          items[items.length - 1] = `${items.at(-1) ?? ''} ${(lines[i] ?? '').trim()}`;
        else break;
        i++;
      }
      out.push({ kind: listKind, items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !/^\s*```/.test(lines[i] ?? '') &&
      !bullet.test(lines[i] ?? '') &&
      !ordered.test(lines[i] ?? '')
    ) {
      para.push((lines[i] ?? '').trim());
      i++;
    }
    out.push({ kind: 'p', lines: para });
  }
  return out;
}

const CODE_LANGS = new Set(['js', 'javascript', 'html', 'css']);

function blocks(text: string): ReactNode[] {
  return parse(text).map((block, index) => {
    switch (block.kind) {
      case 'code': {
        const lang = block.lang === 'javascript' ? 'js' : block.lang;
        return (
          <CodeBlock
            key={index}
            code={block.lines.join('\n')}
            lineNumbers={CODE_LANGS.has(block.lang)}
            {...(CODE_LANGS.has(block.lang) ? { language: lang } : { language: '출력' })}
          />
        );
      }
      case 'ul':
        return (
          <ul key={index}>
            {block.items.map((item, i) => (
              <li key={i}>{inline(item)}</li>
            ))}
          </ul>
        );
      case 'ol':
        return (
          <ol key={index}>
            {block.items.map((item, i) => (
              <li key={i}>{inline(item)}</li>
            ))}
          </ol>
        );
      case 'p':
        return <p key={index}>{inline(block.lines.join(' '))}</p>;
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
