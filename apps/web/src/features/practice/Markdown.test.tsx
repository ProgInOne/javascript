import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { completeParagraphsEnd, speakable } from '../tutor/announce.ts';
import { Markdown } from './Markdown.tsx';

describe('Markdown (AI variant)', () => {
  it('never interprets raw HTML', () => {
    const { container } = render(
      <Markdown text={'<img src=x onerror="alert(1)"> <script>alert(2)</script>'} variant="ai" />,
    );
    expect(container.querySelector('img, script')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror="alert(1)">');
  });

  it('links only http(s) URLs, in a new tab, and never loads images', () => {
    const { container } = render(
      <Markdown
        text={
          '[MDN](https://developer.mozilla.org) [나쁜 링크](javascript:alert(1)) ![추적](https://t.example/p.gif)'
        }
        variant="ai"
      />,
    );
    const link = screen.getByRole('link', { name: /MDN/ });
    expect(link).toHaveAttribute('href', 'https://developer.mozilla.org/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('link', { name: /나쁜 링크/ })).toBeNull();
    expect(container).toHaveTextContent('[나쁜 링크](javascript:alert(1))');
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('[이미지: 추적]');
  });

  it('renders emphasis, quotes and headings without changing the page outline', () => {
    const { container } = render(
      <Markdown text={'## 정리\n\n**굵게**와 *기울임*, `a * b`\n\n> 인용'} variant="ai" />,
    );
    expect(container.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    expect(screen.getByText('정리').tagName).toBe('STRONG');
    expect(screen.getByText('굵게').tagName).toBe('STRONG');
    expect(screen.getByText('기울임').tagName).toBe('EM');
    expect(screen.getByText('a * b').tagName).toBe('CODE');
    expect(container.querySelector('blockquote')).toHaveTextContent('인용');
  });

  it('renders an unfinished code fence while streaming and offers copy', () => {
    render(<Markdown text={'예시:\n\n```js title\nconst a = 1;'} variant="ai" />);
    expect(screen.getByText('const a = 1;')).toBeVisible();
    expect(screen.getByRole('button', { name: '복사' })).toBeVisible();
  });

  it('keeps the authored content variant as before', () => {
    const { container } = render(<Markdown text={'## 제목 [x](https://a.b) *별*'} />);
    expect(container.querySelector('a, em')).toBeNull();
    expect(container).toHaveTextContent('## 제목 [x](https://a.b) *별*');
  });
});

describe('Markdown tables', () => {
  const cellTexts = (row: Element) =>
    [...row.querySelectorAll('th, td')].map((cell) => cell.textContent);

  it('renders a pipe table with column headers in a scrollable wrapper', () => {
    const { container } = render(
      <Markdown
        text={'값이 네 개면:\n\n| 방향 | 값 |\n|---|---|\n| 위 | 5px |\n| 왼쪽 | 20px |\n\n끝'}
      />,
    );
    const table = screen.getByRole('table');
    expect(table.parentElement).toHaveClass('lesson-table-wrap');
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((th) => th.textContent)).toEqual(['방향', '값']);
    for (const th of headers) expect(th).toHaveAttribute('scope', 'col');
    const rows = table.querySelectorAll('tbody tr');
    expect([...rows].map(cellTexts)).toEqual([
      ['위', '5px'],
      ['왼쪽', '20px'],
    ]);
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });

  it('handles alignment, inline formatting, escaped pipes and ragged rows', () => {
    const text = [
      '식 | 결과 | 이유',
      ':-- | :-: | --:',
      '`0 \\|\\| 3000` | **`3000`** | 0은 falsy',
      '`a` | b',
      '| 1 | 2 | 3 | 4 |',
    ].join('\n');
    const { container } = render(<Markdown text={text} />);
    const rows = [...container.querySelectorAll('tbody tr')];
    const head = screen.getAllByRole('columnheader');
    expect(head.map((th) => th.textContent)).toEqual(['식', '결과', '이유']);
    expect(head.map((th) => th.getAttribute('data-align'))).toEqual(['left', 'center', 'right']);
    expect(rows.map(cellTexts)).toEqual([
      ['0 || 3000', '3000', '0은 falsy'],
      ['a', 'b', ''],
      ['1', '2', '3'],
    ]);
    expect(screen.getByText('0 || 3000').tagName).toBe('CODE');
    expect(screen.getByText('3000').closest('strong')).not.toBeNull();
  });

  it('keeps an incomplete table as text while it streams in', () => {
    for (const text of ['| a | b |', '| a | b |\n', '| a | b |\n|--']) {
      const { container, unmount } = render(<Markdown text={text} variant="ai" />);
      expect(container.querySelector('table')).toBeNull();
      expect(container).toHaveTextContent('| a | b |');
      unmount();
    }
    // A delimiter row with a different column count is not a table.
    const { container, rerender } = render(<Markdown text={'| a | b |\n|---|\n| 1 | 2 |'} />);
    expect(container.querySelector('table')).toBeNull();
    // Once the delimiter row matches the header, the rows follow as they arrive.
    rerender(<Markdown text={'| a | b |\n|---|---|\n| 1'} />);
    expect([...container.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['1', '']);
  });

  it('keeps AI tables free of raw HTML and headings', () => {
    const { container } = render(
      <Markdown
        text={
          '## 비교\n| <b>식</b> | [링크](javascript:alert(1)) |\n|---|---|\n| ## 아님 | *기울임* |'
        }
        variant="ai"
      />,
    );
    expect(container.querySelector('h1, h2, h3, h4, h5, h6, b, a')).toBeNull();
    expect(screen.getByRole('columnheader', { name: '<b>식</b>' })).toBeVisible();
    expect(screen.getByText('기울임').tagName).toBe('EM');
    expect(screen.getByRole('cell', { name: '## 아님' })).toBeVisible();
  });
});

describe('announcements', () => {
  it('finds complete paragraphs outside code fences', () => {
    expect(completeParagraphsEnd('첫 문단')).toBe(0);
    expect(completeParagraphsEnd('첫 문단\n\n둘')).toBe('첫 문단\n\n'.length);
    expect(completeParagraphsEnd('```js\na\n\nb')).toBe(0);
  });
  it('reads markdown as plain sentences', () => {
    expect(speakable('**굵게** `3 * 2`와 [링크](https://a.b)\n\n```js\ncode\n```')).toBe(
      '굵게 3 * 2와 링크 (코드 예시)',
    );
  });
});
