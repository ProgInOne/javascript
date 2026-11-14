import { CircleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './cx.ts';

/** 1 only when the state replaces the whole page (it is the page heading). */
type HeadingLevel = 1 | 2 | 3 | 4;

export interface EmptyStateProps {
  /** Large line icon (no illustrations). */
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  /** One action, usually a Button. */
  action?: ReactNode;
  headingLevel?: HeadingLevel | undefined;
  className?: string | undefined;
}

/** Empty state: icon + title + description + a single action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  headingLevel = 2,
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section className={cx('pi-state', className)}>
      <Icon className="pi-state__icon" size={40} strokeWidth={1.5} aria-hidden="true" />
      <Heading className="pi-state__title">{title}</Heading>
      {description && <p className="pi-state__description">{description}</p>}
      {action && <div className="pi-state__action">{action}</div>}
    </section>
  );
}

export interface ErrorStateProps {
  /** What went wrong, in the learner's words. */
  title: ReactNode;
  /** What the learner can do about it. */
  description?: ReactNode;
  /** Recovery action, e.g. a retry Button. */
  action?: ReactNode;
  /** Error code from the API error model, shown small for support/debugging. */
  code?: string | undefined;
  /**
   * `inline` sits inside a form or card and is announced (`role="alert"`);
   * `panel` replaces a panel's content; `page` replaces the whole page.
   */
  variant?: 'inline' | 'panel' | 'page' | undefined;
  headingLevel?: HeadingLevel | undefined;
  className?: string | undefined;
}

/** Error state: cause + what to do + small error code. */
export function ErrorState({
  title,
  description,
  action,
  code,
  variant = 'panel',
  headingLevel = 2,
  className,
}: ErrorStateProps) {
  const Heading = variant === 'inline' ? 'p' : (`h${headingLevel}` as const);
  return (
    <section
      className={cx('pi-state', 'pi-error-state', `pi-error-state--${variant}`, className)}
      role={variant === 'inline' ? 'alert' : undefined}
    >
      <CircleAlert
        className="pi-state__icon"
        size={variant === 'inline' ? 18 : 40}
        strokeWidth={variant === 'inline' ? 1.75 : 1.5}
        aria-hidden="true"
      />
      <Heading className="pi-state__title">{title}</Heading>
      {description && <p className="pi-state__description">{description}</p>}
      {action && <div className="pi-state__action">{action}</div>}
      {code && (
        <p className="pi-state__code">
          오류 코드 <code>{code}</code>
        </p>
      )}
    </section>
  );
}
