import { IconButton } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { dashboardQuery } from '../api/queries.ts';
import { Settings } from 'lucide-react';
import { LogoMark } from './Logo.tsx';

const navLink =
  'relative inline-flex items-center px-3 font-medium text-fg-secondary no-underline hover:text-fg ' +
  'aria-[current=page]:font-bold aria-[current=page]:text-heading ' +
  'aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-3 aria-[current=page]:after:-bottom-px ' +
  'aria-[current=page]:after:h-0.5 aria-[current=page]:after:rounded-full aria-[current=page]:after:bg-action';

/**
 * Global top navigation (docs/design/ui-ux.md#전역-내비게이션). Only destinations that exist in
 * this milestone are shown; 통계, goal ring and AI status arrive with their features.
 */
export function AppHeader() {
  const navigate = useNavigate();
  const due = useQuery(dashboardQuery).data?.reviewDueCount ?? 0;
  return (
    <header className="sticky top-0 z-header h-(--header-h) border-b border-line bg-surface/92 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-full max-w-[calc(var(--page-max)+2*var(--space-8))] items-center gap-8 px-5 lg:px-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-[17px] font-extrabold tracking-[-0.02em] text-heading no-underline"
          aria-label="ProgInOne 대시보드"
        >
          <LogoMark />
          <span>
            Prog<span className="text-brand">In</span>One
          </span>
        </Link>
        <nav className="flex h-full gap-1" aria-label="주 메뉴">
          <Link
            to="/"
            className={navLink}
            activeOptions={{ exact: true }}
            activeProps={{ 'aria-current': 'page' }}
          >
            대시보드
          </Link>
          <Link to="/courses" className={navLink} activeProps={{ 'aria-current': 'page' }}>
            과정
          </Link>
          <Link to="/review" className={navLink} activeProps={{ 'aria-current': 'page' }}>
            복습
            {due > 0 && (
              <span className="nav-badge">
                <span className="sr-only">: 오늘 </span>
                {due}
                <span className="sr-only">개 개념</span>
              </span>
            )}
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <IconButton
            label="설정"
            icon={<Settings size={20} />}
            variant="ghost"
            onClick={() => {
              void navigate({ to: '/settings/appearance' });
            }}
          />
        </div>
      </div>
    </header>
  );
}
