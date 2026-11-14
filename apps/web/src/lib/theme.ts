import type { Settings } from '@proginone/shared';

export const THEME_CACHE_KEY = 'proginone.theme';

/**
 * Applies the theme to <html>. `system` removes the attribute so the tokens follow
 * `prefers-color-scheme`. The value is cached for public/theme-init.js to avoid a flash.
 */
export function applyTheme(
  theme: Settings['theme'],
  root: HTMLElement = document.documentElement,
): void {
  if (theme === 'system') delete root.dataset['theme'];
  else root.dataset['theme'] = theme;
  try {
    if (theme === 'system') localStorage.removeItem(THEME_CACHE_KEY);
    else localStorage.setItem(THEME_CACHE_KEY, theme);
  } catch {
    // Storage unavailable (private mode); the attribute is still applied.
  }
}
