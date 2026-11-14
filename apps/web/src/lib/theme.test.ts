import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, THEME_CACHE_KEY } from './theme.ts';

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
