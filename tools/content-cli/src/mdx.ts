import type { Root, RootContent } from 'mdast';
import type { MdxJsxAttribute, MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx-jsx';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

// Lesson MDX → validated, serializable tree (docs/design/content-and-exercises.md#mdx-컴포넌트).
// Content never runs code: imports, exports and expressions are rejected; only the listed
// components with literal props are allowed. The web app renders the tree with React.

export const SECTION_KINDS = [
  'objectives',
  'prerequisites',
  'intro',
  'principle',
  'examples',
  'walkthrough',
  'pitfalls',
  'in-practice',
  'check',
  'practice',
  'summary',
  'next',
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

type PropType = 'string' | 'boolean' | 'string[]' | readonly string[];
interface ComponentSpec {
  props: Record<string, { type: PropType; required?: boolean }>;
  /** Children are taken as source code (RunnableExample). */
  codeChild?: boolean;
}

const s = { type: 'string' } as const;
const req = <T extends { type: PropType }>(p: T) => ({ ...p, required: true });

export const COMPONENTS: Record<string, ComponentSpec> = {
  Section: { props: { kind: req({ type: SECTION_KINDS }), title: s } },
  RunnableExample: {
    codeChild: true,
    props: {
      id: req(s),
      lang: req({ type: ['js', 'html', 'css', 'web'] }),
      predict: { type: 'boolean' },
      predictKind: { type: ['console', 'value', 'choice'] },
      editable: { type: 'boolean' },
      expectError: { type: 'boolean' },
      concepts: { type: 'string[]' },
      highlight: s,
      src: s,
    },
  },
  InlineExercise: { props: { ref: req(s) } },
  Callout: {
    props: { kind: req({ type: ['note', 'tip', 'warning', 'danger', 'deep-dive'] }), title: s },
  },
  CompareTable: { props: { columns: req({ type: 'string[]' }) } },
  Row: { props: { label: req(s) } },
  ConceptLink: { props: { to: req(s) } },
  Pitfall: { props: { misconception: req(s) } },
  Wrong: { props: {} },
  Actual: { props: {} },
  Right: { props: {} },
  ValueTrace: { props: { code: req(s), vars: req({ type: 'string[]' }) } },
  Diagram: { codeChild: true, props: { alt: req(s) } },
  Figure: { props: { src: req(s), alt: req(s), caption: s } },
  MdnLink: { props: { path: req(s) } },
  Reveal: { props: { title: req(s) } },
  Key: { props: {} },
};

export type PropValue = string | boolean | string[];

/** Serializable lesson node. Markdown nodes keep their mdast shape (minus positions). */
export type LessonNode =
  | { type: 'component'; name: string; props: Record<string, PropValue>; children: LessonNode[] }
  | { type: string; [key: string]: unknown };

export interface CompiledLesson {
  tree: LessonNode[];
  sections: { id: string; kind: SectionKind; title: string | null }[];
  text: string;
  refs: {
    exercises: string[];
    concepts: string[];
    misconceptions: string[];
    examples: string[];
  };
  errors: string[];
}

const where = (node: { position?: { start: { line: number } } | undefined }) =>
  node.position ? `${node.position.start.line}행: ` : '';

function readAttr(
  attr: MdxJsxAttribute,
  type: PropType,
): { ok: true; value: PropValue } | { ok: false; reason: string } {
  const v = attr.value;
  if (v === null || v === undefined) {
    return type === 'boolean'
      ? { ok: true, value: true }
      : { ok: false, reason: '값이 필요합니다' };
  }
  if (typeof v === 'string') {
    if (type === 'string') return { ok: true, value: v };
    if (Array.isArray(type)) {
      return type.includes(v)
        ? { ok: true, value: v }
        : { ok: false, reason: `${type.join(' | ')} 중 하나여야 합니다` };
    }
    return { ok: false, reason: `${String(type)} 값이어야 합니다` };
  }
  // {expression}: only JSON literals are allowed (no code).
  let parsed: unknown;
  try {
    parsed = JSON.parse(v.value);
  } catch {
    return {
      ok: false,
      reason: '속성 표현식은 JSON 리터럴(문자열 배열, true/false)만 쓸 수 있습니다',
    };
  }
  if (type === 'boolean' && typeof parsed === 'boolean') return { ok: true, value: parsed };
  if (type === 'string[]' && Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
    return { ok: true, value: parsed };
  }
  return { ok: false, reason: `${String(type)} 값이어야 합니다` };
}

/** Code inside a code-child component: a fenced block, or a template literal without `${`. */
function readCode(el: MdxJsxFlowElement | MdxJsxTextElement): string | null {
  const [child, ...rest] = el.children;
  if (!child || rest.length > 0) return null;
  if (child.type === 'code') return child.value;
  if (child.type === 'mdxFlowExpression' || child.type === 'mdxTextExpression') {
    const m = /^\s*`([\s\S]*)`\s*$/.exec(child.value);
    if (m?.[1] !== undefined && !m[1].includes('${')) return m[1].replace(/^\n/, '');
  }
  return null;
}

const textOf = (nodes: readonly RootContent[]): string =>
  nodes
    .map((n) => {
      if (
        'value' in n &&
        typeof n.value === 'string' &&
        n.type !== 'mdxFlowExpression' &&
        n.type !== 'mdxTextExpression'
      )
        return n.value;
      if ('children' in n) return textOf(n.children);
      return '';
    })
    .join(' ');

export function compileLessonMdx(
  source: string,
  options: { lessonKind?: 'lesson' | 'assessment' | 'project' } = {},
): CompiledLesson {
  const errors: string[] = [];
  const refs: CompiledLesson['refs'] = {
    exercises: [],
    concepts: [],
    misconceptions: [],
    examples: [],
  };
  const sections: CompiledLesson['sections'] = [];

  let root: Root;
  try {
    root = unified()
      .use(remarkParse)
      .use(remarkGfm)
      // Korean particles right after `**…**` would otherwise leave the emphasis unclosed.
      .use(remarkCjkFriendly)
      .use(remarkMdx)
      .parse(source);
  } catch (e) {
    return {
      tree: [],
      sections,
      text: '',
      refs,
      errors: [`MDX를 해석할 수 없습니다: ${(e as Error).message}`],
    };
  }

  const convert = (node: RootContent): LessonNode | null => {
    switch (node.type) {
      case 'mdxjsEsm':
        errors.push(`${where(node)}import/export는 쓸 수 없습니다`);
        return null;
      case 'mdxFlowExpression':
      case 'mdxTextExpression':
        errors.push(`${where(node)}표현식 {…}은 쓸 수 없습니다`);
        return null;
      case 'html':
        errors.push(`${where(node)}원시 HTML은 쓸 수 없습니다`);
        return null;
      case 'mdxJsxFlowElement':
      case 'mdxJsxTextElement':
        return convertJsx(node);
      default: {
        const { position: _position, ...rest } = node as RootContent & { children?: RootContent[] };
        if ('children' in rest && Array.isArray(rest.children)) {
          return {
            ...rest,
            children: rest.children.map(convert).filter((x): x is LessonNode => x !== null),
          };
        }
        return rest;
      }
    }
  };

  const convertJsx = (el: MdxJsxFlowElement | MdxJsxTextElement): LessonNode | null => {
    const name = el.name ?? '';
    const spec = COMPONENTS[name];
    if (!spec) {
      errors.push(`${where(el)}허용되지 않은 컴포넌트입니다: <${name || '>'}`);
      return null;
    }
    const props: Record<string, PropValue> = {};
    for (const attr of el.attributes) {
      if (attr.type !== 'mdxJsxAttribute') {
        errors.push(`${where(el)}<${name}>에 {...spread} 속성은 쓸 수 없습니다`);
        continue;
      }
      const propSpec = spec.props[attr.name];
      if (!propSpec) {
        errors.push(`${where(el)}<${name}>에 없는 속성입니다: ${attr.name}`);
        continue;
      }
      const r = readAttr(attr, propSpec.type);
      if (r.ok) props[attr.name] = r.value;
      else errors.push(`${where(el)}<${name} ${attr.name}>: ${r.reason}`);
    }
    for (const [prop, p] of Object.entries(spec.props)) {
      if (p.required && !(prop in props))
        errors.push(`${where(el)}<${name}>에 ${prop} 속성이 필요합니다`);
    }

    let children: LessonNode[] = [];
    if (spec.codeChild) {
      const code = readCode(el);
      if (code !== null) props['code'] = code;
      else if (!(name === 'RunnableExample' && typeof props['src'] === 'string')) {
        errors.push(
          `${where(el)}<${name}>의 내용은 코드 블록 하나(또는 \`템플릿 문자열\`)여야 합니다`,
        );
      }
    } else {
      children = (el.children as RootContent[])
        .map(convert)
        .filter((x): x is LessonNode => x !== null);
    }

    if (name === 'Section') {
      const kind = props['kind'] as SectionKind;
      const id =
        kind +
        (sections.some((x) => x.kind === kind)
          ? `-${sections.filter((x) => x.kind === kind).length + 1}`
          : '');
      sections.push({
        id,
        kind,
        title: typeof props['title'] === 'string' ? props['title'] : null,
      });
      props['id'] = id;
    }
    if (name === 'InlineExercise' && typeof props['ref'] === 'string')
      refs.exercises.push(props['ref']);
    if (name === 'ConceptLink' && typeof props['to'] === 'string') refs.concepts.push(props['to']);
    if (name === 'Pitfall' && typeof props['misconception'] === 'string')
      refs.misconceptions.push(props['misconception']);
    if (name === 'RunnableExample' && typeof props['id'] === 'string') {
      if (refs.examples.includes(props['id']))
        errors.push(`${where(el)}RunnableExample id가 중복됩니다: ${props['id']}`);
      refs.examples.push(props['id']);
      if (Array.isArray(props['concepts'])) refs.concepts.push(...props['concepts']);
    }
    return { type: 'component', name, props, children };
  };

  const tree = root.children.map(convert).filter((x): x is LessonNode => x !== null);

  // Section order rule: every required kind at least once, objectives first, next last.
  const required: readonly SectionKind[] =
    options.lessonKind && options.lessonKind !== 'lesson'
      ? ['objectives', 'practice', 'summary', 'next']
      : SECTION_KINDS;
  for (const kind of required) {
    if (!sections.some((x) => x.kind === kind))
      errors.push(`필수 섹션이 없습니다: <Section kind="${kind}">`);
  }
  if (sections.length > 0) {
    if (sections[0]?.kind !== 'objectives') errors.push('첫 섹션은 objectives여야 합니다');
    if (sections.at(-1)?.kind !== 'next') errors.push('마지막 섹션은 next여야 합니다');
  }

  return { tree, sections, text: textOf(root.children).replace(/\s+/g, ' ').trim(), refs, errors };
}
