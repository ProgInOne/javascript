import { IconButton } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Menu, Settings, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { dashboardQuery } from '../api/queries.ts';
import { AIStatusIndicator } from '../features/ai/AIStatusIndicator.tsx';
import { HeaderGoal } from '../features/goals/HeaderGoal.tsx';
import { LogoMark } from './Logo.tsx';

const navLink =
  'relative inline-flex items-center px-3 font-medium text-fg-secondary no-underline hover:text-fg ' +
  'aria-[current=page]:font-bold aria-[current=page]:text-heading ' +
  'aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-3 aria-[current=page]:after:-bottom-px ' +
  'aria-[current=page]:after:h-0.5 aria-[current=page]:after:rounded-full aria-[current=page]:after:bg-action';

/** The menu-panel version: one full-width row per destination, 44px touch targets. */
const menuLink =
  'flex min-h-11 items-center rounded-md px-3 font-medium text-fg-secondary no-underline ' +
  'hover:bg-hover hover:text-fg aria-[current=page]:bg-selected aria-[current=page]:font-bold ' +
  'aria-[current=page]:text-heading';

/** 대시보드 · 과정 · 복습, shared by the inline nav and the narrow-screen menu. */
function NavLinks({
  className,
  due,
  onNavigate,
}: {
  className: string;
  due: number;
  onNavigate?: () => void;
}) {
  return (
    <>
      <Link
        to="/"
        className={className}
        activeOptions={{ exact: true }}
        activeProps={{ 'aria-current': 'page' }}
        onClick={onNavigate}
      >
        대시보드
      </Link>
      <Link
        to="/courses"
        className={className}
        activeProps={{ 'aria-current': 'page' }}
        onClick={onNavigate}
      >
        과정
      </Link>
      <Link
        to="/review"
        className={className}
        activeProps={{ 'aria-current': 'page' }}
        onClick={onNavigate}
      >
        복습
        {due > 0 && (
          <span className="nav-badge">
            <span className="sr-only">: 오늘 </span>
            {due}
            <span className="sr-only">개 개념</span>
          </span>
        )}
      </Link>
    </>
  );
}

/**
 * Global top navigation (docs/design/ui-ux.md#전역-내비게이션). Only destinations that exist in
 * this milestone are shown; 통계 and search arrive with their features.
 *
 * Below the md breakpoint (1024px) the nav collapses into a disclosure menu so the header fits a
 * phone (390px): the button reports `aria-expanded`, the panel follows it in tab order, and Esc,
 * a click outside or choosing a destination closes it (Esc returns focus to the button).
 */
export function AppHeader() {
  const navigate = useNavigate();
  const due = useQuery(dashboardQuery).data?.reviewDueCount ?? 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menuArea.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    // Widening past the breakpoint hides the menu: do not leave it open behind the inline nav.
    const wide = window.matchMedia('(width >= 1024px)');
    const closeWide = () => {
      if (wide.matches) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    wide.addEventListener('change', closeWide);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      wide.removeEventListener('change', closeWide);
    };
  }, [menuOpen]);
  return (
    <header
      data-f6-region=""
      className="sticky top-0 z-header h-(--header-h) border-b border-line bg-surface/92 backdrop-blur-md backdrop-saturate-150"
    >
      <div className="mx-auto flex h-full max-w-[calc(var(--page-max)+2*var(--space-8))] items-center gap-3 px-4 md:gap-8 md:px-5 lg:px-8">
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
        <nav className="hidden h-full gap-1 md:flex" aria-label="주 메뉴">
          <NavLinks className={navLink} due={due} />
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-2 md:gap-3">
          <HeaderGoal />
          <AIStatusIndicator />
          <IconButton
            label="설정"
            icon={<Settings size={20} />}
            variant="ghost"
            onClick={() => {
              void navigate({ to: '/settings/appearance' });
            }}
          />
          <div
            ref={menuArea}
            className="md:hidden"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && menuOpen) {
                event.stopPropagation();
                setMenuOpen(false);
                menuButton.current?.focus();
              }
            }}
          >
            <span className="relative inline-flex">
              <IconButton
                ref={menuButton}
                label="메뉴"
                icon={menuOpen ? <X size={20} /> : <Menu size={20} />}
                variant="ghost"
                aria-expanded={menuOpen}
                aria-controls={menuId}
                onClick={() => {
                  setMenuOpen((open) => !open);
                }}
              />
              {/* Reviews are due: a dot on the button (the count is in the menu and read out there). */}
              {due > 0 && !menuOpen && (
                <span
                  className="pointer-events-none absolute top-0.5 right-0.5 size-2 rounded-full bg-action"
                  aria-hidden="true"
                />
              )}
            </span>
            {menuOpen && (
              <nav
                id={menuId}
                aria-label="주 메뉴"
                className="absolute inset-x-0 top-full grid gap-1 border-b border-line bg-surface p-2 shadow-2"
              >
                <NavLinks
                  className={menuLink}
                  due={due}
                  onNavigate={() => {
                    setMenuOpen(false);
                  }}
                />
              </nav>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
