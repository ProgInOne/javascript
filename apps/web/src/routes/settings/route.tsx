import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/settings')({
  component: SettingsLayout,
});

const SECTIONS = [
  { to: '/settings/appearance', label: '화면' },
  { to: '/settings/data', label: '데이터' },
] as const;

/** Two-column settings layout (docs/design/ui-ux.md#설정). Sections arrive with their features. */
function SettingsLayout() {
  return (
    <div className="page settings">
      <nav className="settings__nav" aria-label="설정 섹션">
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.to}>
              <Link to={s.to} activeProps={{ 'aria-current': 'page' }}>
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="settings__content">
        <Outlet />
      </div>
    </div>
  );
}
