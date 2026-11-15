import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { pageClass, pageTitleClass } from '../../app/layout.ts';

const TABS = [
  { to: '/review', label: '오늘의 복습', exact: true },
  { to: '/review/mistakes', label: '오답 노트', exact: false },
  { to: '/review/weak', label: '약점 집중', exact: true },
  { to: '/review/progress', label: '숙련도 변화', exact: true },
] as const;

/**
 * 복습 허브 (ui-ux.md 복습 화면, 사이트맵 `/review`): the page title and the section links. The
 * sections are routes, so this is a navigation landmark with `aria-current`, not an ARIA tab list
 * (each section has its own address and history entry).
 */
export function ReviewHub({ children }: { children: ReactNode }) {
  return (
    <div className={pageClass}>
      <h1 className={pageTitleClass}>복습</h1>
      <nav aria-label="복습 화면" className="review-tabs">
        <ul>
          {TABS.map((tab) => (
            <li key={tab.to}>
              <Link
                to={tab.to}
                activeOptions={{ exact: tab.exact, includeSearch: false }}
                activeProps={{ 'aria-current': 'page' }}
                className="review-tabs__link"
              >
                {tab.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </div>
  );
}
