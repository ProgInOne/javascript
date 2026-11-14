import { EmptyState } from '@proginone/ui';
import { createFileRoute, Link } from '@tanstack/react-router';
import { BookOpen } from 'lucide-react';
import { pageClass, pageTitleClass } from '../app/layout.ts';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

/** Placeholder until the dashboard lands with the v0.1 content (M4). */
function Dashboard() {
  return (
    <div className={pageClass}>
      <h1 className={pageTitleClass}>대시보드</h1>
      <EmptyState
        icon={BookOpen}
        title="학습을 시작해 볼까요?"
        description="과정을 고르고 첫 단원부터 읽어 보세요."
        action={
          <Link to="/courses" className="pi-button pi-button--primary pi-button--md no-underline">
            과정 보기
          </Link>
        }
      />
    </div>
  );
}
