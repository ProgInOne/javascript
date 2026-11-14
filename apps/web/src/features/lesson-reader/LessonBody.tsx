import type { LessonConcept } from '@proginone/shared';
import { Badge } from '@proginone/ui';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  ExternalLink,
  Info,
  Lightbulb,
  OctagonAlert,
  PencilLine,
  Telescope,
} from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { InlineExerciseSlot } from './InlineExerciseSlot.tsx';
import { RunnableExampleBlock } from './RunnableExampleBlock.tsx';
import { SECTION_LABELS } from './sections.ts';

/**
 * Renders the lesson tree built by content-cli (validated MDX → mdast + allowed components).
 * The tree comes over the API, so it is treated as untrusted: unknown node types and components
 * render nothing, links are limited to http(s) and in-app paths, and there is no raw HTML path.
 */

type Node = Record<string, unknown> & { type?: unknown; children?: unknown };

interface LessonContextValue {
  lessonId: string;
  concepts: ReadonlyMap<string, LessonConcept>;
}
const LessonContext = createContext<LessonContextValue | null>(null);
const useLesson = () => {
  const ctx = useContext(LessonContext);
  if (!ctx) throw new Error('LessonBody context missing');
  return ctx;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const kids = (n: Node): Node[] => (Array.isArray(n.children) ? (n.children as Node[]) : []);
const props = (n: Node): Record<string, unknown> =>
  n['props'] && typeof n['props'] === 'object' ? (n['props'] as Record<string, unknown>) : {};

function safeHref(url: string | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function Children({ of }: { of: Node }) {
  return (
    <>
      {kids(of).map((child, i) => (
        <NodeView key={i} node={child} />
      ))}
    </>
  );
}

const CALLOUT_ICONS: Partial<Record<string, typeof Info>> = {
  note: Info,
  tip: Lightbulb,
  warning: AlertTriangle,
  danger: OctagonAlert,
  'deep-dive': Telescope,
};

function Component({ node }: { node: Node }) {
  const { concepts } = useLesson();
  const p = props(node);
  switch (node['name']) {
    case 'Section': {
      const kind = str(p['kind']) ?? '';
      const id = str(p['id']) ?? kind;
      const title = str(p['title']) ?? SECTION_LABELS[kind] ?? kind;
      return (
        <section
          id={id}
          aria-labelledby={`${id}-title`}
          className="lesson-section"
          data-kind={kind}
        >
          <h2 id={`${id}-title`}>{title}</h2>
          {kind === 'prerequisites' && <PrerequisitesSection />}
          {kind === 'practice' && <PracticeSection />}
          <Children of={node} />
        </section>
      );
    }
    case 'Callout': {
      const kind = str(p['kind']) ?? 'note';
      const Icon = CALLOUT_ICONS[kind] ?? Info;
      return (
        <aside className="lesson-callout" data-kind={kind}>
          <Icon size={18} aria-hidden="true" className="lesson-callout__icon" />
          <div>
            {str(p['title']) && <p className="lesson-callout__title">{str(p['title'])}</p>}
            <Children of={node} />
          </div>
        </aside>
      );
    }
    case 'Pitfall':
      return (
        <div className="lesson-pitfall">
          <Children of={node} />
        </div>
      );
    case 'Wrong':
    case 'Actual':
    case 'Right': {
      const label = { Wrong: '잘못된 생각', Actual: '실제 동작', Right: '올바른 이해' }[
        node['name']
      ];
      return (
        <div className="lesson-pitfall__part" data-part={node['name'].toLowerCase()}>
          <p className="lesson-pitfall__label">{label}</p>
          <Children of={node} />
        </div>
      );
    }
    case 'CompareTable': {
      const columns = Array.isArray(p['columns']) ? (p['columns'] as string[]) : [];
      const rows = flattenRows(node);
      return (
        <div className="lesson-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">항목</span>
                </th>
                {columns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <th scope="row">{str(props(row)['label'])}</th>
                  {splitCells(kids(row)).map((cell, j) => (
                    <td key={j}>
                      {cell.map((n, k) => (
                        <NodeView key={k} node={n} />
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'ConceptLink': {
      const to = str(p['to']) ?? '';
      const concept = concepts.get(to);
      return (
        <span className="lesson-concept-link" title={concept?.summary}>
          <Children of={node} />
        </span>
      );
    }
    case 'MdnLink': {
      const path = str(p['path']) ?? '';
      const href = safeHref(`https://developer.mozilla.org/ko/docs/${path}`);
      return href ? (
        <a href={href} target="_blank" rel="noreferrer noopener" className="lesson-link">
          MDN: {path.split('/').at(-1)}
          <ExternalLink size={14} aria-hidden="true" className="ml-0.5 inline align-[-2px]" />
          <span className="sr-only">(새 탭)</span>
        </a>
      ) : null;
    }
    case 'Reveal':
      return (
        <details className="lesson-reveal">
          <summary>{str(p['title'])}</summary>
          <Children of={node} />
        </details>
      );
    case 'Key':
      return (
        <kbd className="lesson-kbd">
          <Children of={node} />
        </kbd>
      );
    case 'RunnableExample':
      return (
        <RunnableExampleBlock
          id={str(p['id']) ?? ''}
          lang={str(p['lang']) ?? 'js'}
          code={str(p['code']) ?? ''}
          predict={p['predict'] === true}
        />
      );
    case 'InlineExercise':
      return <InlineExerciseSlot exerciseId={str(p['ref']) ?? ''} />;
    case 'Diagram':
      // Mermaid rendering arrives later; the alt text keeps the content accessible meanwhile.
      return (
        <figure className="lesson-figure">
          <pre className="lesson-code">
            <code>{str(p['code'])}</code>
          </pre>
          <figcaption>{str(p['alt'])}</figcaption>
        </figure>
      );
    default:
      return null;
  }
}

/** Rows may arrive wrapped in a paragraph when written on single lines. */
function flattenRows(table: Node): Node[] {
  return kids(table).flatMap((n) =>
    n['name'] === 'Row'
      ? [n]
      : n.type === 'paragraph'
        ? kids(n).filter((c) => c['name'] === 'Row')
        : [],
  );
}

/** Row cells are separated by `|` in the row's inline content: `<Row label="숫자">\`1\` | 숫자</Row>`. */
function splitCells(nodes: Node[]): Node[][] {
  const flat = nodes.length === 1 && nodes[0]?.type === 'paragraph' ? kids(nodes[0]) : nodes;
  const cells: Node[][] = [[]];
  for (const n of flat) {
    const value = n.type === 'text' ? str(n['value']) : undefined;
    if (value === undefined) {
      cells.at(-1)?.push(n);
      continue;
    }
    value.split('|').forEach((part, i) => {
      if (i > 0) cells.push([]);
      const trimmed =
        i === 0 ? part.replace(/\s+$/, value.includes('|') ? '' : ' ') : part.trimStart();
      if (trimmed) cells.at(-1)?.push({ type: 'text', value: trimmed });
    });
  }
  return cells;
}

/** Auto-generated from data (content MDX leaves these sections empty). */
function PrerequisitesSection() {
  const { concepts } = useLesson();
  const reviewed = [...concepts.values()].filter((c) => c.role === 'reviews');
  if (reviewed.length === 0)
    return <p>이 단원은 따로 알아야 할 선수 개념 없이 시작할 수 있어요.</p>;
  return (
    <ul>
      {reviewed.map((c) => (
        <li key={c.id}>
          <strong>{c.title}</strong>: {c.summary}
        </li>
      ))}
    </ul>
  );
}

/** "직접 풀어 보기": the way into practice mode (ui-ux.md 읽기 모드, 연습 시작). */
function PracticeSection() {
  const { lessonId } = useLesson();
  return (
    <div className="lesson-practice-cta">
      <p className="m-0">본문을 다 읽었어요. 이제 직접 풀어볼까요?</p>
      <Link
        to="/learn/$lessonId"
        params={{ lessonId }}
        search={{ mode: 'practice' }}
        className="pi-button pi-button--primary pi-button--md no-underline"
      >
        <PencilLine size={16} aria-hidden="true" />
        연습 시작
      </Link>
    </div>
  );
}

function NodeView({ node }: { node: Node }): ReactNode {
  switch (node.type) {
    case 'component':
      return <Component node={node} />;
    case 'text':
      return str(node['value']) ?? null;
    case 'paragraph':
      return (
        <p>
          <Children of={node} />
        </p>
      );
    case 'heading': {
      // Lesson headings sit under section h2s.
      const depth = Math.min(Math.max(Number(node['depth']) + 1, 3), 6);
      const Tag = `h${depth}` as 'h3';
      return (
        <Tag>
          <Children of={node} />
        </Tag>
      );
    }
    case 'emphasis':
      return (
        <em>
          <Children of={node} />
        </em>
      );
    case 'strong':
      return (
        <strong>
          <Children of={node} />
        </strong>
      );
    case 'delete':
      return (
        <del>
          <Children of={node} />
        </del>
      );
    case 'inlineCode':
      return <code className="lesson-inline-code">{str(node['value'])}</code>;
    case 'code':
      return (
        <pre className="lesson-code" data-lang={str(node['lang'])}>
          <code>{str(node['value'])}</code>
        </pre>
      );
    case 'break':
      return <br />;
    case 'thematicBreak':
      return <hr />;
    case 'blockquote':
      return (
        <blockquote>
          <Children of={node} />
        </blockquote>
      );
    case 'list': {
      const Tag = node['ordered'] === true ? 'ol' : 'ul';
      return (
        <Tag>
          <Children of={node} />
        </Tag>
      );
    }
    case 'listItem': {
      // Tight list items wrap their text in a single paragraph; unwrap it.
      const [only, ...rest] = kids(node);
      return (
        <li>
          {only?.type === 'paragraph' && rest.length === 0 ? (
            <Children of={only} />
          ) : (
            <Children of={node} />
          )}
        </li>
      );
    }
    case 'link': {
      const href = safeHref(str(node['url']));
      if (!href) return <Children of={node} />;
      const external = !href.startsWith('/');
      return (
        <a
          href={href}
          className="lesson-link"
          {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
        >
          <Children of={node} />
          {external && <span className="sr-only">(새 탭)</span>}
        </a>
      );
    }
    case 'table': {
      const [head, ...rows] = kids(node);
      return (
        <div className="lesson-table-wrap">
          <table>
            {head && (
              <thead>
                <tr>
                  {kids(head).map((cell, i) => (
                    <th key={i} scope="col">
                      <Children of={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {kids(row).map((cell, j) => (
                    <td key={j}>
                      <Children of={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    default:
      return null;
  }
}

export function LessonBody({
  lessonId,
  body,
  concepts,
}: {
  lessonId: string;
  body: readonly unknown[];
  concepts: readonly LessonConcept[];
}) {
  const value = { lessonId, concepts: new Map(concepts.map((c) => [c.id, c])) };
  return (
    <LessonContext.Provider value={value}>
      <div className="lesson-prose">
        {body.map((node, i) =>
          node && typeof node === 'object' ? <NodeView key={i} node={node as Node} /> : null,
        )}
      </div>
    </LessonContext.Provider>
  );
}

export function ConceptImportanceBadge({
  importance,
}: {
  importance: LessonConcept['importance'];
}) {
  return importance === 'core' ? <Badge variant="brand">핵심</Badge> : null;
}
