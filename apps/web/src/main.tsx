import '@proginone/ui/fonts.css';
import '@proginone/ui/tokens.css';
import './app/tailwind.css';
import './app/shell.css';
import './app/lesson.css';
import './app/practice.css';
import './app/ai.css';
import './app/tutor.css';
import './app/learning.css';
import './app/dashboard.css';
import './app/review.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiRequestError } from './api/client.ts';
import { installGlobalErrorReporting } from './lib/client-errors.ts';
import { routeTree } from './routeTree.gen.ts';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry only what the server marks as retryable (network, maintenance).
      retry: (count, error) => error instanceof ApiRequestError && error.retryable && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

installGlobalErrorReporting();

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
