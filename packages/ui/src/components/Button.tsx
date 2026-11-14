import type { ComponentPropsWithRef, MouseEvent, ReactNode } from 'react';
import { Spinner } from './Spinner.tsx';
import { cx } from './cx.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  /** Default `secondary`: a screen should have a single `primary` action. */
  variant?: ButtonVariant;
  /** 32 / 36 / 44px tall. */
  size?: ButtonSize;
  /** Leading icon (16px Lucide icon). Replaced by the spinner while loading. */
  icon?: ReactNode;
  /**
   * Busy state: keeps the label and focus, shows a spinner, sets `aria-busy`, and
   * ignores clicks. Uses `aria-disabled` instead of `disabled` so focus is not lost.
   */
  loading?: boolean;
}

/**
 * Text button. Variants and sizes follow docs/design/ui-ux.md "기본 컴포넌트".
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  type = 'button',
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      {...rest}
      type={type}
      className={cx('pi-button', `pi-button--${variant}`, `pi-button--${size}`, className)}
      aria-busy={loading || undefined}
      aria-disabled={loading ? true : rest['aria-disabled']}
      data-loading={loading || undefined}
      onClick={handleClick}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}
