import { render, type RenderResult } from '@testing-library/react';
import { userEvent, type UserEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { UiProvider } from '../components/UiProvider.tsx';

/** Renders inside UiProvider (tooltips, toasts) and returns a user-event instance. */
export function renderUi(ui: ReactElement): RenderResult & { user: UserEvent } {
  const user = userEvent.setup();
  return { user, ...render(<UiProvider>{ui}</UiProvider>) };
}
