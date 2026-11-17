import { afterEach, describe, expect, it } from 'vitest';
import script from '../../public/theme-init.js?raw';
import { applyAppearance, applyTheme, resolveTheme, THEME_CACHE_KEY } from './theme.ts';

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset['theme'];
});

describe('applyTheme', () => {
  it('sets an explicit theme and caches it', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe('dark');
  });

  it('follows the system for "system" and caches that too (D-078)', () => {
    applyTheme('light');
    applyTheme('system');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('resolves "system" through the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('theme-init.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs the shipped file as is
  const run = new Function(script) as () => void;

  it.each([
    [null, 'light'],
    ['light', 'light'],
    ['dark', 'dark'],
    ['system', undefined],
    ['neon', 'light'],
  ])('paints cache %s as %s before the app loads', (cached, painted) => {
    if (cached !== null) localStorage.setItem(THEME_CACHE_KEY, cached);
    run();
    expect(document.documentElement.dataset['theme']).toBe(painted);
  });

  it('reads what applyTheme cached', () => {
    for (const theme of ['light', 'dark', 'system'] as const) {
      applyTheme(theme);
      delete document.documentElement.dataset['theme'];
      run();
      expect(document.documentElement.dataset['theme']).toBe(
        theme === 'system' ? undefined : theme,
      );
    }
  });
});

describe('applyAppearance', () => {
  it('sets the dark workbench and the lesson size, and removes them for the defaults', () => {
    const root = document.createElement('html');
    applyAppearance({ 'appearance.workbench': 'dark', 'lesson.fontSize': 'large' }, root);
    expect(root.dataset['workbench']).toBe('dark');
    expect(root.style.getPropertyValue('--lesson-font-size')).toBe('1.25rem');
    applyAppearance({ 'appearance.workbench': 'light', 'lesson.fontSize': 'medium' }, root);
    expect(root.dataset['workbench']).toBeUndefined();
    expect(root.style.getPropertyValue('--lesson-font-size')).toBe('');
  });
});
