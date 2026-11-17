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

/** `lesson.fontSize` → `--lesson-font-size` (17 / 18 / 20px, ui-ux.md 타이포그래피, D-077). */
export const LESSON_FONT_SIZE_VALUES: Record<Settings['lesson.fontSize'], string> = {
  small: '1.0625rem',
  medium: '1.125rem',
  large: '1.25rem',
};

/**
 * Applies the other appearance settings to <html>: `data-workbench="dark"` for the dark
 * workbench (D-024) and the lesson body size. Defaults remove the overrides so the tokens apply.
 */
export function applyAppearance(
  settings: Pick<Settings, 'appearance.workbench' | 'lesson.fontSize'>,
  root: HTMLElement = document.documentElement,
): void {
  if (settings['appearance.workbench'] === 'dark') root.dataset['workbench'] = 'dark';
  else delete root.dataset['workbench'];
  const size = settings['lesson.fontSize'];
  if (size === 'medium') root.style.removeProperty('--lesson-font-size');
  else root.style.setProperty('--lesson-font-size', LESSON_FONT_SIZE_VALUES[size]);
}
