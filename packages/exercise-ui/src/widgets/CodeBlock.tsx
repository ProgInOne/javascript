import { useId } from 'react';

export const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  js: 'JavaScript',
  html: 'HTML',
  css: 'CSS',
  web: 'HTML·CSS·JS',
};

export interface CodeBlockProps {
  code: string;
  /** Language key (`js`, `html`, `css`, `web`) shown as a label. */
  language?: string;
  /** Show line numbers (default true). They are part of the text so screen readers read them. */
  lineNumbers?: boolean;
  /** 1-based lines to highlight (e.g. the error line), marked with an icon-free text suffix too. */
  highlightLines?: readonly number[];
}

/**
 * Read-only code (CodeBlock in ui-ux.md). The region is keyboard-scrollable for long lines.
 */
export function CodeBlock({
  code,
  language,
  lineNumbers = true,
  highlightLines = [],
}: CodeBlockProps) {
  const labelId = useId();
  const lines = code.replace(/\n$/, '').split('\n');
  const label = language ? (LANGUAGE_LABELS[language] ?? language) : '코드';
  return (
    <figure className="pi-ex-codeblock" aria-labelledby={labelId}>
      <figcaption id={labelId} className="pi-ex-codeblock__label">
        {label}
      </figcaption>
      {/* Focusable so keyboard users can scroll wide code (axe scrollable-region-focusable). */}
      <pre className="pi-ex-code pi-ex-codeblock__pre" tabIndex={0}>
        <code>
          {lines.map((line, index) => {
            const number = index + 1;
            const marked = highlightLines.includes(number);
            return (
              // Lines of a static snippet never reorder.
              <span key={index} className="pi-ex-codeblock__line" data-marked={marked || undefined}>
                {lineNumbers && <span className="pi-ex-codeblock__number">{number}</span>}
                {line}
                {marked && <span className="sr-only"> (표시된 줄)</span>}
                {'\n'}
              </span>
            );
          })}
        </code>
      </pre>
    </figure>
  );
}
