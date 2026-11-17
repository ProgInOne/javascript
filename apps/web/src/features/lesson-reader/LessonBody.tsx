import type { CodeDraft, LessonConcept, LessonPrerequisite, Settings } from '@proginone/shared';
import { Badge, Button } from '@proginone/ui';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ExternalLink,
  Info,
  Lightbulb,
  OctagonAlert,
  PencilLine,
  Telescope,
} from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { MasteryIcon, STAGE_NAMES } from '../mastery/MasteryIcon.tsx';
import { InlineExerciseSlot } from './InlineExerciseSlot.tsx';
import { LessonDiagram } from './LessonDiagram.tsx';
import { RunnableExampleBlock } from './RunnableExampleBlock.tsx';
import { SECTION_LABELS } from './sections.ts';
import type { LessonStep } from './steps.ts';

/**
 * Renders the lesson tree built by content-cli (validated MDX → mdast + allowed components).
 * The tree comes over the API, so it is treated as untrusted: unknown node types and components
 * render nothing, links are limited to http(s) and in-app paths, and there is no raw HTML path.
 */

type Node = Record<string, unknown> & { type?: unknown; children?: unknown };

interface LessonContextValue {
  lessonId: string;
  kind: 'lesson' | 'assessment' | 'project';
  concepts: ReadonlyMap<string, LessonConcept>;
  /** `lesson.predictFirst` (설정 > 학습 방식): `required` hides "예측 건너뛰기". */
  predictFirst: Settings['lesson.predictFirst'];
  /** `GET /lessons/:id/prerequisites`; undefined while loading or when it failed. */
  prerequisites: readonly LessonPrerequisite[] | undefined;
  /** Server drafts of edited examples by example ID; undefined while loading (D-063). */
  exampleDrafts: ReadonlyMap<string, CodeDraft> | undefined;
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
          {pitfallParts(node).map((child, i) => (
            <NodeView key={i} node={child} />
          ))}
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
      return <RunnableExample p={p} />;
    case 'InlineExercise':
      return <InlineExerciseSlot exerciseId={str(p['ref']) ?? ''} />;
    case 'Diagram':
      return (
        <LessonDiagram
          source={str(p['code']) ?? ''}
          alt={str(p['alt']) ?? '다이어그램'}
          caption={str(p['caption'])}
        />
      );
    default:
      return null;
  }
}

const PITFALL_PARTS = new Set(['Wrong', 'Actual', 'Right']);

/**
 * Wrong/Actual/Right written on single lines arrive wrapped in a paragraph: unwrap them so each
 * part is its own box (and no block sits inside a `<p>`).
 */
