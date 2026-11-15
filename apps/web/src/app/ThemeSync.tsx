import { useEffect } from 'react';
import { useSettings } from '../api/queries.ts';
import { applyAppearance, applyTheme } from '../lib/theme.ts';

/** Keeps <html> in sync with the stored appearance settings (theme, workbench, lesson size). */
export function ThemeSync() {
  const { data } = useSettings();
  useEffect(() => {
    if (!data) return;
    applyTheme(data.theme);
    applyAppearance(data);
  }, [data]);
  return null;
}
