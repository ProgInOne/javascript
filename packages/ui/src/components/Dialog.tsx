import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { IconButton } from './IconButton.tsx';
import { cx, defined } from './cx.ts';

interface OverlayBaseProps {
  title: ReactNode;
  description?: ReactNode | undefined;
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** Element that opens it; focus returns here on close. */
  trigger?: ReactElement | undefined;
  children?: ReactNode;
  /** Label of the close button. */
  closeLabel?: string | undefined;
}

export interface DialogProps extends OverlayBaseProps {
  /** Action row, e.g. cancel + confirm buttons. */
  footer?: ReactNode;
}

function Header({ title, description, closeLabel }: OverlayBaseProps) {
  return (
    <header className="pi-overlay__header">
      <div className="pi-overlay__heading">
        <DialogPrimitive.Title className="pi-overlay__title">{title}</DialogPrimitive.Title>
        {description && (
          <DialogPrimitive.Description className="pi-overlay__description">
            {description}
          </DialogPrimitive.Description>
        )}
      </div>
      <DialogPrimitive.Close asChild>
        <IconButton label={closeLabel ?? '닫기'} icon={<X size={18} strokeWidth={1.75} />} />
      </DialogPrimitive.Close>
    </header>
  );
}

/**
 * Modal dialog (Radix): focus trap, Esc closes, focus returns to the trigger.
 * Requires a TooltipProvider ancestor (close button tooltip).
 */
export function Dialog({ open, defaultOpen, onOpenChange, trigger, footer, ...rest }: DialogProps) {
  return (
    <DialogPrimitive.Root {...defined({ open, defaultOpen, onOpenChange })}>
      {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="pi-dialog__overlay" />
        <DialogPrimitive.Content
          className="pi-overlay pi-dialog"
          {...(rest.description ? {} : { 'aria-describedby': undefined })}
        >
          <Header {...rest} />
          <div className="pi-overlay__body">{rest.children}</div>
          {footer && <footer className="pi-overlay__footer">{footer}</footer>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export type DrawerProps = OverlayBaseProps & { className?: string | undefined };

/**
 * Right-side, non-modal drawer (tutor drawer). The page behind stays usable: no focus
 * trap and outside clicks don't close it. Esc closes; focus moves in on open and
 * back to the trigger on close.
 */
export function Drawer({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  className,
  ...rest
}: DrawerProps) {
  return (
    <DialogPrimitive.Root modal={false} {...defined({ open, defaultOpen, onOpenChange })}>
      {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className={cx('pi-overlay pi-drawer', className)}
          onInteractOutside={(event) => {
            event.preventDefault();
          }}
          {...(rest.description ? {} : { 'aria-describedby': undefined })}
        >
          <Header {...rest} />
          <div className="pi-overlay__body">{rest.children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
