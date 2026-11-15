import { afterEach, describe, expect, it } from 'vitest';
import { applyAppearance, applyTheme, THEME_CACHE_KEY } from './theme.ts';

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

  it('follows the system for "system"', () => {
    applyTheme('light');
    applyTheme('system');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBeNull();
  });
});

describe('applyAppearance', () => {
  it('sets the dark workbench and the lesson size, and removes them for the defaults', () => {
    const root = document.createElement('html');
    applyAppearance({ 'appearance.workbench': 'dark', 'lesson.fontSize': 'large' }, root);
    expect(root.dataset['workbench']).toBe('dark');
    expect(root.style.getPropertyValue('--lesson-font-size')).toBe('1.1875rem');
    applyAppearance({ 'appearance.workbench': 'light', 'lesson.fontSize': 'medium' }, root);
    expect(root.dataset['workbench']).toBeUndefined();
    expect(root.style.getPropertyValue('--lesson-font-size')).toBe('');
  });
});
