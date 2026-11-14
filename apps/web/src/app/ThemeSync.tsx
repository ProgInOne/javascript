import { useEffect } from 'react';
import { useSettings } from '../api/queries.ts';
import { applyTheme } from '../lib/theme.ts';

/** Keeps <html data-theme> in sync with the stored setting. */
export function ThemeSync() {
  const { data } = useSettings();
  useEffect(() => {
    if (data) applyTheme(data.theme);
  }, [data]);
  return null;
}
