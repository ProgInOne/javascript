import { useEffect, useState, type CSSProperties } from 'react';
import { cx } from './cx.ts';

export interface SkeletonProps {
  variant?: 'text' | 'block' | 'card' | undefined;
  /** Size of the final content, to avoid layout shift. */
  width?: CSSProperties['width'] | undefined;
  height?: CSSProperties['height'] | undefined;
  /** Text lines for `variant="text"`. */
  lines?: number | undefined;
  /**
   * Becomes visible only after this delay (ms) so fast loads don't flash. The space
   * is reserved from the start.
   */
  delay?: number | undefined;
  className?: string | undefined;
}

/**
 * Loading placeholder, hidden from assistive tech. Mark the loading region with
 * `aria-busy="true"` and announce completion there.
 */
export function Skeleton({
  variant = 'text',
  width,
  height,
  lines = 1,
  delay = 300,
  className,
}: SkeletonProps) {
  const [visible, setVisible] = useState(delay <= 0);
  useEffect(() => {
    if (delay <= 0) return;
    const timer = setTimeout(() => {
      setVisible(true);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [delay]);

  const common = {
    'aria-hidden': true,
    'data-visible': visible,
    className: cx('pi-skeleton', `pi-skeleton--${variant}`, className),
  } as const;

  if (variant === 'text') {
    return (
      <span {...common} style={{ width }}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="pi-skeleton__line" />
        ))}
      </span>
    );
  }
  return <span {...common} style={{ width, height }} />;
}
