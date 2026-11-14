import { EmptyState, UiProvider } from '@proginone/ui';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import { AppError } from '../app/AppError.tsx';
import { AppHeader } from '../app/AppHeader.tsx';
import { RouteAnnouncer } from '../app/RouteAnnouncer.tsx';
import { ThemeSync } from '../app/ThemeSync.tsx';
import { sendHeartbeat } from '../api/queries.ts';
import { useActivityHeartbeat } from '../features/activity/useActivityHeartbeat.ts';
import { AiEventsSync } from '../features/ai/api.ts';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: (props) => (
    <Shell>
      <AppError {...props} />
    </Shell>
  ),
  notFoundComponent: () => (
    <EmptyState
      icon={Compass}
      headingLevel={1}
      title="찾는 화면이 없어요"
      description="주소가 바뀌었거나 아직 만들어지지 않은 화면이에요."
      action={<Link to="/">대시보드로 가기</Link>}
    />
  ),
});

function Shell({ children }: { children: React.ReactNode }) {
  // The learning screen has its own focused header (docs/design/ui-ux.md#학습-화면-공통-구조).
  const focused = useRouterState({ select: (s) => s.location.pathname.startsWith('/learn/') });
  return (
    <UiProvider>
      <a
        className="absolute -top-24 left-4 z-[calc(var(--z-header)+1)] rounded-md bg-surface px-4 py-2 text-fg shadow-2 focus:top-2"
        href="#main"
      >
        본문으로 건너뛰기
      </a>
      {!focused && <AppHeader />}
      <main id="main">{children}</main>
      <RouteAnnouncer />
    </UiProvider>
  );
}

function ActivityHeartbeat() {
  useActivityHeartbeat(sendHeartbeat);
  return null;
}

function RootLayout() {
  return (
    <Shell>
      <ThemeSync />
      <ActivityHeartbeat />
      <AiEventsSync />
      <Outlet />
    </Shell>
  );
}
