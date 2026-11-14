import type { ReactNode } from 'react';
import { ToastProvider } from './Toast.tsx';
import { TooltipProvider } from './Tooltip.tsx';

/** Mount once at the app root: tooltip timing and the toast viewport. */
export function UiProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <ToastProvider>{children}</ToastProvider>
    </TooltipProvider>
  );
}
