import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Tooltip } from './Tooltip.tsx';
import { cx } from './cx.ts';

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'aria-label'> {
  /** Required accessible name, also shown as the tooltip (WCAG 1.1.1). */
  label: string;
  /** Lucide icon element, rendered decorative. */
  icon: ReactNode;
  /** Shortcut shown in the tooltip, e.g. `⌘J`. */
  shortcut?: string | undefined;
  variant?: 'ghost' | 'subtle';
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left' | undefined;
}

/**
 * 32×32 icon-only button. Always has an `aria-label` and a tooltip; requires a
 * TooltipProvider ancestor.
 */
export function IconButton({
  label,
  icon,
  shortcut,
  variant = 'ghost',
  tooltipSide,
  type = 'button',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      <button
        {...rest}
        type={type}
        aria-label={label}
        className={cx('pi-icon-button', `pi-icon-button--${variant}`, className)}
      >
        <span className="pi-icon-button__icon" aria-hidden="true">
          {icon}
        </span>
      </button>
    </Tooltip>
  );
}
