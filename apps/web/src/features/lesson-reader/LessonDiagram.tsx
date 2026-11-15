import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { readDiagramTheme, renderDiagram } from './diagram.ts';

/**
 * Lesson `<Diagram alt caption>` (content-and-exercises.md#mdx-컴포넌트, D-050).
 *
 * - The drawing is `role="img"` named by `alt`; the Mermaid source stays available as a
 *   collapsible text alternative.
 * - Mermaid loads on first use; while it loads the box shows a short status line.
 * - A source that fails to render falls back to a notice, the description and the source.
 * - Theme changes (light/dark, OS preference) redraw the diagram from the current tokens.
 */

/** The OS dark preference (absent in some test environments). */
const darkQuery = (): MediaQueryList | null =>
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

/** Changes whenever the effective color scheme may have changed. */
function subscribeScheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-workbench'],
  });
  const media = darkQuery();
  media?.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener('change', onChange);
  };
}
const schemeSnapshot = () =>
  `${document.documentElement.dataset['theme'] ?? ''}|${darkQuery()?.matches ? 'dark' : 'light'}`;

type State = 'loading' | 'ready' | 'error';

export function LessonDiagram({
  source,
  alt,
  caption,
}: {
  source: string;
  alt: string;
  caption?: string | undefined;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>('loading');
  const scheme = useSyncExternalStore(subscribeScheme, schemeSnapshot, () => '');

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    // A redraw keeps the previous drawing until the new one is ready.
    renderDiagram(source, readDiagramTheme(el)).then(
      (svg) => {
        if (cancelled) return;
        svg.setAttribute('aria-hidden', 'true');
        svg.removeAttribute('role');
        // Mermaid caps the width at the natural size and otherwise fits the box. Do not shrink a
        // wide diagram below 60% of that size: past it, the box scrolls sideways instead.
        const natural = Number.parseFloat(svg.style.maxWidth);
        if (natural > 0)
          svg.style.minWidth = `min(${natural}px, max(100%, ${Math.round(natural * 0.6)}px))`;
        el.replaceChildren(svg);
        setState('ready');
      },
      () => {
        if (cancelled) return;
        el.replaceChildren();
        setState('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, scheme]);

  return (
    <figure className="lesson-diagram">
      {state === 'error' && (
        <div className="lesson-diagram__error" role="note">
          <AlertTriangle aria-hidden="true" size={18} />
          <div>
            <p className="lesson-diagram__error-title">다이어그램을 그리지 못했어요.</p>
            <p>{alt}</p>
            <p className="lesson-diagram__error-hint">아래 소스에서 내용을 확인할 수 있어요.</p>
          </div>
        </div>
      )}
      <div
        className="lesson-diagram__canvas"
        role="img"
        aria-label={alt}
        aria-busy={state === 'loading'}
        hidden={state === 'error'}
      >
        {state === 'loading' && (
          <span className="lesson-diagram__loading" aria-hidden="true">
            다이어그램을 그리는 중…
          </span>
        )}
        {/* Mermaid's SVG goes here; React renders no children into this element. */}
        <div ref={host} className="lesson-diagram__svg" />
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
      <details className="lesson-diagram__source" open={state === 'error' ? true : undefined}>
        <summary>다이어그램 소스 보기 (텍스트)</summary>
        <pre className="lesson-code">
          <code>{source}</code>
        </pre>
      </details>
    </figure>
  );
}
