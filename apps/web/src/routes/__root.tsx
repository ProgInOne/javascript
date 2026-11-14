import { EmptyState, UiProvider } from '@proginone/ui';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import { AppError } from '../app/AppError.tsx';
import { AppHeader } from '../app/AppHeader.tsx';
import { RouteAnnouncer } from '../app/RouteAnnouncer.tsx';
import { ThemeSync } from '../app/ThemeSync.tsx';

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
  return (
    <UiProvider>
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <AppHeader />
      <main id="main" className="app-main">
        {children}
      </main>
      <RouteAnnouncer />
    </UiProvider>
  );
}

function RootLayout() {
  return (
    <Shell>
      <ThemeSync />
      <Outlet />
    </Shell>
  );
}
