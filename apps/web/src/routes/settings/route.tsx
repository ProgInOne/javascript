import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { pageClass } from '../../app/layout.ts';

export const Route = createFileRoute('/settings')({
  component: SettingsLayout,
});

const SECTIONS = [
  { to: '/settings/goals', label: '학습 목표' },
  { to: '/settings/learning', label: '학습 방식' },
  { to: '/settings/ai', label: 'AI' },
  { to: '/settings/appearance', label: '화면' },
  { to: '/settings/data', label: '데이터' },
] as const;

/** Two-column settings layout (docs/design/ui-ux.md#설정). Sections arrive with their features. */
function SettingsLayout() {
  return (
    <div className={`${pageClass} grid items-start gap-8 md:grid-cols-[200px_minmax(0,1fr)]`}>
      <nav aria-label="설정 섹션">
        <ul className="m-0 flex list-none flex-wrap gap-1 p-0 md:grid">
          {SECTIONS.map((s) => (
            <li key={s.to}>
              <Link
                to={s.to}
                activeProps={{ 'aria-current': 'page' }}
                className="block rounded-md px-3 py-2 font-medium text-fg-secondary no-underline hover:bg-hover hover:text-fg aria-[current=page]:bg-selected aria-[current=page]:font-bold aria-[current=page]:text-heading"
              >
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div>
        <Outlet />
      </div>
    </div>
  );
}
