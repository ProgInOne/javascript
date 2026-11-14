import { IconButton } from '@proginone/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { Settings } from 'lucide-react';
import { LogoMark } from './Logo.tsx';

/**
 * Global top navigation (docs/design/ui-ux.md#전역-내비게이션). Only destinations that exist in
 * this milestone are shown; 과정·복습·통계, goal ring and AI status arrive with their features.
 */
export function AppHeader() {
  const navigate = useNavigate();
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <Link to="/" className="app-brand" aria-label="ProgInOne 대시보드">
          <LogoMark />
          <span>
            Prog<span className="app-brand__in">In</span>One
          </span>
        </Link>
        <nav className="app-nav" aria-label="주 메뉴">
          <Link to="/" activeOptions={{ exact: true }} activeProps={{ 'aria-current': 'page' }}>
            대시보드
          </Link>
        </nav>
        <div className="app-header__tools">
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
