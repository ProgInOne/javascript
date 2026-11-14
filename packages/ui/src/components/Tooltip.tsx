import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

/** Mount once near the app root. 400ms open delay per ui-ux.md. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={400}>{children}</TooltipPrimitive.Provider>;
}

export interface TooltipProps {
  /** Tooltip text. Supplementary only: never the sole carrier of required information. */
  content: ReactNode;
  /** Shortcut hint shown after the text, e.g. `⌘J`. */
  shortcut?: string | undefined;
  side?: 'top' | 'right' | 'bottom' | 'left' | undefined;
  /** A single focusable element; the tooltip also opens on keyboard focus. */
  children: ReactElement;
}

/**
 * Hover/focus tooltip (Radix). Dismissible with Esc and hoverable (WCAG 1.4.13).
 * Requires a {@link TooltipProvider} ancestor.
 */
export function Tooltip({ content, shortcut, side = 'top', children }: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className="pi-tooltip" side={side} sideOffset={6}>
          {content}
          {shortcut && <kbd className="pi-tooltip__kbd">{shortcut}</kbd>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