function pitfallParts(pitfall: Node): Node[] {
  return kids(pitfall).flatMap((n) => {
    if (n.type !== 'paragraph') return [n];
    const inner = kids(n);
    if (!inner.some((c) => PITFALL_PARTS.has(str(c['name']) ?? ''))) return [n];
    return inner.filter((c) => !(c.type === 'text' && (str(c['value']) ?? '').trim() === ''));
  });
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

/**
 * Auto-generated from data (content MDX leaves these sections empty): the lesson's prerequisite
 * concepts with the learner's mastery (FR-CUR-02, content-and-exercises.md 선수 개념 확인). Until
 * the mastery arrives (or if it fails) the reviewed concepts are listed without it.
 */
function PrerequisitesSection() {
  const { concepts, prerequisites } = useLesson();
  if (prerequisites === undefined) {
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
  if (prerequisites.length === 0)
    return <p>이 단원은 따로 알아야 할 선수 개념 없이 시작할 수 있어요.</p>;
  return (
    <ul className="lesson-prereq-list" aria-label="선수 개념과 내 숙련도">
      {prerequisites.map((p) => (
        <li key={p.concept.id} className="lesson-prereq-list__item">
          <MasteryIcon stage={p.stage} decorative />
          <div>
            <Link
              to="/concepts/$conceptId"
              params={{ conceptId: p.concept.id }}
              className="lesson-link font-semibold"
            >
              {p.concept.title}
            </Link>{' '}
            <span className="lesson-prereq-list__stage">
              {STAGE_NAMES[p.stage]}
              {p.practiced ? ` · 숙련도 ${String(Math.round(p.effective))}` : ''}
              {p.strength === 'required' && p.weak ? ' · 먼저 확인하면 좋아요' : ''}
            </span>
            <p className="m-0">{p.concept.summary}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** "직접 풀어 보기": the way into practice mode (ui-ux.md 읽기 모드, 연습 시작). */
function PracticeSection() {
  const { lessonId, kind } = useLesson();
  return (
    <div className="lesson-practice-cta">
      <p className="m-0">
        {kind === 'assessment'
          ? '준비가 되면 단원 평가를 시작하세요. 시작 전에 규칙을 안내해요.'
          : kind === 'project'
            ? '요구 사항을 읽었으면 프로젝트를 만들어 볼까요? 마일스톤을 하나씩 통과하면 완성이에요.'
            : '본문을 다 읽었어요. 이제 직접 풀어볼까요?'}
      </p>
      <Link
        to="/learn/$lessonId"
        params={{ lessonId }}
        search={{ mode: 'practice' }}
        className="pi-button pi-button--primary pi-button--md no-underline"
      >
        <PencilLine size={16} aria-hidden="true" />
        {kind === 'assessment'
          ? '단원 평가 보기'
          : kind === 'project'
            ? '프로젝트 열기'
            : '연습 시작'}
      </Link>
    </div>
  );
}

function RunnableExample({ p }: { p: Record<string, unknown> }) {
  const { predictFirst, lessonId, exampleDrafts } = useLesson();
  const id = str(p['id']) ?? '';
  return (
    <RunnableExampleBlock
      id={id}
      lang={str(p['lang']) ?? 'js'}
      code={str(p['code']) ?? ''}
      predict={p['predict'] === true}
      allowSkip={predictFirst !== 'required'}
      // `editable` defaults to true (content-and-exercises.md MDX 컴포넌트).
      editable={p['editable'] !== false && id !== ''}
      lessonId={lessonId}
      serverDraft={exampleDrafts === undefined ? undefined : (exampleDrafts.get(id) ?? null)}
    />
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

/** Step view state (D-077); the reader owns it because the header shows it too. */
export interface LessonStepsView {
  list: readonly LessonStep[];
  current: number;
  /** "다음 단계": scrolls to step `index`, focuses it and makes it current. */
  onGoTo: (index: number) => void;
}

function nodesOf(nodes: readonly unknown[]) {
  return nodes.map((node, i) =>
    node && typeof node === 'object' ? <NodeView key={i} node={node as Node} /> : null,
  );
}

function stepState(i: number, current: number) {
  return i < current ? 'done' : i === current ? 'current' : 'upcoming';
}

/**
 * The lesson as step cards (D-077): a vertical progress line on the left, one white card per step
 * with its kind chip, and "다음 단계" at the end of every card but the last. Later steps look
 * quieter but are never locked.
 */
function LessonSteps({ steps }: { steps: LessonStepsView }) {
  const { list, current, onGoTo } = steps;
  return (
    <div className="lesson-steps">
      {list.map((step, i) => {
        const next = list[i + 1];
        return (
          <div
            key={step.id}
            id={step.id}
            role="group"
            aria-label={`${String(i + 1)}단계: ${step.label}`}
            tabIndex={-1}
            className="lesson-step"
            data-step={step.key}
            data-state={stepState(i, current)}
            {...(i === current ? { 'aria-current': 'step' as const } : {})}
          >
            <div className="lesson-step__marker" aria-hidden="true">
              {i < current ? <Check size={20} strokeWidth={3} /> : i + 1}
            </div>
            <div className="lesson-step__card">
              <p className="lesson-step__chip">
                <span className="sr-only">{`${String(i + 1)}단계: `}</span>
                {step.label}
              </p>
              <div className="lesson-prose">{nodesOf(step.nodes)}</div>
              {next && (
                <div className="lesson-step__footer">
                  <span className="lesson-step__hint">다음은 ‘{next.label}’ 단계예요.</span>
                  <Button
                    variant="primary"
                    aria-label={`다음 단계: ${next.label}`}
                    onClick={() => {
                      onGoTo(i + 1);
                    }}
                  >
                    다음 단계
                    <ArrowRight size={18} aria-hidden="true" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function LessonBody({
  lessonId,
  kind = 'lesson',
  body,
  concepts,
  predictFirst = 'recommended',
  prerequisites,
  exampleDrafts,
  steps,
}: {
  lessonId: string;
  kind?: LessonContextValue['kind'];
  body: readonly unknown[];
  concepts: readonly LessonConcept[];
  predictFirst?: LessonContextValue['predictFirst'];
  prerequisites?: readonly LessonPrerequisite[] | undefined;
  exampleDrafts?: ReadonlyMap<string, CodeDraft> | undefined;
  /** Step view; without it (or with no steps) the lesson is one plain card. */
  steps?: LessonStepsView | undefined;
}) {
  const value = {
    lessonId,
    kind,
    concepts: new Map(concepts.map((c) => [c.id, c])),
    predictFirst,
    prerequisites,
    exampleDrafts,
  };
  return (
    <LessonContext.Provider value={value}>
      {steps && steps.list.length > 0 ? (
        <LessonSteps steps={steps} />
      ) : (
        <div className="lesson-flat">
          <div className="lesson-prose">{nodesOf(body)}</div>
        </div>
      )}
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
