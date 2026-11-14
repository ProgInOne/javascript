import { createFileRoute, redirect } from '@tanstack/react-router';
import { learnerQuery } from '../api/queries.ts';
import { pageClass } from '../app/layout.ts';
import { Dashboard } from '../features/dashboard/Dashboard.tsx';

export const Route = createFileRoute('/')({
  // First run: the onboarding comes first (ui-ux.md#온보딩과-목표-설정). If the profile cannot be
  // loaded the dashboard opens anyway and shows its own error state.
  beforeLoad: async ({ context }) => {
    const learner = await context.queryClient
      .query({ ...learnerQuery, staleTime: 'static' })
      .catch(() => null);
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's redirect API
    if (learner?.needsOnboarding) throw redirect({ to: '/onboarding' });
  },
  component: DashboardPage,
});

/** 대시보드 (ui-ux.md 대시보드, FR-DASH-01). */
function DashboardPage() {
  return (
    <div className={pageClass}>
      <Dashboard />
    </div>
  );
}
