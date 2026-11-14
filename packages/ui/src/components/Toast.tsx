import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { Toast as ToastPrimitive } from 'radix-ui';
import { createContext, use, useCallback, useState, type ReactNode } from 'react';
import { IconButton } from './IconButton.tsx';

export type ToastVariant = 'info' | 'success' | 'error';

export interface ToastOptions {
  title: string;
  description?: string | undefined;
  variant?: ToastVariant | undefined;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const ToastContext = createContext<((toast: ToastOptions) => void) | null>(null);

const ICONS = { info: Info, success: CircleCheck, error: CircleAlert } as const;
/** Info/success hide after 5s; errors stay until dismissed (ui-ux.md "Toast"). */
const DURATION_MS = 5000;

let nextId = 1;

/**
 * Hosts toasts in the bottom-right viewport (Radix: announced politely, F8 focuses
 * the viewport, swipe or Esc dismisses). Not for learning feedback; use
 * FeedbackBanner. Requires a TooltipProvider ancestor (close button tooltip).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const show = useCallback((toast: ToastOptions) => {
    setToasts((current) => [...current, { ...toast, id: nextId++ }]);
  }, []);
  const remove = (id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  };

  return (
    <ToastPrimitive.Provider label="알림" swipeDirection="right">
      <ToastContext value={show}>{children}</ToastContext>
      {toasts.map(({ id, title, description, variant = 'info' }) => {
        const Icon = ICONS[variant];
        return (
          <ToastPrimitive.Root
            key={id}
            className={`pi-toast pi-toast--${variant}`}
            duration={variant === 'error' ? Infinity : DURATION_MS}
            type={variant === 'error' ? 'foreground' : 'background'}
            onOpenChange={(open) => {
              if (!open) remove(id);
            }}
          >
            <Icon className="pi-toast__icon" size={18} strokeWidth={1.75} aria-hidden="true" />
            <div className="pi-toast__text">
              <ToastPrimitive.Title className="pi-toast__title">{title}</ToastPrimitive.Title>
              {description && (
                <ToastPrimitive.Description className="pi-toast__description">
                  {description}
                </ToastPrimitive.Description>
              )}
            </div>
            <ToastPrimitive.Close asChild>
              <IconButton label="알림 닫기" icon={<X size={16} strokeWidth={1.75} />} />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport className="pi-toast__viewport" label="알림 ({hotkey})" />
    </ToastPrimitive.Provider>
  );
}

/**
 * Returns `toast(options)`.
 * @throws Error when used outside a ToastProvider.
 */
export function useToast(): (toast: ToastOptions) => void {
  const show = use(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return show;
}
