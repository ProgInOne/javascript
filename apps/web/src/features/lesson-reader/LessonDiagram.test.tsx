import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LessonDiagram } from './LessonDiagram.tsx';

const renderDiagram = vi.fn<(source: string) => Promise<SVGSVGElement>>();
vi.mock('./diagram.ts', () => ({
  readDiagramTheme: () => ({ dark: false, fontFamily: 'sans-serif', variables: {} }),
  renderDiagram: (source: string) => renderDiagram(source),
}));

const SOURCE = 'flowchart TD\n  A[시작] --> B[끝]';
const svg = () => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('role', 'graphics-document document');
  el.setAttribute('data-testid', 'mermaid-svg');
  return el;
};

describe('LessonDiagram', () => {
  beforeEach(() => {
    renderDiagram.mockReset();
  });
  afterEach(() => {
    delete document.documentElement.dataset['theme'];
  });

  it('shows a status line while loading, then the drawing named by alt', async () => {
    let resolve!: (el: SVGSVGElement) => void;
    renderDiagram.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<LessonDiagram source={SOURCE} alt="시작에서 끝으로 가는 흐름" caption="그림 1" />);

    const img = screen.getByRole('img', { name: '시작에서 끝으로 가는 흐름' });
    expect(img).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('다이어그램을 그리는 중…')).toBeInTheDocument();
    expect(renderDiagram).toHaveBeenCalledWith(SOURCE);

    await act(async () => {
      resolve(svg());
      await Promise.resolve();
    });
    expect(img).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByText('다이어그램을 그리는 중…')).not.toBeInTheDocument();
    const drawn = screen.getByTestId('mermaid-svg');
    expect(img).toContainElement(drawn);
    // The figure's role="img" names the drawing; Mermaid's own document role is dropped.
    expect(drawn).toHaveAttribute('aria-hidden', 'true');
    expect(drawn).not.toHaveAttribute('role');
    expect(screen.getByText('그림 1').tagName).toBe('FIGCAPTION');
  });

  it('keeps the source as a collapsible text alternative', async () => {
    renderDiagram.mockResolvedValue(svg());
    render(<LessonDiagram source={SOURCE} alt="흐름" />);
    await screen.findByTestId('mermaid-svg');
    const details = screen.getByText('다이어그램 소스 보기 (텍스트)').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(details?.querySelector('code')?.textContent).toBe(SOURCE);
  });

  it('falls back to a notice, the description and the open source on a render error', async () => {
    renderDiagram.mockRejectedValue(new Error('Parse error on line 2'));
    render(<LessonDiagram source={'flowchart TD\n  A -->'} alt="깨진 흐름" />);

    expect(await screen.findByRole('note')).toHaveTextContent('다이어그램을 그리지 못했어요.');
    expect(screen.getByRole('note')).toHaveTextContent('깨진 흐름');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const details = screen.getByText('다이어그램 소스 보기 (텍스트)').closest('details');
    expect(details).toHaveAttribute('open');
    expect(details?.querySelector('code')?.textContent).toBe('flowchart TD\n  A -->');
  });

  it('redraws when the theme changes', async () => {
    renderDiagram.mockResolvedValue(svg());
    render(<LessonDiagram source={SOURCE} alt="흐름" />);
    await screen.findByTestId('mermaid-svg');
    expect(renderDiagram).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.documentElement.dataset['theme'] = 'dark';
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(renderDiagram).toHaveBeenCalledTimes(2);
    });
  });
});
