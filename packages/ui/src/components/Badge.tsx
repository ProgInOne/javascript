import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx.ts';

export type BadgeVariant = 'neutral' | 'brand' | 'success' | 'error' | 'warning' | 'ai';

export interface BadgeProps extends ComponentPropsWithRef<'span'> {
  variant?: BadgeVariant;
  /** Leading 14px icon. Status badges should pair color with an icon or text. */
  icon?: ReactNode;
}

/** 20px label chip, `--text-small`. */
export function Badge({ variant = 'neutral', icon, className, children, ...rest }: BadgeProps) {
  return (
    <span {...rest} className={cx('pi-badge', `pi-badge--${variant}`, className)}>
      {icon && <span aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}
