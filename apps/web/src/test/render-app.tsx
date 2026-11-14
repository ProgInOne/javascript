import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { routeTree } from '../routeTree.gen.ts';

type Handler = (method: string, path: string, body: unknown) => { status?: number; body: unknown };

/**
 * Renders the real route tree at `path` against a fake API. `handler` receives every
 * /api/v1 request; return `{ status, body }`.
 */
export function renderApp(path: string, handler: Handler) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const apiPath = input.replace(/^\/api\/v1/, '');
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: apiPath, body });
      const res = handler(method, apiPath, body);
      return Promise.resolve(
        new Response(JSON.stringify(res.body), {
          status: res.status ?? 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, calls };
}
