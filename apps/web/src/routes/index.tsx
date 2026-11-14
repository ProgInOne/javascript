import { EmptyState } from '@proginone/ui';
import { createFileRoute } from '@tanstack/react-router';
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
        title="첫 단원을 준비하고 있어요"
        description="v0.1 시범판에서 CSS 박스 모델과 JavaScript 첫 단원이 열려요."
      />
    </div>
  );
}
