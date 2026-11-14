import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LessonBody } from './LessonBody.tsx';

const text = (value: string) => ({ type: 'text', value });
const p = (...children: unknown[]) => ({ type: 'paragraph', children });
const component = (name: string, props: Record<string, unknown>, ...children: unknown[]) => ({
  type: 'component',
  name,
  props,
  children,
});

function renderBody(body: unknown[]) {
  return render(
    <LessonBody
      lessonId="js-basics.start.first-program"
      body={body}
      concepts={[
        {
          id: 'js.basics.statement',
          title: '문장',
          summary: '실행 단위',
          importance: 'core',
          role: 'introduces',
        },
      ]}
    />,
  );
}

describe('LessonBody', () => {
  it('renders sections with default Korean headings and markdown', () => {
    renderBody([
      component(
        'Section',
        { kind: 'intro', id: 'intro' },
        p(text('값을 '), { type: 'strong', children: [text('출력')] }, text('해요. '), {
          type: 'inlineCode',
          value: 'console.log',
        }),
        {
          type: 'list',
          ordered: true,
          children: [{ type: 'listItem', children: [p(text('하나'))] }],
        },
      ),
    ]);
    const section = screen.getByRole('region', { name: '왜 필요할까요' });
    expect(within(section).getByText('출력').tagName).toBe('STRONG');
    expect(within(section).getByText('console.log').tagName).toBe('CODE');
    expect(within(section).getByRole('listitem')).toHaveTextContent('하나');
  });

  it('renders pitfalls, callouts, compare tables, and concept links', () => {
    renderBody([
      component(
        'Pitfall',
        { misconception: 'js.mc.x' },
        component('Wrong', {}, p(text('틀림'))),
        component('Right', {}, p(text('바름'))),
      ),
      component('Callout', { kind: 'tip', title: '팁' }, p(text('도움말'))),
      component(
        'CompareTable',
        { columns: ['let', 'const'] },
        p(component('Row', { label: '재할당' }, text('가능 | 불가'))),
      ),
      p(component('ConceptLink', { to: 'js.basics.statement' }, text('문장'))),
    ]);
    expect(screen.getByText('잘못된 생각')).toBeInTheDocument();
    expect(screen.getByText('도움말')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: '재할당' })).toBeInTheDocument();
    expect(screen.getAllByRole('cell').map((c) => c.textContent)).toEqual(['가능', '불가']);
    expect(screen.getByText('문장', { selector: 'span' })).toHaveAttribute('title', '실행 단위');
  });

  it('shows runnable examples as code', () => {
    renderBody([
      component('RunnableExample', {
        id: 'hello',
        lang: 'js',
        code: 'console.log(1);',
        predict: true,
      }),
    ]);
    expect(screen.getByText('console.log(1);')).toBeInTheDocument();
    expect(screen.getByText('실행 전에 결과를 예측해 보세요')).toBeInTheDocument();
  });

  it('treats the tree as untrusted: no unsafe links, unknown nodes, or raw HTML', () => {
    const { container } = renderBody([
      p({ type: 'link', url: 'javascript:alert(1)', children: [text('나쁜 링크')] }),
      p({ type: 'link', url: 'https://developer.mozilla.org/', children: [text('MDN')] }),
      { type: 'html', value: '<img src=x onerror=alert(1)>' },
      component('Script', { src: 'x' }),
      'not a node',
    ]);
    expect(screen.queryByRole('link', { name: '나쁜 링크' })).not.toBeInTheDocument();
    expect(screen.getByText('나쁜 링크')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /MDN/ })).toHaveAttribute('rel', 'noreferrer noopener');
    expect(container.querySelector('img, script')).toBeNull();
  });
});
