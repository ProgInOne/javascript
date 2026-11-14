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
