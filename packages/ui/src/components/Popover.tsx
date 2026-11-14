import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { defined } from './cx.ts';

export interface PopoverProps {
  /** Accessible name of the popover content (it is a non-modal dialog). */
  label: string;
  /** A single button that toggles the popover; focus returns here on close. */
  trigger: ReactElement;
  children: ReactNode;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  side?: 'top' | 'right' | 'bottom' | 'left' | undefined;
  align?: 'start' | 'center' | 'end' | undefined;
}

/**
 * Click-to-open panel next to its trigger (Radix Popover, elevation-2, ui-ux.md 기본 컴포넌트).
 * Esc and outside clicks close it; focus moves in on open and back to the trigger on close.
 */
export function Popover({
  label,
  trigger,
  children,
  open,
  onOpenChange,
  side = 'bottom',
  align = 'end',
}: PopoverProps) {
  return (
    <PopoverPrimitive.Root {...defined({ open, onOpenChange })}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="pi-popover"
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={16}
          aria-label={label}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
